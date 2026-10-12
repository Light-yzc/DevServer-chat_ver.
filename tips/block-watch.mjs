/**
 * Lightweight new-blocker detector. Only tasks whose actual Tips updatedAt
 * is within the last six hours are eligible. No inference from heartbeat,
 * dashboard polls or message receipt timestamps.
 */
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const MAX_BLOCK_AGE_MS = 6 * 60 * 60 * 1000;
const DEFAULT_QUIET_MS = 90_000;
const DEFAULT_DAILY_LIMIT = 2;
// User-paused or superseded registrations. A new GOAL needs its own task ID.
const PERMANENTLY_EXCLUDED = new Set([
  'air-life-causal-corrected-20261012',
  'air-reviewer-baseline-goal-20261011',
  'air-fullE-gpu-observe-20261011',
  'air-fullE-native-build-20261011',
]);
const STOP_MARKERS = [
  /用户.{0,20}(停止|暂停|取消)/i, /按要求停止/i, /暂停指令/i,
  /(?:不要|禁止|不得).{0,25}(?:重启|恢复|重试|继续|自动)/i,
  /(?:等待|需要|待).{0,20}(?:用户|人工|明确恢复指令)/i,
  /(?:do not|must not|no automatic).{0,55}(?:retry|restart|resume|sol|invoke)/i,
  /(?:user.{0,20}(?:paused|stopped|cancelled)|requires? (?:human|user) approval)/i,
  /(?:no (?:automatic )?retry|operator-directed distinct registration)/i,
];

export function updatedWithinSixHours(task, now = Date.now()) {
  const at = Date.parse(task?.updatedAt ?? '');
  return Number.isFinite(at) && at <= now && now - at < MAX_BLOCK_AGE_MS;
}

export function blockerFingerprint(task) {
  return createHash('sha256').update(JSON.stringify({
    status: task.status, title: task.title, message: task.message, details: task.details,
  })).digest('hex');
}

export function blockEvidenceDigest(task) {
  return createHash('sha256').update(JSON.stringify({status:task.status,
    title:task.title,message:task.message,details:task.details,updatedAt:task.updatedAt})).digest('hex');
}

export function eligibleBlock(task, now = Date.now()) {
  if (!task || task.status !== 'blocked' || task.archived || !updatedWithinSixHours(task, now)) return false;
  // Remote read/write Tips token is not sufficient to wake a full-access agent.
  if (typeof task.blockAttestation !== 'string' || task.blockAttestation !== blockEvidenceDigest(task)) return false;
  if (task.id === 'tips-server-controller' || PERMANENTLY_EXCLUDED.has(task.id) || task.autoWakeBlocked === false) return false;
  if (!(task.id?.startsWith('air-') || task.autoWakeBlocked === true)) return false;
  const content = [task.title, task.message, task.details].filter(Boolean).join(' ');
  return !STOP_MARKERS.some(pattern => pattern.test(content));
}

/** Used after mailbox claim, immediately before any Codex process can start. */
export function rejectQueuedAutoBlock(tips, message, now = Date.now()) {
  if (!message.autoBlock) return null; // Manual authorized messages are independent.
  const {taskId,updatedAt,hash} = message.autoBlock;
  if (typeof taskId !== 'string' || typeof updatedAt !== 'string' || typeof hash !== 'string') return 'Invalid automatic blocker metadata';
  const task = tips.mutate({action:'get',id:taskId});
  if (!eligibleBlock(task, now)) return 'Task no longer qualifies (status, user stop or 6h freshness gate)';
  if (task.updatedAt !== updatedAt || blockerFingerprint(task) !== hash) return 'Task changed since automatic wake was queued';
  const successor = tips.snapshot().tasks.find(t=>t.id!==task.id&&t.status==='running'&&
    (t.id.startsWith(task.id+'-v')||t.id.startsWith(task.id+'-retry')));
  if (successor) return `Active successor ${successor.id} already running`;
  return null;
}

function save(path, data) {
  const temp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
  renameSync(temp, path);
}

export function createBlockWatch(tips, opts = {}) {
  const file = opts.file ?? join(tips.dir, 'block-wake-state.json');
  const time = opts.time ?? (() => Date.now());
  const quietMs = opts.quietMs ?? DEFAULT_QUIET_MS;
  const dailyLimit = opts.dailyLimit ?? DEFAULT_DAILY_LIMIT;
  const cooldownMs = opts.cooldownMs ?? 24 * 60 * 60 * 1000;

  function scan() {
    const now = time();
    const today = new Date(now).toISOString().slice(0, 10);
    const tasks = tips.snapshot().tasks;
    const first = !existsSync(file);
    const state = first ? { version: 1, observed: {}, wakes: [] } : JSON.parse(readFileSync(file, 'utf8'));
    const result = { initialized: first, eligible: 0, queued: [], skipped: [] };
    let dailyUsed = state.wakes.filter(item => item.day === today).length;

    for (const task of tasks) {
      if (task.id === 'tips-server-controller') continue;
      const hash = blockerFingerprint(task);
      const old = state.observed[task.id];
      if (!old) {
        // First launch baselines all existing entries. After that, newly
        // discovered fresh blockers must be eligible after the quiet period.
        state.observed[task.id] = { status: task.status, hash,
          since: !first && eligibleBlock(task,now)?now:null, lastWake:null,lastHash:null };
        continue;
      }
      if (!eligibleBlock(task, now)) {
        state.observed[task.id] = { ...old, status: task.status, hash, since: null };
        if (task.status === 'blocked') result.skipped.push(task.id);
        continue;
      }
      result.eligible++;
      const changed = old.status !== 'blocked' || old.hash !== hash;
      const entry = changed ? { ...old, status: 'blocked', hash, since: now } : { ...old };
      if (entry.since == null || now - entry.since < quietMs) { state.observed[task.id] = entry; continue; }
      if (entry.lastHash === hash || (entry.lastWake && now - entry.lastWake < cooldownMs)) {
        state.observed[task.id] = { ...entry, since: null }; continue;
      }
      if (dailyUsed >= dailyLimit) { state.observed[task.id] = entry; continue; }
      const successor = tasks.some(t => t.id !== task.id && t.status === 'running' &&
        (t.id.startsWith(task.id+'-v') || t.id.startsWith(task.id+'-retry')));
      if (successor) { state.observed[task.id] = { ...entry, since: null }; result.skipped.push(task.id); continue; }
      // Hard recheck against current task, immediately prior to publishing wake.
      const live = tips.mutate({action:'get', id:task.id});
      if (!eligibleBlock(live, time()) || live.updatedAt !== task.updatedAt || blockerFingerprint(live) !== hash) {
        state.observed[task.id] = { ...entry, since: null };continue;
      }

      const body = `New technical blocker (updated ${task.updatedAt}), id=${task.id}.\n`
        + `Title: ${String(task.title??'').slice(0,180)}\n`
        + `Message: ${String(task.message??'').slice(0,1000)}\n`
        + `Details: ${String(task.details??'').slice(0,1000)}\n`
        + 'Check current files and project policies. Diagnose and attempt a minimal safe fix, preferably delegate routine CPU implementation to Luna. Do not bypass GPU approval, alter frozen registrations, automatically retry explicitly stopped goals or exceed reserved Sol review budgets. Report to the web controller when human approval is required.';
      // Persist before publishing: crash must not send duplicate wake.
      state.observed[task.id] = { ...entry, since:null, lastHash:hash, lastWake:now };
      state.wakes.push({ day:today, id:task.id, at:new Date(now).toISOString(), updatedAt:task.updatedAt });
      save(file, state);
      try {
        const msg = tips.messages({action:'post',from:'tips-block-watch',to:'server-controller',
          wake:true,priority:'normal',taskId:task.id,subject:`Recent blocked AIR task: ${task.id}`,
          body,autoBlock:{taskId:task.id,updatedAt:task.updatedAt,hash}}, {trustedWake:true});
        result.queued.push({id:task.id,messageId:msg.id});
      } catch (error) { result.skipped.push(`${task.id}: dispatch error ${String(error.message).slice(0,120)}`); }
      dailyUsed++;
    }
    const ids = new Set(tasks.map(t => t.id));
    for (const id of Object.keys(state.observed)) if (!ids.has(id)) delete state.observed[id];
    state.wakes = state.wakes.slice(-150);
    save(file, state);
    return result;
  }
  return {scan, inspect:()=>existsSync(file)?JSON.parse(readFileSync(file,'utf8')):null};
}
