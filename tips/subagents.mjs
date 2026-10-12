/** Persistent registry and safe request queue for Codex App Server subagents. */
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

const ID=/^sub-[a-z0-9][a-z0-9_.-]{0,57}$/;
const MODEL=new Set(['gpt-6-luna','gpt-6.1-sol']);
const SANDBOX=new Set(['read-only','workspace-write','danger-full-access']);
// Registered persistent identities are NOT simultaneous Codex processes.
// Parallel execution is independently capped by TIPS_SUBAGENT_MAX (default 2).
export const MAX_REGISTERED_SUBAGENTS=128;
const wait=new Int32Array(new SharedArrayBuffer(4));
const now=()=>new Date().toISOString();
const err=m=>{throw Error(m)};
function write(path,data){const tmp=path+'.'+process.pid+'.'+randomUUID()+'.tmp';try{writeFileSync(tmp,JSON.stringify(data,null,2)+'\n',{mode:0o600});renameSync(tmp,path)}finally{rmSync(tmp,{force:true})}}
function locked(dir,fn){const folder=join(dir,'.subagents.lock');let acquired=false;
  for(let i=0;i<150;i++){try{mkdirSync(folder,{mode:0o700});acquired=true;break}catch(e){if(e.code!=='EEXIST')throw e;Atomics.wait(wait,0,0,20)}}
  if(!acquired)err('Subagent registry busy');try{return fn()}finally{rmSync(folder,{recursive:true,force:true})}}
const valid=id=>typeof id==='string'&&ID.test(id);
const allowed=(path,roots)=>{
  const actual=realpathSync(path);
  const found=roots.some(root=>{const rel=relative(realpathSync(root),actual);return rel===''||(!rel.startsWith('..'+sep)&&rel!=='..'&&!rel.startsWith(sep))});
  if(!found)err('cwd must be within a DevSpace allowedRoot');return actual;
};
export function subagentRegistry(config,tips){
  const dir=join(tips.dir,'subagents');mkdirSync(dir,{recursive:true,mode:0o700});
  const file=join(dir,'registry.json');if(!existsSync(file))write(file,{version:1,agents:{}});
  const load=()=>JSON.parse(readFileSync(file,'utf8'));
  const modify=fn=>locked(dir,()=>{const db=load(),value=fn(db);write(file,db);return value});
  const get=id=>{if(!valid(id))err('Agent name must start with sub- (letters/digits/-/_)');return load().agents[id]??null};
  const list=()=>Object.values(load().agents).sort((a,b)=>(b.updatedAt??'').localeCompare(a.updatedAt??''));
  function start({name,goal,cwd,model='gpt-6-luna',sandbox='workspace-write',group='Subagents'}){
    if(!valid(name))err('name must start with sub- and contain 1..61 safe characters');
    if(typeof goal!=='string'||!goal.trim()||goal.length>16000)err('goal must be 1..16000 characters');
    if(!MODEL.has(model))err('Unsupported Codex model (use gpt-6-luna or gpt-6.1-sol)');
    if(!SANDBOX.has(sandbox))err('Invalid sandbox');
    if(typeof group!=='string'||group.length>70)err('Invalid group');
    const root=allowed(resolve(cwd??config.allowedRoots[0]),config.allowedRoots);
    const started=modify(db=>{
      let current=db.agents[name];
      if(current&&['queued','running','stopping'].includes(current.status))err('This subagent is already running or queued');
      if(current&&(current.model!==model||current.cwd!==root||current.sandbox!==sandbox))
        err('Existing agent has different model/cwd/sandbox; use a new name to isolate sessions');
      if(!current&&Object.keys(db.agents).length>=MAX_REGISTERED_SUBAGENTS)
        err(`Subagent registration cap of ${MAX_REGISTERED_SUBAGENTS} reached`);
      const jobId=randomUUID();
      const goalFile=join(dir,`${name}-${jobId}.goal.txt`);
      writeFileSync(goalFile,goal+'\n',{mode:0o600});
      const item={name,model,sandbox,cwd:root,group,status:'queued',jobId,goalFile,
        createdAt:current?.createdAt??now(),updatedAt:now(),startedAt:null,finishedAt:null,
        stopRequested:false,exitCode:null,pid:null,error:null,lastResult:current?.lastResult??'',
        revision:(current?.revision??0)+1};
      db.agents[name]=item;
      return publicAgent(item);
    });
    // Every new/renewed Local Sub request is immediately visible on /tips,
    // including the time spent QUEUED before an App Server process exists.
    // Lifecycle heartbeats/status are maintained by the manager thereafter.
    tips.mutate({action:'update',id:name,title:`Subagent · ${name}`,
      kind:'progress',group,status:'pending',progressMeasured:false,archived:false,
      message:`已排队 · ${model} · 等待 Local Sub Manager 分配执行`,
      details:goal.slice(0,2200),heartbeatEnabled:false},{trustedUpdate:true});
    return started;
  }
  function publicAgent(a){const {goalFile,...rest}=a;return rest;}
  function status(name){const item=get(name);return item?publicAgent(item):null}
  function stop(name){return modify(db=>{
    if(!valid(name))err('Invalid agent name');const item=db.agents[name];if(!item)err('Unknown agent');
    if(item.status==='queued'){item.status='stopped';item.finishedAt=now()}
    else if(item.status==='running'||item.status==='stopping'){item.status='stopping';item.stopRequested=true}
    item.updatedAt=now();return publicAgent(item);
  })}
  function remove(name){return modify(db=>{
    if(!valid(name))err('Invalid agent name');
    const item=db.agents[name];if(!item)err('Unknown subagent');
    if(['queued','running','stopping'].includes(item.status))err('Cannot remove an active/queued subagent; stop it and wait for a terminal state first');
    if(item.pid){
      // A stale registration may still correspond to a real process. Do not
      // detach a live process from the only registry that can stop it.
      try{process.kill(item.pid,0);err('Cannot remove an agent with a live PID')}catch(e){if(e.code!=='ESRCH')throw e}
    }
    // Detach the saved Codex Thread before making this name reusable. Keep a
    // timestamped archive so deletion does not silently resume the old thread.
    const threadFile=join(tips.dir,'app-agents',`${name}.json`);
    if(existsSync(threadFile)){
      const archive=join(tips.dir,'app-agents','retired');
      mkdirSync(archive,{recursive:true,mode:0o700});
      renameSync(threadFile,join(archive,`${name}-${randomUUID()}.json`));
    }
    delete db.agents[name];
    // Keep experiment artifacts, Tips history and Codex thread files intact.
    return {removed:true,name,status:item.status,retainedHistory:true};
  })}
  function update(name,jobId,fields){return modify(db=>{
    const item=db.agents[name];if(!item||item.jobId!==jobId)return null;
    Object.assign(item,fields,{updatedAt:now()});return publicAgent(item);
  })}
  function send({name,from='controller',subject='Subagent instruction',body,priority='normal'}){
    if(!get(name))err('Unknown subagent; create it first');
    if(typeof from!=='string'||from.length>80||!from.trim())err('Invalid sender');
    if(typeof body!=='string'||!body.trim()||body.length>6000)err('Invalid message body');
    return tips.messages({action:'post',from,to:name,subject,body,priority},{trustedWake:true});
  }
  return {dir,file,start,stop,remove,status,list,update,send,load};
}
