import {boundedTaskMessage} from './task-result-text.mjs';
/** Optional model-authored task milestone carried inside its EXISTING footer.
 * No extra model calls or shell CLI are required to publish this update. */
export function applySubagentProgress(tips,agentId,entry){
  if(!entry||typeof entry!=='object'||Array.isArray(entry))return null;
  if(typeof entry.message!=='string'||!entry.message.trim())
    throw Error('Subagent progress requires a nonempty message');
  const status=entry.status??'running';
  if(!['running','blocked','completed'].includes(status))throw Error('Invalid Subagent progress status');
  const body={action:'update',id:agentId,kind:'progress',status,
    message:boundedTaskMessage(entry.message.trim()),heartbeatEnabled:status==='running'};
  if(entry.details!==undefined){
    if(typeof entry.details!=='string'||entry.details.length>2000)throw Error('Invalid progress details');
    body.details=entry.details;
  }
  if(entry.current!==undefined||entry.total!==undefined){
    if(!Number.isSafeInteger(entry.current)||!Number.isSafeInteger(entry.total)||
      entry.current<0||entry.total<=0||entry.current>entry.total)throw Error('Progress current/total must be finite steps, current<=total');
    body.current=entry.current;body.total=entry.total;
  }
  return tips.mutate(body,{trustedUpdate:true});
}
