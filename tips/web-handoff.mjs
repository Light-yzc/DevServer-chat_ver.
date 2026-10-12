/** Local Sol -> Web Chat handoffs. Tips mail is durable; Web Wake relay will
 * prompt a matching ONLINE browser. Never claim that prompt submission is ACK.
 * An unattended timeout queues ONE authorized Local Main fallback. */
import {createWebIdentityStore} from '../vendor/devspace/dist/web-identity-store.js';
import {createTipsV2} from '../vendor/devspace/dist/tips-core.js';
import {loadConfig} from '../vendor/devspace/dist/config.js';
import {randomUUID} from 'node:crypto';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const WEB_ACK_TIMEOUT_MS=45*60_000;
export const WEB_REVIEW_TIMEOUT_MS=3*60*60_000;
const PREFIX='web-handoff-';
function ensure(x,msg){if(!x)throw Error(msg)}
function claimed(role,now=Date.now()){
  return role?.status==='claimed'&&Date.parse(role.leaseExpiresAt)>now;
}
export function requestWebHandoff(tips,roles,{to='web-air-main',subject,body,sourceId}={}){
  ensure(/^web-[a-z0-9][a-z0-9_.-]{0,58}$/.test(to),'Invalid Web role');
  ensure(roles.some(r=>r.id===to&&claimed(r)),'Target Web role is not currently claimed; use Local Luna instead');
  ensure(typeof subject==='string'&&subject.trim()&&subject.length<=180,'Handoff subject required');
  ensure(typeof body==='string'&&body.trim()&&body.length<=5000,'Handoff body required');
  // Retries of the SAME wake should not generate duplicate Web assignments.
  if(sourceId){
    const prior=tips.snapshot().tasks.find(t=>t.id.startsWith(PREFIX)&&(()=>{
      try{return JSON.parse(t.details)?.sourceId===sourceId&&JSON.parse(t.details)?.to===to}catch{return false}
    })());
    if(prior)return {id:prior.id,deduplicated:true,status:prior.status};
  }
  const id=PREFIX+randomUUID().slice(0,12);
  const outbound=tips.messages({action:'post',from:'server-controller',to,
    subject:`[Web handoff] ${subject}`,body,tracked:true,priority:'high',taskId:id},{trustedWake:true});
  const details=JSON.stringify({to,messageId:outbound.id,sourceId:sourceId??null,createdAt:outbound.at});
  tips.mutate({action:'update',id,title:`Web 审查 · ${subject}`,group:'Agent handoffs',kind:'progress',
    status:'pending',progressMeasured:false,
    message:`已请求 ${to} 审查（Web Wake 将尝试提醒）；等待实际 ACK`,details},{trustedUpdate:true});
  return {id,messageId:outbound.id,to,status:'pending',note:'Tips queued; browser wake/ChatGPT ACK are not yet confirmed'};
}

export function scanWebHandoffs(tips,{now=Date.now(),ackTimeoutMs=WEB_ACK_TIMEOUT_MS}={}){
  const tasks=tips.snapshot().tasks.filter(t=>t.id.startsWith(PREFIX)&&t.details&&!['cancelled','archived'].includes(t.status));
  const all=tips.messages({action:'list',limit:300});
  const byId=new Map(all.map(m=>[m.id,m]));
  const fallbackFor=new Set(all.filter(m=>m.from==='tips-web-handoff-watch'&&m.to==='server-controller')
    .map(m=>m.taskId));
  const result={tracked:tasks.length,awaiting:0,acked:0,finished:0,fallbacks:0,errors:[]};
  for(const task of tasks){
    let meta;try{meta=JSON.parse(task.details)}catch{continue}
    if(!meta||typeof meta.messageId!=='string'||!/^web-/.test(meta.to))continue;
    const mail=byId.get(meta.messageId);
    if(!mail)continue;
    const verified=mail.verification;
    try{
      if(mail.status==='resolved'&&verified?.verdict==='accepted'){
        result.finished++;
        if(task.status!=='completed')tips.mutate({action:'update',id:task.id,status:'completed',
          message:`${meta.to} 已完成 Web 消息验收；科研结果仍须核对证据`,heartbeatEnabled:false},{trustedUpdate:true});
      }else if(fallbackFor.has(task.id)){
        result.awaiting++;
      }else if(verified?.verdict==='rejected'||verified?.verdict==='needs_changes'||
        (mail.ackBy&&now-Date.parse(mail.ackAt??mail.at)>=WEB_REVIEW_TIMEOUT_MS)||
        (!mail.ackBy&&now-Date.parse(mail.at)>=ackTimeoutMs)){
        const reason=verified?.verdict==='rejected'?'Web 审查拒绝':verified?.verdict==='needs_changes'?'Web 请求修改':
          mail.ackBy?'Web 已读但超过 3 小时尚未完成验收':'Web 超过 45 分钟尚未 ACK';
        // The fallback is a new authorized Local Main request, not a GPU
        // approval. No direct subagent start, and no loop after one timeout.
        tips.messages({action:'post',from:'tips-web-handoff-watch',to:'server-controller',
          subject:`Web ${meta.to} 审查需要后备协调`,priority:'high',taskId:task.id,
          body:`Web handoff ${task.id}, message ${mail.id}: ${reason}. Check its actual status; arrange non-duplicating Luna Local Sub fallback or explicitly defer. Do NOT restart forbidden GPU experiments or override STOP/Owner; keep Web review asynchronous.`},{trustedWake:true});
        result.fallbacks++;
        tips.mutate({action:'update',id:task.id,status:'blocked',
          message:`${reason}；已通知 Local Sol 评估 Luna 后备`,heartbeatEnabled:false},{trustedUpdate:true});
      }else if(mail.ackBy){
        result.acked++;
        if(task.status==='pending')tips.mutate({action:'update',id:task.id,status:'running',
          message:`${meta.to} 已 ACK；等待其实际验证和审查结论`},{trustedUpdate:true});
      }else result.awaiting++;
    }catch(error){result.errors.push(`${task.id}: ${String(error.message).slice(0,150)}`)}
  }
  return result;
}

// Optional private CLI used BY server-controller Sol. Stdin avoids subject,
// report text or research details being visible in process command arguments.
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
  process.env.DEVSPACE_CONFIG_DIR??=root+'/var/config';
  const config=loadConfig(),tips=createTipsV2(config),action=process.argv[2];
  if(action==='request'){
    let input='';for await(const chunk of process.stdin){input+=chunk;if(input.length>20_000)throw Error('Handoff JSON too large')}
    const request=JSON.parse(input);
    console.log(JSON.stringify(requestWebHandoff(tips,createWebIdentityStore(config).list(),request)));
  }else if(action==='status'){
    const id=process.argv[3],task=tips.mutate({action:'get',id});
    ensure(task?.id?.startsWith(PREFIX),'Handoff task not found');
    const msg=tips.messages({action:'get',id:JSON.parse(task.details).messageId});
    console.log(JSON.stringify({id:task.id,status:task.status,message:task.message,ackBy:msg?.ackBy??null,verdict:msg?.verification?.verdict??null}));
  }else throw Error('Usage: echo JSON | node tips/web-handoff.mjs request   OR status web-handoff-ID');
}
