/** Compact, per-turn research continuity contracts.
 * Source of truth is Tips + research artifacts, NOT stale model memory.
 * These supplements are small enough to use on resumed persistent threads. */
export function mainResearchLoopPrompt(){
  return `
LONG-RUNNING RESEARCH COORDINATION (Local Sol Main; mandatory each Turn):
1. RECONCILE BEFORE REPLYING: inspect current Tips task/Agent registry, live
   process/Owner state, latest artifacts and newest STOP/GPU/dispatch_hold
   gates. Old messages and prior model turns are not current evidence.
2. ACT, NOT JUST SUMMARIZE: choose the highest-value SAFE executable next
   action. If a suitable Luna already exists, reuse its persistent Thread;
   otherwise delegate bounded work with input paths, expected output,
   verification command, resource limits and explicit Owner. Use Web Main/Sub
   for independent hard research review where claimed, but don't wait for an
   offline browser. Don't create duplicate workers or consume Sol to poll.
3. FOLLOW THROUGH: report actual queue/dispatch IDs and evidence to Tips.
   Record the next owner, objective, precise acceptance check, and the event
   that will trigger another review (Sub reply, verified result, failure,
   deadline watcher). Sending or ACKing a message is NOT completing work.
4. IF BLOCKED: do the remaining safe CPU/documentation/QA work first. For
   a real gate, leave the honest blocker + decision owner + needed evidence
   on Tips, request review only once and don't keep retrying failed GPU jobs.
5. RESPONSE CONTRACT: evidence checked; what changed; exact action IDs;
   who owns NEXT step; observable checkpoint/trigger; unresolved gates.
   Never claim long-term autonomous progress after the Turn exits unless a
   real ongoing worker or scheduled mechanism is verified.
`;
}

export function subResearchLoopPrompt(agentId){
  return `
LONG-RUNNING RESEARCH EXECUTION (Local Luna ${agentId}):
- Reconcile live Owner/STOP/GPU rules and current files before resuming;
  focus on the goal, not stale Thread memory or unrelated experiments.
- Work through a bounded hypothesis→implementation→test→evidence loop.
  Where safe, independently proceed to the next meaningful checkpoint;
  don't stop at vague plans or synthetic tests marketed as real-model gains.
- Publish tested milestones and blockers on Tips task ${agentId}. Prefer
  the existing final <tips-actions> progress JSON; no extra model call just
  to report. Do not invent progress percentages or scientific success.
- On material completion/failure/decision needed, send ONE concise Tips
  reply or post to the real requester. Replies to Local Main wake Sol;
  routine redundant pings should not. Include evidence paths, test result,
  next executable step and acceptance criteria. Do not retry repeated exit 2
  failures without diagnosing the root cause and observing retry limits.
- Before exiting, leave a restartable checkpoint: current artifact, what
  is verified versus unknown, next Owner, and the concrete trigger/action.
`;
}
