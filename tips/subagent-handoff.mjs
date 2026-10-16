/** Model-free, idempotent research milestone handoff for completed Luna turns.
 * Web-first: an explicitly delegated Web owner is the ONLY routine recipient;
 * Local Sol receives unowned legacy AIR handoffs passively, not as model wakes.
 * Neither path grants GPU/STOP/Owner permission. */
import {redactEvidence} from './subagent-evidence.mjs';
export function emitResearchMilestone(tips,{name,jobId,group='',startedAt='',resultPath='',resultExcerpt='',gitEvidence=null,
  status='completed',owner=null,reportPath=''}){
  const airJob=Boolean(name?.startsWith('sub-air-')||/^AIR/i.test(group));
  const webOwner=typeof owner==='string'&&/^web-[a-z0-9_.-]{1,60}$/.test(owner);
  if(!airJob&&!webOwner)return null;
  if(!jobId||!resultPath)return null;
  const subject=`Luna 交接待验收 · ${name} · ${jobId}`;
  const body=`${name} 的 Codex Turn 状态为 ${status}；**不等于科研成果通过验收**。Job ID: ${jobId}；任务卡 ID: ${name}；本轮完整结果：${resultPath}；结构化报告：${reportPath||'暂缺'}。\nSub 最终陈述节选（尚未独立核验）：${redactEvidence(String(resultExcerpt).slice(0,900))||'无'}\nGit 检查：${gitEvidence?.available?'baseline='+gitEvidence.baselineHead+' final='+gitEvidence.head+' patchChars='+gitEvidence.patchChars:'未取得仓库快照'}；**共享目录 Git Diff 不可归因给此 Sub**。文档同步状态：${gitEvidence?.documentationReview?.status??'unknown'}；若需要更新文档或旧说明与实现冲突，先核对代码/测试再处理，不能依靠历史摘要。Main 可按 jobId 读取 handoff/result/diff/log/events/manifest，先核对真实产物与科研门禁后再决定；不得盲目重跑 GPU。`;
  let sent=null;
  // The original Web delegator is the decision owner. Do NOT duplicate that
  // completion to Local Sol: even a passive unread copy can later be promoted
  // into another review, delaying the next Web-driven iteration.
  if(webOwner){
    sent=tips.messages({action:'post',from:name,to:owner,
      subject,body,priority:status==='failed'?'high':'normal',taskId:name,
      dedupeKey:`handoff:${name}:${jobId}:${owner}`},{trustedWake:true});
  }else if(airJob){
    // No authenticated Web owner: preserve visibility to existing Local Main,
    // but never spend a Sol turn solely because a Sub completed normally.
    sent=tips.messages({action:'post',from:name,to:'server-controller',
      subject,body,priority:'normal',wake:false,taskId:name,
      dedupeKey:`handoff:${name}:${jobId}:server-controller`},{trustedWake:true});
  }
  return sent;
}
