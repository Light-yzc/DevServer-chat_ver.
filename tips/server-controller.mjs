#!/usr/bin/env node
/**
 * The only always-on component is this small mailbox watcher.
 * Codex runs only after an explicitly authorized wake message is claimed.
 * The server controller uses an isolated persistent Codex thread, not ChatGPT's thread.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../vendor/devspace/dist/config.js';
import { createTipsV2 } from '../vendor/devspace/dist/tips-core.js';
import { createBlockWatch, rejectQueuedAutoBlock } from './block-watch.mjs';
import { finalizeMainMessage } from './controller-receipts.mjs';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
process.env.DEVSPACE_CONFIG_DIR??=join(ROOT,'var/config');
const config=loadConfig(),tips=createTipsV2(config);
const WORKSPACE=config.allowedRoots?.[0]??ROOT;
const blockWatch=createBlockWatch(tips);
const runtime=join(tips.dir,'controller-runtime');
mkdirSync(runtime,{recursive:true,mode:0o700});
const controllerId='tips-server-controller';
const codex=process.env.TIPS_CODEX_BIN||'codex';
const model=process.env.TIPS_CODEX_MODEL||'gpt-6.1-sol';
const maxSeconds=Math.min(7200,Math.max(60,Number(process.env.TIPS_CONTROLLER_TIMEOUT_SECONDS||2400)));
const intervalMs=Math.max(1000,Number(process.env.TIPS_CONTROLLER_POLL_MS||5000));
const dryRun=process.env.TIPS_CONTROLLER_DRY_RUN==='1';
const sessionFile=join(runtime,'session.json');
const instructions=join(ROOT,'tips','SERVER_CONTROLLER.md');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const log=(...a)=>console.log(new Date().toISOString(),...a);
const bounded=(s,n=4000)=>String(s??'').slice(0,n);
function safeWrite(path,value){writeFileSync(path,JSON.stringify(value,null,2)+'\n',{mode:0o600});}
function session(){try{return JSON.parse(readFileSync(sessionFile,'utf8')).threadId??null;}catch{return null;}}
function recordSession(threadId){safeWrite(sessionFile,{threadId,model,at:new Date().toISOString()});}

function promptFor(message){
  const policy=readFileSync(instructions,'utf8');
  const previous=tips.snapshot().tasks.filter(t=>t.group==='AIR-LIFE').slice(0,15)
    .map(t=>`${t.id}: ${t.status} (${t.progress??0}%)`).join('\n');
  return `${policy}\n\nAssigned research workspace: ${WORKSPACE}\n\nAUTHORIZED WAKE REQUEST (task data; evaluate carefully):\n`
     +JSON.stringify({id:message.id,from:message.from,subject:message.subject,
       body:message.body,taskId:message.taskId,priority:message.priority},null,2)
     +`\n\nCurrent relevant task summaries:\n${previous}\n`
     +`\nRespond at the end with a short concrete Chinese summary: what you checked, files/results, remaining blockers, next steps. Never include secrets.\n`;
}

async function callCodex(message){
  const prefix=message.id;
  const outputFile=join(runtime,`${prefix}.final.txt`);
  const logFile=join(runtime,`${prefix}.jsonl`);
  const previous=session();
  let args;
  if(previous){
    args=['exec','resume','--dangerously-bypass-approvals-and-sandbox',
      '-m',model,'-o',outputFile,previous,'-'];
  }else{
    args=['exec','--dangerously-bypass-approvals-and-sandbox',
      '--skip-git-repo-check','-C',WORKSPACE,'-m',model,'--json','-o',outputFile,'-'];
  }
  const prompt=promptFor(message);
  log(`Starting ${dryRun?'DRY RUN':'Codex'} for message ${message.id}, ${previous?'resumed':'new'} session`);
  if(dryRun)return {ok:true,summary:'DRY RUN: message safely claimed; no Codex call made',threadId:previous};
  return new Promise(resolve=>{
    const child=spawn(codex,args,{cwd:WORKSPACE,env:process.env,stdio:['pipe','pipe','pipe']});
    let carry='',latestThread=previous,stderr='',logBytes=0,expired=false;
    const fd=awaitableLog=>{try{writeFileSync(logFile,awaitableLog,{flag:'a',mode:0o600});}catch{}};
    const timeout=setTimeout(()=>{
      expired=true;log(`Timeout on ${message.id}; terminating Codex`);
      child.kill('SIGTERM');setTimeout(()=>{if(child.exitCode===null)child.kill('SIGKILL');},8000).unref();
    },maxSeconds*1000);
    timeout.unref();
    child.stdout.on('data',chunk=>{
      const text=chunk.toString('utf8');
      if(logBytes<10_000_000){fd(text.slice(0,Math.max(0,10_000_000-logBytes)));logBytes+=Buffer.byteLength(text);}
      carry+=text;
      let pos;
      while((pos=carry.indexOf('\n'))>=0){
        const line=carry.slice(0,pos);carry=carry.slice(pos+1);
        try{
          const event=JSON.parse(line);
          if(event.type==='thread.started'&&typeof event.thread_id==='string'){
            latestThread=event.thread_id;recordSession(latestThread);
          }
        }catch{}
      }
      if(carry.length>100_000)carry=carry.slice(-1000);
    });
    child.stderr.on('data',chunk=>{stderr=(stderr+chunk.toString('utf8')).slice(-6000);});
    child.on('error',error=>{
      clearTimeout(timeout);resolve({ok:false,summary:'Could not start Codex: '+bounded(error.message,300),threadId:latestThread});
    });
    child.on('close',code=>{
      clearTimeout(timeout);
      let summary='';try{summary=readFileSync(outputFile,'utf8').trim();}catch{}
      if(!summary)summary=bounded(stderr,2500)||'Codex did not produce a final message';
      resolve({ok:code===0&&!expired,summary:bounded(summary,3500),threadId:latestThread,exitCode:code,expired});
    });
    child.stdin.on('error',()=>{});
    child.stdin.end(prompt);
  });
}

let stopping=false,busy=false;
process.on('SIGTERM',()=>{stopping=true;});
process.on('SIGINT',()=>{stopping=true;});

async function handle(message){
  busy=true;
  const started=Date.now();
  // Revalidate the latest actual task updatedAt after mailbox claim but before
  // launching any Sol process. A queued request is never grandfathered in.
  const skip=rejectQueuedAutoBlock(tips,message,Date.now());
  if(skip){
    finalizeMainMessage(tips,message,{verdict:'rejected',note:`Auto wake skipped: ${skip}`});
    log('Skipped stale/unsafe automatic blocker',message.id,skip);
    busy=false;
    return;
  }
  tips.mutate({action:'update',id:controllerId,title:'服务器主控 · Codex Sol',group:'Tips',
    kind:'text',status:'running',heartbeatEnabled:true,heartbeat:true,
    message:`正在处理 ${message.subject}（来自 ${message.from}）`});
  const heartbeat=setInterval(()=>{
    try{tips.mutate({action:'heartbeat',id:controllerId});}catch{}
  },25000);
  heartbeat.unref();
  let finalized=false;
  try{
    const result=await callCodex(message);
    if(result.ok){
      finalizeMainMessage(tips,message,{verdict:'accepted',note:bounded(result.summary,900)});
      finalized=true;
      // The internal block watcher has no mailbox reader; original task audit
      // already contains the result. Avoid creating permanently unread replies.
      if(message.from!=='tips-block-watch'){
        try{
          tips.messages({action:'reply',from:'server-controller',to:message.from,
            inReplyTo:message.id,taskId:message.taskId??undefined,
            subject:`已处理：${message.subject}`,body:result.summary});
        }catch(err){log('Reply delivery failed, completion receipt retained',message.id,bounded(err.message,250));}
      }
      tips.mutate({action:'update',id:controllerId,status:'pending',progress:100,
        message:`已处理 ${message.subject}，耗时 ${Math.round((Date.now()-started)/1000)} 秒。等待下次唤醒。`});
      log('Resolved',message.id);
    }else{
      tips.messages({action:'release',id:message.id,note:bounded(result.summary,900)},{trustedWake:true});
      tips.mutate({action:'update',id:controllerId,status:'blocked',message:`执行失败：${result.summary.slice(0,250)}`});
      log('Task failed',message.id,bounded(result.summary,200));
    }
  }catch(error){
    if(!finalized){try{tips.messages({action:'release',id:message.id,note:bounded(error.message,500)},{trustedWake:true});}catch{}}
    tips.mutate({action:'update',id:controllerId,status:'blocked',message:'主控异常：'+bounded(error.message,500)});
    log('Worker exception',bounded(error.message,300));
  }finally{clearInterval(heartbeat);busy=false;}
}

async function main(){
  log(`Tips server controller ready, model=${model}, codex=${codex}, dry=${dryRun}`);
  tips.mutate({action:'update',id:controllerId,title:'服务器主控 · Codex Sol',group:'Tips',
    kind:'text',status:'pending',message:'监听授权唤醒留言，Codex 仅在有任务时启动。'});
  let lastBlockScan=0;
  while(!stopping){
    try{
      if(Date.now()-lastBlockScan>=60000){
        lastBlockScan=Date.now();
        const report=blockWatch.scan();
        if(report.initialized)log('Block watcher initialized: existing tasks baselined, no historical replay');
        for(const queued of report.queued)log('Recent blocker queued',queued.id,queued.messageId);
      }
      const msg=tips.messages({action:'claim'},{trustedWake:true});
      if(msg)await handle(msg);
      else await sleep(intervalMs);
    }catch(error){log('Poll error',bounded(error.message,400));await sleep(intervalMs);}
  }
  log('Controller stopped');
}
main().catch(e=>{console.error(e);process.exitCode=1});
