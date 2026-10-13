/** Guarded, audited, local-only managed Sub registration retirement.
 * This deliberately never stops agents or deletes Tips records, mail or files.
 * The running Linux user is trusted; this is NOT OS-level Main/Sub isolation. */
import {createTipsAdmin} from '../vendor/devspace/dist/tips-admin.js';
import {subagentRegistry} from './subagents.mjs';

const TERMINAL=new Set(['completed','failed','stopped']);
const TASK_TERMINAL=new Set(['completed','failed','cancelled']);
export const MIN_IDLE_DAYS=14;

export function inspectRetirement(tips,agent,{now=Date.now(),minIdleDays=MIN_IDLE_DAYS}={}){
  if(!Number.isFinite(minIdleDays)||minIdleDays<MIN_IDLE_DAYS)throw Error('At least 14 idle days required');
  const reasons=[];
  if(!TERMINAL.has(agent.status))reasons.push('agent_not_terminal');
  if(agent.pid)reasons.push('agent_pid_still_recorded');
  if(agent.failureCircuitOpen)reasons.push('failure_circuit_needs_diagnosis');
  const updated=Date.parse(agent.updatedAt??'');
  const idleDays=Number.isFinite(updated)?Math.floor((now-updated)/86_400_000):null;
  if(idleDays===null||idleDays<minIdleDays)reasons.push('recent_or_unknown_last_activity');
  const task=tips.mutate({action:'get',id:agent.name});
  if(!task||!TASK_TERMINAL.has(task.status))reasons.push('task_not_terminal_or_missing');
  // Check all retained mail; limiting results can silently hide old unread mail.
  const unread=tips.messages({action:'list',to:agent.name,unreadOnly:true,limit:300});
  if(unread.length)reasons.push('unread_mail');
  // Another task may still name this Sub as its Owner. Avoid detaching it
  // until the live project plan is reassigned or marked terminal.
  const otherTasks=tips.snapshot().tasks;
  if(otherTasks.some(t=>t.id!==agent.name&&!TASK_TERMINAL.has(t.status)&&(
    t.owner===agent.name||t.owner?.startsWith(agent.name+' ')||t.dependencyIds?.includes(agent.name))))
    reasons.push('referenced_by_open_task');
  return {name:agent.name,status:agent.status,idleDays,eligible:reasons.length===0,reasons,
    taskStatus:task?.status??null,unread:unread.length};
}

export function retirementCandidates(config,tips,{now=Date.now(),minIdleDays=MIN_IDLE_DAYS}={}){
  const registry=subagentRegistry(config,tips);
  return registry.list().map(a=>inspectRetirement(tips,a,{now,minIdleDays}));
}

export function retireSubagent(config,tips,{name,reason,confirmation,now=Date.now(),minIdleDays=MIN_IDLE_DAYS}={}){
  if(typeof name!=='string'||!/^sub-[a-z0-9][a-z0-9_.-]{0,57}$/.test(name))throw Error('Exact sub-* name required');
  if(confirmation!==name)throw Error('Explicit --confirm with the same exact agent ID required');
  if(typeof reason!=='string'||reason.trim().length<15||reason.length>400)throw Error('Provide a concrete 15-400 character retirement reason');
  const registry=subagentRegistry(config,tips);
  const a=registry.status(name);
  if(!a)throw Error('Unknown Subagent');
  const check=inspectRetirement(tips,a,{now,minIdleDays});
  if(!check.eligible)throw Error('Retirement refused: '+check.reasons.join(', '));
  // Registry.remove atomically rechecks the active/queued state and live PID.
  // Use existing Tips administration to preserve its management audit trail.
  const admin=createTipsAdmin(config,tips);
  const result=admin.run({action:'remove_sub',id:name,viewToken:tips.credentials.viewToken,reason:reason.trim()});
  return {name,retired:true,retainedHistory:true,audit:'tips/admin-audit.json',result:result.result};
}
