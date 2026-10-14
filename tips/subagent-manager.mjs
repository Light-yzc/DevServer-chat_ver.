#!/usr/bin/env node
/** Tiny long-lived launcher. Model inference only runs for jobs or trusted mail. */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, openSync, closeSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../vendor/devspace/dist/config.js';
import { createTipsV2 } from '../vendor/devspace/dist/tips-core.js';
import { subagentRegistry } from './subagents.mjs';
import { needsDelivery } from './subagent-protocol.mjs';
import {boundedTaskMessage} from './task-result-text.mjs';
import {emitResearchMilestone} from './subagent-handoff.mjs';
import {beginGitEvidence,finishGitEvidence,writeSubHandoff} from './subagent-evidence.mjs';
import {inspectDocumentation,compareDocumentation} from './document-freshness.mjs';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
process.env.DEVSPACE_CONFIG_DIR??=join(ROOT,'var/config');
const config=loadConfig(),tips=createTipsV2(config),registry=subagentRegistry(config,tips);
const NODE=process.execPath;
const POLL=Math.max(1000,Number(process.env.TIPS_SUBAGENT_POLL_MS)||3000);
const MAX=Math.min(4,Math.max(1,Number(process.env.TIPS_SUBAGENT_MAX)||2));
const active=new Map();let stopping=false,lastHeartbeat=0;
const reconciledReports=new Set();
const log=(...a)=>console.log(new Date().toISOString(),...a);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

function publish(item,status,message,sourcePath=''){
  try{
    const existing=tips.mutate({action:'get',id:item.name});
    const finalStatus=status==='completed'&&existing?.status==='blocked'?'blocked':status;
    tips.mutate({action:'update',id:item.name,title:`Subagent · ${item.name}`,
    group:item.group||'Subagents',kind:'progress',status:finalStatus,
    message:boundedTaskMessage(status==='completed'&&finalStatus==='blocked'?existing.message:
      status==='completed'?`本轮 Codex 执行结束（科研任务须进一步验收）· ${message}`:message,{sourcePath}),
    heartbeatEnabled:status==='running',
    ...(status==='running'?{heartbeat:true}:{})},{trustedUpdate:true});}catch(e){log('tips status failed',e.message)}
}
function final(name,jobId,code,signal){
  const current=registry.status(name);if(!current||current.jobId!==jobId)return;
  const isStop=current.stopRequested||current.status==='stopping';
  const status=isStop?'stopped':code===0?'completed':'failed';
  const resultPath=join(registry.dir,`${name}-${jobId}.last.txt`);
  let result='';try{result=readFileSync(resultPath,'utf8')}catch{}
  let gitEvidence=null;
  try{gitEvidence=finishGitEvidence({dir:registry.dir,name,jobId,cwd:current.cwd})}
  catch(error){log('git evidence finalize failed',name,error.message)}
  let docsReview=null;
  try{
    const beforeFile=join(registry.dir,`${name}-${jobId}.docs-start.json`);
    const previous=existsSync(beforeFile)?JSON.parse(readFileSync(beforeFile,'utf8')):null;
    const after=inspectDocumentation(current.cwd);
    docsReview=compareDocumentation(previous,after,{workspaceChanged:Boolean(
      gitEvidence?.workingDiffChanged||gitEvidence?.headChanged)});
    docsReview.observedDocs=after.docs??[];
    const outFile=join(registry.dir,`${name}-${jobId}.documentation.json`);
+    writeFileSync(outFile,JSON.stringify(docsReview,null,2)+'\n',{mode:0o600});
  }catch(error){log('documentation freshness finalization failed',name,error.message)}
  const finishedAt=new Date().toISOString();
  let report=null;
  try{const task=tips.mutate({action:'get',id:name});
    report=writeSubHandoff({dir:registry.dir,name,jobId,status,exitCode:code,
      startedAt:current.startedAt,finishedAt,requestedBy:current.reportTo??task?.owner,
      goal:existsSync(join(registry.dir,`${name}-${jobId}.goal.txt`))?
        readFileSync(join(registry.dir,`${name}-${jobId}.goal.txt`),'utf8'): '',
      result,gitEvidence,documentation:docsReview});
  }catch(error){log('structured handoff failed',name,error.message)}
  const updated=registry.update(name,jobId,{status,pid:null,finishedAt,
    exitCode:code,error:signal??(status==='failed'?`exit ${code}`:null),lastResult:result.slice(-4000),
    gitEvidencePath:gitEvidence?join(registry.dir,`${name}-${jobId}.git-end.json`):null,
    handoffPath:report?join(registry.dir,`${name}-${jobId}.handoff.json`):null});
  active.delete(name);
  if(updated){
    publish(updated,isStop?'cancelled':status==='completed'?'completed':updated.failureCircuitOpen?'blocked':'failed',
      status==='completed'?(result.trim()||'App Server turn completed'):
      isStop?'Subagent stopped by controller':updated.failureCircuitOpen?
      `连续 ${updated.consecutiveFailures} 次模型执行失败，已暂停自动派工。需审查 ${resultPath} 和 stdout/events 日志，管理员记录原因并复位。退出码 ${code}。`:
      `App Server failed: ${signal||code}`,
      status==='completed'?resultPath:'');
    try{emitResearchMilestone(tips,{name,jobId,group:updated.group,
      startedAt:updated.startedAt,resultPath,resultExcerpt:result.slice(0,1200),gitEvidence,
      status,owner:report?.requestedBy,reportPath:updated.handoffPath})}
    catch(error){log('milestone handoff failed',name,error.message)}
    if(updated.failureCircuitOpen&&current.failureCircuitOpen!==true){
      // Exactly one high-value Sol escalation per newly-opened circuit.
      // It requests diagnosis only; does not reset or re-run the failed job.
      try{tips.messages({action:'post',from:'tips-subagent-manager',to:'server-controller',
        subject:`Subagent 失败熔断 · ${name}`,priority:'high',wake:true,taskId:name,
        body:`${name} 已连续 ${updated.consecutiveFailures} 次模型执行失败（本轮 exit ${code}），暂停自动派工。请检查结果 ${resultPath} 与 ${updated.logPath??'stdout log'}，安排安全 CPU/日志根因诊断。不得自动复位或重试；若需重试，由管理员记录诊断后单独复位。`},{trustedWake:true});}
      catch(error){log('failure circuit notification failed',name,error.message)}
    }
    log('job finished',name,jobId,status,'exit',code,signal??'');
  }
}
function launch(item){
  const {name,jobId}=item;
  const logPath=join(registry.dir,`${name}-${jobId}.stdout.log`);
  const outPath=join(registry.dir,`${name}-${jobId}.last.txt`);
  const eventPath=join(registry.dir,`${name}-${jobId}.events.jsonl`);
  try{beginGitEvidence({dir:registry.dir,name,jobId,cwd:item.cwd})}
  catch(error){log('git evidence snapshot failed',name,error.message)}
  try{
    writeFileSync(join(registry.dir,`${name}-${jobId}.docs-start.json`),
      JSON.stringify(inspectDocumentation(item.cwd),null,2)+'\n',{mode:0o600});
  }catch(error){log('documentation snapshot failed',name,error.message)}
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
  // Crash-safe outbox reconciliation: completed Jobs with a saved report get
  // their delivery checked once after Manager restart. Per-job, per-recipient
  // mail dedupe lives in emitResearchMilestone; no model execution is needed.
  for(const job of jobs){
    if(!['completed','failed','stopped'].includes(job.status)||!job.handoffPath||
      !existsSync(job.handoffPath)||reconciledReports.has(job.jobId))continue;
    try{
      const report=JSON.parse(readFileSync(job.handoffPath,'utf8'));
      if(report.jobId!==job.jobId||report.name!==job.name)continue;
      const mail=emitResearchMilestone(tips,{name:job.name,jobId:job.jobId,group:job.group,
        startedAt:job.startedAt,resultPath:report.evidence?.result,
        resultExcerpt:report.summary,gitEvidence:report.git,status:job.status,
        owner:report.requestedBy,reportPath:job.handoffPath});
      reconciledReports.add(job.jobId);
      if(mail)log('reconciled undelivered handoff',job.name,job.jobId);
    }catch(error){log('handoff reconciliation deferred',job.name,error.message)}
  }
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
      if(job.failureCircuitOpen){
        // A genuinely failed Codex Turn needs a root-cause review, not another
        // model wake from the same unread inbox. No retries until explicit
        // management reset; leave the original mail unread for diagnosis.
        continue;
      }
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
