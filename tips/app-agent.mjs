#!/usr/bin/env node
/**
 * Codex App Server adapter for persistent, addressable research Agents.
 * Usage:
 *   node tips/app-agent.mjs --name air-luna --model gpt-6-luna \
 *     --cwd /path/to/your/research \
 *     --prompt-file path/to/GOAL.md --output-last-message path/to/result.txt
 *
 * Distinct agent names have isolated thread ID files and receive Tips mail.
 * Only trusted agent messages can be steered into a running full-access model.
 * Delivering does NOT claim the model has acknowledged the message.
 */
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {resolveCodexBin} from './codex-bin.mjs';
import { loadConfig } from '../vendor/devspace/dist/config.js';
import { createTipsV2 } from '../vendor/devspace/dist/tips-core.js';
import { tipsProtocol, needsDelivery, shouldInjectProtocol,localMainWakeRequested,localMainReplyWakeRequested } from './subagent-protocol.mjs';
import {applySubagentProgress} from './subagent-progress.mjs';
import {subResearchLoopPrompt} from './research-loop-prompt.mjs';
import {taskBoardDigest} from './task-board-digest.mjs';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
process.env.DEVSPACE_CONFIG_DIR??=join(ROOT,'var/config');
const tips=createTipsV2(loadConfig());
const params={name:'',model:'gpt-6-luna',cwd:ROOT,sandbox:'danger-full-access',effort:'medium',
  promptFile:'',outputFile:'',logFile:'',sessionFile:'',probe:false};
const flags=new Map([['--name','name'],['--model','model'],['--cwd','cwd'],
  ['--sandbox','sandbox'],['--effort','effort'],['--prompt-file','promptFile'],
  ['--output-last-message','outputFile'],['--log','logFile'],['--session-file','sessionFile']]);
for(let i=2;i<process.argv.length;i++){
  const arg=process.argv[i];
  if(arg==='--probe'){params.probe=true;continue;}
  if(!flags.has(arg)||!process.argv[i+1])throw Error('Unknown/missing option '+arg);
  params[flags.get(arg)]=process.argv[++i];
}
if(!/^[a-z0-9][a-z0-9_.-]{0,63}$/i.test(params.name))throw Error('--name requires stable 1–64 char Agent ID');
if(!['danger-full-access','workspace-write','read-only'].includes(params.sandbox))throw Error('Invalid sandbox');
params.cwd=resolve(params.cwd);
if(!params.probe&&!params.promptFile)throw Error('Provide --prompt-file');
const runtime=join(tips.dir,'app-agents');
mkdirSync(runtime,{recursive:true,mode:0o700});chmodSync(runtime,0o700);
const threadFile=params.sessionFile||join(runtime,params.name+'.json');
const codex=resolveCodexBin();
const timeoutSeconds=Math.min(7200,Math.max(60,Number(process.env.TIPS_APP_TURN_TIMEOUT_SECONDS||3600)));
const eventOut=params.logFile?resolve(params.logFile):'';
const safeLog=(o)=>{if(eventOut)writeFileSync(eventOut,JSON.stringify(o)+'\n',{flag:'a',mode:0o600});};
const stored=()=>{try{return JSON.parse(readFileSync(threadFile,'utf8'))}catch{return null}};
const store=(threadId,protocolInjected)=>writeFileSync(threadFile,JSON.stringify({threadId,model:params.model,protocolInjected,at:new Date().toISOString()})+'\n',{mode:0o600});
let stopping=false,turnId=null,threadId=null,turnStatus=null,answer='',active=false,mailTimer=null;
let executionSteps=0,lastStageAt=0;
const proc=spawn(codex,['app-server','--stdio'],{cwd:params.cwd,env:process.env,stdio:['pipe','pipe','pipe']});
const pending=new Map();let nextId=1;
proc.stderr.on('data',buf=>{const line=buf.toString('utf8');if(/error|failed|panic/i.test(line))console.error('[app-server]',line.slice(0,450))});
proc.on('error',e=>{console.error('Could not spawn Codex app-server:',e.message);process.exitCode=1;});
const emit=obj=>{
  if(!proc.stdin.writable)throw Error('App Server pipe closed');
  proc.stdin.write(JSON.stringify(obj)+'\n');
};
const ask=(method,body={},timeout=20000)=>new Promise((resolve,reject)=>{
  const id=nextId++;
  const timer=setTimeout(()=>{pending.delete(id);reject(Error(method+' timed out'))},timeout);
  pending.set(id,{resolve:v=>{clearTimeout(timer);resolve(v)},reject:e=>{clearTimeout(timer);reject(e)}});
  emit({id,method,params:body});
});
const presented=new Map();
const requiredMailboxInstructions=tipsProtocol(params.name);
async function unreadMail(){
  const candidates=tips.messages({action:'list',to:params.name,limit:40});
  // Untrusted HTTP messages stay visible on the board but cannot be injected
  // into a fully privileged Agent merely by knowing the ordinary write token.
  return candidates.filter(m=>needsDelivery(m));
}
async function pushMail(){
  if(!active||!turnId||stopping)return;
  const mails=await unreadMail();
  for(const m of mails.slice().reverse().slice(0,5)){
    if(presented.has(m.id))continue;
    const text='Tips message ID '+m.id+' from '+m.from+' to '+m.to+'\nSubject: '+m.subject+'\n'+m.body+
      (m.tracked?'\nTracked exchange: ACK when read, then include verdicts:[{id,verdict:"accepted|rejected|needs_changes",note:"evidence"}] in final tips-actions. Do not use resolve for this tracked request.':'');
    try{
      const response=await ask('turn/steer',{threadId,expectedTurnId:turnId,input:[{type:'text',text}]},12000);
      if(response?.turnId===turnId){
        tips.messages({action:'delivered',id:m.id,turnId},{trustedWake:true});
        presented.set(m.id,m);
        safeLog({at:new Date().toISOString(),event:'mail_delivered',messageId:m.id,turnId});
      }
    }catch(e){
      // In-flight turns sometimes cannot accept steer; retain unread message
      // and let the next Turn consume it without interrupting tools/jobs.
      safeLog({at:new Date().toISOString(),event:'steer_deferred',messageId:m.id,reason:String(e.message).slice(0,200)});
    }
  }
}
function finalizeActions(raw){
  const re=/<tips-actions>\s*([\s\S]{0,12000}?)\s*<\/tips-actions>\s*$/i;
  const found=raw.match(re);
  if(!found)return raw;
  const readable=raw.slice(0,found.index).trimEnd();
  let actions;try{actions=JSON.parse(found[1])}catch(e){safeLog({event:'action_footer_error',text:e.message});return readable;}
  if(!actions||typeof actions!=='object')return readable;
  if(actions.progress){
    try{applySubagentProgress(tips,params.name,actions.progress)}
    catch(e){safeLog({event:'progress_footer_rejected',error:String(e.message).slice(0,200)})}
  }
  const allowed=id=>typeof id==='string'&&presented.has(id);
  const ack=new Set(Array.isArray(actions.ack)?actions.ack.slice(0,40):[]);
  const resolve=new Set(Array.isArray(actions.resolve)?actions.resolve.slice(0,40):[]);
  for(const id of ack){
    if(!allowed(id))continue;
    try{tips.messages({action:'ack',id,agentId:params.name,note:'Recipient acknowledged after App Server turn'})}
    catch(e){safeLog({event:'ack_failed',id,error:e.message})}
  }
  for(const reply of (Array.isArray(actions.replies)?actions.replies:[]).slice(0,20)){
    if(!reply||!allowed(reply.inReplyTo)||typeof reply.body!=='string'||!reply.body.trim())continue;
    const parent=presented.get(reply.inReplyTo);
    try{tips.messages({action:'reply',from:params.name,to:parent.from,
      inReplyTo:parent.id,subject:String(reply.subject||`Re: ${parent.subject}`).slice(0,200),body:reply.body.slice(0,6000),
      wake:localMainReplyWakeRequested(parent)}, {trustedWake:true})}
    catch(e){safeLog({event:'reply_failed',id:parent.id,error:e.message})}
  }
  for(const post of (Array.isArray(actions.posts)?actions.posts:[]).slice(0,8)){
    if(!post||typeof post.to!=='string'||!(/^(controller|server-controller|sub-[a-z0-9_.-]{1,60})$/i.test(post.to))||
      typeof post.body!=='string'||!post.body.trim())continue;
    try{tips.messages({action:'post',from:params.name,to:post.to,
      subject:String(post.subject||`Update from ${params.name}`).slice(0,200),
      body:post.body.slice(0,6000),priority:['low','normal','high'].includes(post.priority)?post.priority:'normal',
      wake:localMainWakeRequested(post)},
      {trustedWake:true})}
    catch(e){safeLog({event:'post_failed',to:post.to,error:e.message})}
  }
  for(const id of resolve){
    if(!allowed(id)||!ack.has(id)||presented.get(id)?.tracked)continue;
    try{tips.messages({action:'resolve',id,agentId:params.name,note:'Subagent confirmed complete in final response'})}
    catch(e){safeLog({event:'resolve_failed',id,error:e.message})}
  }
  const verdicts=Array.isArray(actions.verdicts)?actions.verdicts.slice(0,30):[];
  for(const v of verdicts){
    if(!v||!allowed(v.id)||!ack.has(v.id)||!presented.get(v.id)?.tracked||
      !['accepted','rejected','needs_changes'].includes(v.verdict))continue;
    try{tips.messages({action:'verify',id:v.id,agentId:params.name,verdict:v.verdict,
      note:String(v.note??'').slice(0,1000)},{trustedWake:true})}
    catch(e){safeLog({event:'verify_failed',id:v.id,error:e.message})}
  }
  safeLog({event:'tip_actions',acks:[...ack].filter(allowed),resolves:[...resolve].filter(allowed)});
  return readable;
}
const rl=createInterface({input:proc.stdout,crlfDelay:Infinity});
rl.on('line',line=>{
  let event;try{event=JSON.parse(line)}catch{return}
  if(typeof event.id==='number'&&pending.has(event.id)){
    const p=pending.get(event.id);pending.delete(event.id);
    if(event.error)p.reject(Error(JSON.stringify(event.error).slice(0,700)));
    else p.resolve(event.result??{});
    return;
  }
  const method=event.method||'';
  if(active&&['item/started','item/completed'].includes(method)){
    if(method==='item/completed')executionSteps++;
    const now=Date.now();
    if(now-lastStageAt>=60_000){
      lastStageAt=now;
      const stage=event.params?.item?.type||'work';
      try{tips.mutate({action:'update',id:params.name,kind:'progress',status:'running',
        message:`执行中 · ${executionSteps} 个已观察到的步骤 · 最近阶段 ${String(stage).slice(0,60)}`,
        heartbeatEnabled:true,heartbeat:true},{trustedUpdate:true});}
      catch(e){safeLog({event:'task_progress_error',error:String(e.message).slice(0,150)})}
    }
  }
  if(method==='turn/started'&&event.params?.turn?.id)turnId=event.params.turn.id;
  if(method==='item/agentMessage/delta'&&typeof event.params?.delta==='string')answer+=event.params.delta;
  if(method==='item/completed'&&event.params?.item?.type==='agentMessage'&&typeof event.params?.item?.text==='string')answer=event.params.item.text;
  if(method==='turn/completed'&&event.params?.threadId===threadId){
    turnStatus=event.params.turn?.status??'unknown';active=false;
    if(done){const fn=done;done=null;fn(turnStatus);}
  }
  if(method.startsWith('turn/')||method==='item/completed')safeLog({at:new Date().toISOString(),event:method,turnId:event.params?.turn?.id??turnId,status:event.params?.turn?.status});
});
let done=null;
const awaitTurn=()=>new Promise((resolve,reject)=>{
  if(turnStatus){resolve(turnStatus);return}
  done=resolve;
  setTimeout(()=>{if(done){done=null;reject(Error('App Server turn timed out'))}},timeoutSeconds*1000).unref();
});
async function main(){
  const init=await ask('initialize',{clientInfo:{name:'tips_app_agent',title:'Tips App Agent',version:'0.1.0'}},12000);
  if(!init)throw Error('Initialization failed');
  emit({method:'initialized',params:{}});
  const session=stored();
  const previousThreadId=session?.threadId??null;
  const needsFullProtocol=shouldInjectProtocol(session);
  const thread=previousThreadId?await ask('thread/resume',{threadId:previousThreadId,cwd:params.cwd,model:params.model,
    sandbox:params.sandbox,approvalPolicy:'never'},25000):await ask('thread/start',{
    cwd:params.cwd,model:params.model,sandbox:params.sandbox,approvalPolicy:'never'},25000);
  threadId=thread.thread?.id;
  if(!threadId)throw Error('App Server did not return a thread id');
  store(threadId,!needsFullProtocol);
  console.log('App Server ready:',params.name,'thread:',threadId,'resumed:',Boolean(previousThreadId));
  if(params.probe)return;
  let prompt=readFileSync(params.promptFile,'utf8');
  prompt+='\n'+subResearchLoopPrompt(params.name);
  prompt+='\n'+taskBoardDigest(tips.snapshot(),{role:'sub',agentId:params.name,limit:4})+'\n';
  prompt+=`\nTips progress required: the user reads ONLY /tips, card ID ${params.name}. At real milestones use tips-cli update, or include a final <tips-actions> JSON property "progress":{"status":"running|blocked|completed","message":"evidence, current phase, next step"} (optional current+total if measurable). No guessed percentages; no extra Sol calls.\n`;
  // Existing persistent Codex Threads were initialized before wake escalation
  // existed. A short per-Turn reminder upgrades them without reinjecting the
  // full protocol or spending a separate model call.
  prompt+='\nTips Local Sub continuity: routine trusted updates to server-controller are batched for 10 minutes before a Sol wake; priority:high is reserved for genuine urgent decisions or failure circuits. Send one evidence-backed milestone when meaningful, not repeated pings. wake:false is purely passive. STOP/GPU/Owner gates remain binding.\n';
  const initial=await unreadMail();
  if(initial.length){
    prompt+='\nPending trusted mailbox messages:\n'
      +initial.slice().reverse().map(m=>'ID '+m.id+' FROM '+m.from+' SUBJECT '+m.subject+'\n'+m.body+
        (m.tracked?'\nTracked exchange: ACK and include a verdicts entry {id,verdict,note} after verifying, do not plain resolve.':'')).join('\n\n');
  }
  if(needsFullProtocol)prompt+='\n'+requiredMailboxInstructions;
  turnStatus=null;active=true;
  const started=await ask('turn/start',{threadId,model:params.model,
    input:[{type:'text',text:prompt}]},25000);
  turnId=started.turn?.id??turnId;
  if(!turnId)throw Error('App Server did not return a turn ID');
  if(needsFullProtocol)store(threadId,true);
  for(const m of initial){
    tips.messages({action:'delivered',id:m.id,turnId},{trustedWake:true});
    presented.set(m.id,m);
  }
  mailTimer=setInterval(()=>{void pushMail().catch(e=>console.error('Mailbox:',e.message))},4000);
  mailTimer.unref();
  const status=await awaitTurn();
  stopping=true;
  answer=finalizeActions(answer);
  if(params.outputFile)writeFileSync(params.outputFile,answer+'\n');
  console.log('App Server turn finished:',status,'thread:',threadId,'turn:',turnId);
  if(status!=='completed')process.exitCode=2;
}
main().catch(e=>{console.error('App Agent failed:',e.message);process.exitCode=1}).finally(()=>{
  stopping=true;if(mailTimer)clearInterval(mailTimer);
  proc.stdin.end();
  setTimeout(()=>{if(proc.exitCode===null)proc.kill('SIGTERM')},400).unref();
});
