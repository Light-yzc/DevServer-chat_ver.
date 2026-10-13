/** Model-free, idempotent research milestone handoff for completed Luna turns.
 * This is a routine low-cost continuation signal, never an experiment GO. */
export function emitResearchMilestone(tips,{name,jobId,group='',startedAt='',resultPath=''}){
  if(!name?.startsWith('sub-air-')&&!/^AIR/i.test(group))return null;
  if(!jobId||!resultPath)return null;
  const mail=tips.messages({action:'list',to:'server-controller',limit:300});
  const exists=mail.some(m=>m.from===name&&(
    m.subject?.includes(jobId)||
    (Number.isFinite(Date.parse(startedAt))&&Date.parse(m.at)>=Date.parse(startedAt))));
  if(exists)return null;
  // If a prior unreviewed completion from this agent already exists, Main
  // will inspect its latest task card; do not generate more Sol Turn wakes.
  if(mail.some(m=>m.from===name&&m.subject?.startsWith('Luna 里程碑待验收')&&
    ['unread','processing','acknowledged'].includes(m.status)))return null;
  return tips.messages({action:'post',from:name,to:'server-controller',
    subject:`Luna 里程碑待验收 · ${name} · ${jobId}`,
    body:`${name} 的 Codex Turn 已成功退出；**这不等于科研成果通过验收**。任务卡 ID: ${name}；本轮完整结果：${resultPath}。请对照 Tips 项目总览、当前 Owner、真实证据和验收标准决定下一步；不要盲目重跑实验或绕过 GPU/STOP/dispatch_hold。`,
    priority:'normal',wake:true,taskId:name},{trustedWake:true});
}
