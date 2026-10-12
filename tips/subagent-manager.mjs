#!/usr/bin/env node
/** Tiny long-lived launcher. Model inference only runs for jobs or trusted mail. */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, openSync, closeSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../vendor/devspace/dist/config.js';
import { createTipsV2 } from '../vendor/devspace/dist/tips-core.js';
import { subagentRegistry } from './subagents.mjs';
import { needsDelivery } from './subagent-protocol.mjs';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
process.env.DEVSPACE_CONFIG_DIR??=join(ROOT,'var/config');
const config=loadConfig(),tips=createTipsV2(config),registry=subagentRegistry(config,tips);
const NODE=process.execPath;
const POLL=Math.max(1000,Number(process.env.TIPS_SUBAGENT_POLL_MS)||3000);
const MAX=Math.min(4,Math.max(1,Number(process.env.TIPS_SUBAGENT_MAX)||2));
const active=new Map();let stopping=false,lastHeartbeat=0;
const log=(...a)=>console.log(new Date().toISOString(),...a);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

function publish(item,status,message){
  try{
    const existing=tips.mutate({action:'get',id:item.name});
    const finalStatus=status==='completed'&&existing?.status==='blocked'?'blocked':status;
    tips.mutate({action:'update',id:item.name,title:`Subagent · ${item.name}`,
    group:item.group||'Subagents',kind:'progress',status:finalStatus,
    message:status==='completed'&&finalStatus==='blocked'?existing.message:
      status==='completed'?`本轮 Codex 执行结束（科研任务须进一步验收）· ${message}`:message,
    heartbeatEnabled:status==='running',
    ...(status==='running'?{heartbeat:true}:{})},{trustedUpdate:true});}catch(e){log('tips status failed',e.message)}
}
function final(name,jobId,code,signal){
  const current=registry.status(name);if(!current||current.jobId!==jobId)return;
  const isStop=current.stopRequested||current.status==='stopping';
  const status=isStop?'stopped':code===0?'completed':'failed';
  const resultPath=join(registry.dir,`${name}-${jobId}.last.txt`);
  let result='';try{result=readFileSync(resultPath,'utf8').slice(-4000)}catch{}
  const updated=registry.update(name,jobId,{status,pid:null,finishedAt:new Date().toISOString(),
    exitCode:code,error:signal??(status==='failed'?`exit ${code}`:null),lastResult:result});
  active.delete(name);
  if(updated){
    publish(updated,isStop?'cancelled':status==='completed'?'completed':'failed',
      status==='completed'?(result.trim().slice(0,1500)||'App Server turn completed'):
      isStop?'Subagent stopped by controller':`App Server failed: ${signal||code}`);
    log('job finished',name,jobId,status,'exit',code,signal??'');
  }
}
function launch(item){
  const {name,jobId}=item;
  const logPath=join(registry.dir,`${name}-${jobId}.stdout.log`);
  const outPath=join(registry.dir,`${name}-${jobId}.last.txt`);
  const eventPath=join(registry.dir,`${name}-${jobId}.events.jsonl`);
  const fd=openSync(logPath,'a',0o600);
  const args=[join(ROOT,'tips/app-agent.mjs'),'--name',name,'--model',item.model,'--cwd',item.cwd,
    '--sandbox',item.sandbox,'--prompt-file',item.goalFile,'--output-last-message',outPath,'--log',eventPath];
  let child;
  try{child=spawn(NODE,args,{cwd:item.cwd,env:{...process.env,DEVSPACE_CONFIG_DIR:process.env.DEVSPACE_CONFIG_DIR,
    TIPS_AGENT_ID:name},detached:true,stdio:['ignore',fd,fd]});}
  finally{closeSync(fd);}
  if(!child.pid){log('spawn failed',name);registry.update(name,jobId,{status:'failed',error:'Could not spawn Node process'});return;}
  active.set(name,{child,jobId,stopAt:null});
  registry.update(name,jobId,{pid:child.pid,status:'running',startedAt:new Date().toISOString(),stopRequested:false,
    logPath,resultPath:outPath});
  publish(item,'running',`App Server ${item.model} thread started · ${item.cwd}`);
  log('started',name,jobId,'pid',child.pid,'model',item.model,'sandbox',item.sandbox);
  let exited=false;
  const finished=(code,signal)=>{if(exited)return;exited=true;final(name,jobId,code,signal)};
  child.on('error',err=>{log('child error',name,err.message);finished(1,err.message)});
  child.on('close',(code,signal)=>finished(code,signal));
}

function scan(){
  const jobs=registry.list();
  const checkHeartbeat=Date.now()-lastHeartbeat>=30000;
  if(checkHeartbeat)lastHeartbeat=Date.now();
  for(const job of jobs){
    if(!active.has(job.name)&&['running','stopping'].includes(job.status)){
      // Orphaned pid from manager crash/service restart; don't spawn a duplicate.
      let alive=false;try{if(job.pid){process.kill(job.pid,0);alive=true}}catch{}
      if(!alive){registry.update(job.name,job.jobId,{status:'interrupted',pid:null,error:'Manager restarted while agent was active'});
        publish(job,'blocked','Agent was interrupted. Resume via MCP subagent start with the same name.');}
    }
    const item=active.get(job.name);
    if(item&&job.stopRequested&&item.stopAt===null){
      item.stopAt=Date.now();
      // Manager owns this dedicated process group; never signal an unrelated PID.
      try{process.kill(-item.child.pid,'SIGTERM')}catch(e){log('stop signal error',job.name,e.message)}
    }
    if(item&&item.stopAt&&Date.now()-item.stopAt>10_000){try{process.kill(-item.child.pid,'SIGKILL')}catch{}}
    if(item&&job.status==='running'&&checkHeartbeat){
      // Updating heartbeat is independent from task updatedAt/freshness.
      try{tips.mutate({action:'heartbeat',id:job.name})}catch{}
    }
  }
  let available=MAX-active.size;
  for(const job of jobs.filter(j=>j.status==='queued')){
    if(available<=0)break;
    launch(job);available--;
  }
  if(available>0){
    for(const job of jobs){
      if(available<=0)break;
      if(!['completed','failed','interrupted','stopped'].includes(job.status)||active.has(job.name))continue;
      const unread=tips.messages({action:'list',to:job.name,limit:80})
        .filter(m=>needsDelivery(m));
      if(!unread.length)continue;
      try{
        const subject=unread.slice(0,6).map(m=>`${m.subject} (${m.id})`).join('; ');
        registry.start({name:job.name,goal:`You have trusted Tips mailbox messages waiting: ${subject}. Read the full content included in this turn, ACK only after you actually read each message, then reply with findings and resolve messages you handled. Do not start unrelated GPU runs or override stop gates.`,
          cwd:job.cwd,model:job.model,sandbox:job.sandbox,group:job.group});
        available--;log('queued mailbox wake',job.name,unread.length);
      }catch(e){log('mailbox wake failed',job.name,e.message)}
    }
  }
}

process.on('SIGTERM',()=>{stopping=true});process.on('SIGINT',()=>{stopping=true});
async function main(){
  log('subagent manager ready','max',MAX,'poll',POLL);
  while(!stopping){try{scan()}catch(e){log('scan failed',e.stack?.slice(0,600)||e.message)}await sleep(POLL)}
  // With systemd's KillMode=control-group, child process groups are stopped as well.
  log('subagent manager stopping');
}
main().catch(e=>{console.error(e);process.exitCode=1});
