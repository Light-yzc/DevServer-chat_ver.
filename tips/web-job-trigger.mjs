/** User-owned Web Chat background command → durable Tips completion trigger.
 * This is NOT a managed subagent, a new MCP tool or a browser-side wake API.
 * Worker lifecycle and evidence live under the private Tips state directory.
 */
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync,renameSync,existsSync,openSync,closeSync,readdirSync,rmSync,realpathSync,statSync} from 'node:fs';
import {join,resolve,relative,isAbsolute} from 'node:path';

const JOB_ID=/^webjob-[a-z0-9][a-z0-9_.-]{2,75}$/;
const WEB_ID=/^web-[a-z0-9][a-z0-9_.-]{0,58}$/;
const TERMINAL=new Set(['completed','failed','lost']);
const stamp=()=>new Date().toISOString();
function atomicJSON(path,value){const temporary=path+'.'+process.pid+'.tmp';
  try{writeFileSync(temporary,JSON.stringify(value,null,2)+'\n',{mode:0o600,flag:'wx'});renameSync(temporary,path)}
  finally{rmSync(temporary,{force:true})}
}
function readJSON(path){return existsSync(path)?JSON.parse(readFileSync(path,'utf8')):null}
function dirs(stateDir,id){if(!JOB_ID.test(id))throw Error('Invalid webjob-* ID');
  const dir=join(stateDir,'tips','web-jobs',id);
  return {dir,manifest:join(dir,'job.json'),launch:join(dir,'launch.json'),result:join(dir,'result.json'),log:join(dir,'output.log'),delivery:join(dir,'delivery.json')};}
function isClaimed(identities,role){if(!WEB_ID.test(role))throw Error('Invalid Web recipient');
  const entry=identities.list().find(r=>r.id===role);
  if(entry?.status!=='claimed'||!(Date.parse(entry.leaseExpiresAt)>Date.now()))
    throw Error('Web recipient must be claimed with a non-expired lease');}
export function startWebJob({stateDir,allowedRoots,identities,runWorker,to,id,
  title,cwd,command,args=[],timeoutSec=0}){
  isClaimed(identities,to);
  if(typeof title!=='string'||!title.trim()||title.length>140)throw Error('Title must be 1–140 characters');
  if(typeof cwd!=='string'||!isAbsolute(cwd)||!existsSync(cwd)||!statSync(cwd).isDirectory())throw Error('Existing absolute --cwd directory required');
  if(typeof command!=='string'||!command.trim()||command.length>500)throw Error('A command is required');
  if(!Array.isArray(args)||args.length>150||args.some(a=>typeof a!=='string'||a.length>2500))throw Error('Invalid command arguments');
  if(!Number.isInteger(timeoutSec)||timeoutSec<0||timeoutSec>604800)throw Error('Invalid timeout');
  id??='webjob-'+randomUUID();
  const p=dirs(stateDir,id);
  const normalizedCwd=realpathSync(cwd);
  if(Array.isArray(allowedRoots)&&allowedRoots.length&&!allowedRoots.some(root=>{
    const distance=relative(realpathSync(root),normalizedCwd);
    return distance===''||(!distance.startsWith('..')&&!isAbsolute(distance));
  }))throw Error('Working directory is outside DevSpace allowedRoots');
  mkdirSync(join(stateDir,'tips','web-jobs'),{recursive:true,mode:0o700});
  try{mkdirSync(p.dir,{mode:0o700})}
  catch(e){if(e.code!=='EEXIST')throw e;
    const original=readJSON(p.manifest);
    if(!original||original.to!==to||original.title!==title.trim()||original.cwd!==normalizedCwd||original.command!==command||
      JSON.stringify(original.args)!==JSON.stringify(args))throw Error('Job ID already used with different parameters');
    return {id,existing:true,to,status:readJSON(p.result)?.status??'running',log:p.log};
  }
  const job={id,to,from:'web-owned-background-job',title:title.trim(),cwd:normalizedCwd,command,args,timeoutSec,createdAt:stamp()};
  atomicJSON(p.manifest,job);
  try{
    const child=runWorker(id);
    if(!Number.isInteger(child?.pid)||child.pid<1)throw Error('Background worker failed to start');
    atomicJSON(p.launch,{pid:child.pid,startedAt:stamp()});
    return {id,to,status:'running',workerPid:child.pid,log:p.log,existing:false};
  }catch(e){
    const result={id,status:'failed',finishedAt:stamp(),error:`Worker launch failed: ${e.code??e.message}`,exitCode:null};
    atomicJSON(p.result,result);
    return {id,to,status:'failed',launchError:true,log:p.log};
  }
}
export function jobStatus(stateDir,id){const p=dirs(stateDir,id),job=readJSON(p.manifest);
  if(!job)return null;
  const result=readJSON(p.result),launch=readJSON(p.launch);
  return {id:job.id,title:job.title,to:job.to,cwd:job.cwd,delivery:readJSON(p.delivery),
    status:result?.status??'running',createdAt:job.createdAt,startedAt:launch?.startedAt??null,
    finishedAt:result?.finishedAt??null,exitCode:result?.exitCode??null,
    error:result?.error??null,workerPid:launch?.pid??null,log:p.log};
}
export function runBackgroundJob({stateDir,id,spawnCommand=spawn}){
  const p=dirs(stateDir,id),job=readJSON(p.manifest);
  if(!job)throw Error('Unknown background job');
  const log=openSync(p.log,'a',0o600);
  let child=null,timeout=null,expired=false,finished=false;
  const finish=async(code,signal,error)=>{
    if(finished)return;finished=true;if(timeout)clearTimeout(timeout);
    closeSync(log);
    const result={id,status:code===0&&!signal&&!error?'completed':'failed',
      exitCode:typeof code==='number'?code:null,signal:signal??null,
      error:error??(expired?'Job timed out':null),finishedAt:stamp()};
    atomicJSON(p.result,result);
    return result;
  };
  return new Promise(resolve=>{
    try{
      child=spawnCommand(job.command,job.args,{cwd:job.cwd,stdio:['ignore',log,log],env:process.env});
      child.once('error',e=>void finish(null,null,`Command start failed: ${e.code??e.message}`).then(resolve));
      child.once('close',(code,signal)=>void finish(code,signal,expired?'Job timed out':null).then(resolve));
      if(job.timeoutSec>0)timeout=setTimeout(()=>{expired=true;child.kill('SIGTERM');
        setTimeout(()=>{if(!finished)child.kill('SIGKILL')},5000).unref();},job.timeoutSec*1000);
    }catch(e){void finish(null,null,`Command start failed: ${e.message}`).then(resolve)}
  });
}
export function deliverJob({stateDir,id,tips}){
  const p=dirs(stateDir,id),job=readJSON(p.manifest),result=readJSON(p.result);
  if(!job||!result||!TERMINAL.has(result.status))return {id,delivered:false,reason:'not_terminal'};
  const existing=readJSON(p.delivery);
  if(existing)return {id,delivered:false,alreadyDelivered:true,messageId:existing.messageId};
  const success=result.status==='completed';
  // No CLI command, environment, token, or untrusted log is copied to Tips.
  const body=`Web 后台任务 ${job.id} ${success?'完成':'失败/失联'}。标题：${job.title}；结束状态：${result.status}；退出码：${result.exitCode??'unknown'}；`+
    `结果/错误：${String(result.error??'无').slice(0,190)}；结束时间：${result.finishedAt}。`+
    `请查看本地任务记录及日志：${p.log}；使用 web-job-trigger status ${job.id} 核验。`+
    '核对最新科研 Owner、STOP/GPU 门禁后再决定是否继续或重跑；不要把退出码 0 视为科研成功。';
  const message=tips.messages({action:'post',from:'tips-web-job-trigger',to:job.to,
    subject:`[Web background ${success?'completed':'failed'}] ${job.id}`,
    body,priority:success?'normal':'high',dedupeKey:`web-job:${job.id}:terminal`},
    {trustedWake:true});
  atomicJSON(p.delivery,{messageId:message.id,deliveredAt:stamp(),to:job.to});
  return {id,delivered:true,messageId:message.id,status:result.status,to:job.to};
}
export function reconcileJobs({stateDir,tips}){
  const root=join(stateDir,'tips','web-jobs');if(!existsSync(root))return {total:0,delivered:0,lost:0,errors:[]};
  const ids=readdirSync(root).filter(id=>JOB_ID.test(id));
  const report={total:ids.length,delivered:0,lost:0,errors:[]};
  for(const id of ids){
    try{
      const p=dirs(stateDir,id),job=readJSON(p.manifest),result=readJSON(p.result);
      if(!job)continue;
      if(!result){
        const launch=readJSON(p.launch);
        // Give a newly launched worker a grace period to record its PID.
        if(!launch&&Date.now()-Date.parse(job.createdAt)<120_000)continue;
        if(launch?.pid&&processExists(launch.pid,id))continue;
        atomicJSON(p.result,{id,status:'lost',exitCode:null,finishedAt:stamp(),error:'Background supervisor disappeared; actual command outcome unknown'});
        report.lost++;
      }
      const delivered=deliverJob({stateDir,id,tips});if(delivered.delivered)report.delivered++;
    }catch(e){report.errors.push({id,error:String(e.message).slice(0,190)})}
  }
  return report;
}
function processExists(pid,id){if(!Number.isInteger(pid)||pid<1)return false;
  try{
    process.kill(pid,0);
    // On Linux, avoid treating an unrelated reused PID as this supervisor.
    const proc=`/proc/${pid}/cmdline`;
    if(existsSync(proc)){
      const cmd=readFileSync(proc,'utf8');
      return cmd.includes('web-job-cli.mjs\0worker\0'+id+'\0');
    }
    return true;
  }catch(e){return e.code==='EPERM'}
}
