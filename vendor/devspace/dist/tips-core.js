// Durable Tips vNext state and mailbox. No external packages, no extra port.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const STATES = new Set(['pending','running','completed','blocked','failed','cancelled','paused']);
const KINDS = new Set(['progress','text','metric','checklist','log','table','link','chart']);
const ID = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/;
const now = () => new Date().toISOString();
const json = path => JSON.parse(readFileSync(path,'utf8'));
const sleepArray = new Int32Array(new SharedArrayBuffer(4));
const validID = id => typeof id === 'string' && ID.test(id);
// Attests that an actionable block came from a separately authorized source.
// A regular HTTPS write may report a block, but cannot authorize Sol execution.
function blockEvidenceDigest(task) {
  return createHash('sha256').update(JSON.stringify({status:task.status,
    title:task.title,message:task.message,details:task.details,updatedAt:task.updatedAt})).digest('hex');
}
function fail(message) { throw new Error(message); }
function string(value, field, max=800) {
  if (typeof value !== 'string' || value.length > max) fail(`${field}: max ${max} character string required`);
  return value;
}
function writeAtomic(file, data) {
  const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temp,JSON.stringify(data,null,2)+'\n',{mode:0o600});
    renameSync(temp,file);
  } finally { rmSync(temp,{force:true}); }
}
function withLock(dir, callback) {
  const lock=join(dir,'.write.lock');
  let acquired=false;
  for (let attempt=0;attempt<250;attempt++) {
    try { mkdirSync(lock,{mode:0o700}); acquired=true; break; }
    catch(e) {
      if(e.code!=='EEXIST')throw e;
      // A terminated process must not lock this JSON state forever.
      try { if(Date.now()-statSync(lock).mtimeMs>30000)rmSync(lock,{recursive:true,force:true}); } catch{}
      Atomics.wait(sleepArray,0,0,20);
    }
  }
  if(!acquired)fail('Tips state is busy; retry shortly');
  try{return callback();}finally{rmSync(lock,{recursive:true,force:true});}
}
function stateDefault(){return {tasks:{},events:[],history:{},messages:[]};}
function upgrade(state) {
  state.tasks??={};state.events??=[];state.messages??=[];
  if(!state.history){
    state.history={};
    for(const e of [...state.events].reverse()){
      (state.history[e.id]??=[]).push({at:e.at,status:e.status,progress:e.progress,message:e.message||''});
    }
  }
  return state;
}
function health(task, clock=Date.now()){
  if(task.status!=='running')return 'inactive';
  if(!task.heartbeatEnabled)return 'untracked';
  if(!task.lastHeartbeatAt)return 'waiting';
  const age=clock-Date.parse(task.lastHeartbeatAt);
  return Number.isFinite(age)&&age>(task.heartbeatTimeoutSec??300)*1000?'stale':'healthy';
}
function inferredGroup(task){
  if(task.group)return task.group;
  const id=task.id??'';
  if(id.startsWith('air-life'))return 'AIR-LIFE';
  if(id.startsWith('air-paper'))return 'AIR / Paper';
  if(id.startsWith('air-'))return 'AIR / Other';
  if(id.startsWith('tips-'))return 'Tips';
  return '未分组';
}
function shown(task){return {...task,group:inferredGroup(task),health:health(task),dependencyIds:task.dependsOn??[]};}

export function createTipsV2(config){
  const dir=join(config.stateDir,'tips');
  mkdirSync(dir,{recursive:true,mode:0o700});chmodSync(dir,0o700);
  const stateFile=join(dir,'state.json'),secretsFile=join(dir,'credentials.json');
  if(!existsSync(secretsFile))writeAtomic(secretsFile,config.security?.tips??{viewToken:randomBytes(24).toString('hex'),writeToken:randomBytes(32).toString('hex')});
  if(!existsSync(stateFile))writeAtomic(stateFile,stateDefault());
  // Compatibility with existing local Tips CLI/Python clients: keep the
  // legacy credential *copy* synchronized from the new single source of truth.
  if(config.security?.tips){
    withLock(dir,()=>{
      const legacy=json(secretsFile);
      if(['viewToken','writeToken','dispatchToken'].some(k=>legacy[k]!==config.security.tips[k])){
        writeAtomic(secretsFile,{...legacy,...config.security.tips});
      }
    });
  }
  const credentials=config.security?.tips ? {...config.security.tips} : json(secretsFile);
  if(!credentials.dispatchToken){
    withLock(dir,()=>{
      const latest=json(secretsFile);
      if(!latest.dispatchToken){latest.dispatchToken=randomBytes(32).toString('hex');writeAtomic(secretsFile,latest);}
      Object.assign(credentials,latest);
    });
  }
  const read=()=>upgrade(json(stateFile));
  const edit=fn=>withLock(dir,()=>{const s=read();const ret=fn(s);writeAtomic(stateFile,s);return ret;});
  function snapshot(){
    const s=read(), tasks=Object.values(s.tasks).map(shown).sort((a,b)=>(b.updatedAt||'').localeCompare(a.updatedAt||''));
    const groups={};
    for(const t of tasks){const name=t.group||'未分组',g=groups[name]??={name,total:0,completed:0,running:0,problem:0};g.total++;if(t.status==='completed')g.completed++;if(t.status==='running')g.running++;if(['failed','blocked'].includes(t.status)||t.health==='stale')g.problem++;}
    return {updatedAt:s.events[0]?.at??null,tasks,groups:Object.values(groups),events:s.events.slice(0,50),
      mailbox:{
        total:s.messages.length,
        unreadController:s.messages.filter(m=>['controller','server-controller'].includes(m.to)&&m.status==='unread').length,
        passiveMain:s.messages.filter(m=>m.to==='server-controller'&&m.status==='unread'&&!m.wakeAuthorized).length,
        authorizedMain:s.messages.filter(m=>m.to==='server-controller'&&m.status==='unread'&&m.wakeAuthorized).length,
        legacyController:s.messages.filter(m=>m.to==='controller'&&m.status==='unread').length,
      },
      capabilities:{heartbeat:true,group:true,history:true,messages:true,notifications:true}};
  }
  function mutate(input={},context={}){
    if(!input||typeof input!=='object'||Array.isArray(input))fail('Expected an object');
    const {action='list',id}=input;
    if(action==='list')return snapshot();
    if(!validID(id))fail('Task id must be 1–64 letters, digits, . _ or -');
    if(action==='get'){const task=read().tasks[id];return task?shown(task):null;}
    if(action==='history')return (read().history[id]??[]).slice(-Math.min(300,Math.max(1,Number(input.limit)||100)));
    if(!['update','heartbeat','delete','archive'].includes(action))fail('Invalid action');
    return edit(s=>{
      if(action==='delete'){
        if(!s.tasks[id])return {deleted:false,id};
        delete s.tasks[id];delete s.history[id];
        s.events.unshift({id,at:now(),status:'deleted'});s.events=s.events.slice(0,500);
        return {deleted:true,id};
      }
      if(action==='archive'){
        if(!s.tasks[id])fail('Unknown task');
        s.tasks[id].archived=input.archived!==false;
        return shown(s.tasks[id]);
      }
      if(action==='heartbeat'){
        if(!s.tasks[id])fail('Unknown task: create it using action=update first');
        const task=s.tasks[id];
        task.lastHeartbeatAt=now();task.heartbeatEnabled=true;task.staleNotifiedAt=null;
        // Heartbeats deliberately do not pollute event/history/updatedAt.
        return shown(task);
      }
      const old=s.tasks[id]??{id,createdAt:now(),status:'pending',progress:0,kind:'progress'};
      const t={...old};
      for(const key of ['title','message','details','group']){
        if(input[key]!==undefined)t[key]=string(input[key],key,key==='details'?4000:key==='group'?80:1500);
      }
      if(input.kind!==undefined){if(!KINDS.has(input.kind))fail('Invalid kind');t.kind=input.kind;}
      if(input.status!==undefined){if(!STATES.has(input.status))fail('Invalid status');t.status=input.status;}
      // Internal Local Sub queueing explicitly declares that a meaningful
      // denominator does not exist yet. Never show a fabricated 0% on Tips.
      if(input.progressMeasured===false&&context.trustedUpdate===true)t.progressMeasured=false;
      if(input.progress!==undefined){if(!Number.isInteger(input.progress)||input.progress<0||input.progress>100)fail('Invalid progress');t.progress=input.progress;t.progressMeasured=true;}
      for(const key of ['current','total']){
        if(input[key]!==undefined){if(typeof input[key]!=='number'||!Number.isFinite(input[key])||input[key]<0)fail('Invalid '+key);t[key]=input[key];}
      }
      if(input.value!==undefined){
        if(!((typeof input.value==='number'&&Number.isFinite(input.value))||(typeof input.value==='string'&&input.value.length<=100)))fail('Invalid value');t.value=input.value;
      }
      if(input.unit!==undefined)t.unit=string(input.unit,'unit',40);
      if(input.items!==undefined){
        if(!Array.isArray(input.items)||input.items.length>40||input.items.some(v=>!v||typeof v.text!=='string'||v.text.length>200||typeof v.done!=='boolean'))fail('Invalid checklist items');
        t.items=input.items.map(({text,done})=>({text,done}));
      }
      if(input.columns!==undefined||input.rows!==undefined){
        const cols=input.columns??t.columns,rows=input.rows??t.rows;
        if(!Array.isArray(cols)||cols.length<1||cols.length>8||cols.some(v=>typeof v!=='string'||v.length>80)||!Array.isArray(rows)||rows.length>100||rows.some(row=>!Array.isArray(row)||row.length!==cols.length||row.some(v=>!((typeof v==='string'&&v.length<=240)||(typeof v==='number'&&Number.isFinite(v))))))fail('Invalid table');
        t.columns=cols;t.rows=rows;
      }
      if(input.url!==undefined){
        t.url=string(input.url,'url',1500);
        try{if(!['http:','https:'].includes(new URL(t.url).protocol))fail('Invalid URL');}catch{fail('Invalid http(s) URL');}
      }
      if(input.points!==undefined){if(!Array.isArray(input.points)||input.points.length>120||input.points.some(v=>typeof v!=='number'||!Number.isFinite(v)))fail('Invalid chart points');t.points=input.points;}
      for(const key of ['xLabel','yLabel'])if(input[key]!==undefined)t[key]=string(input[key],key,80);
      if(input.append!==undefined){t.logs=[...(t.logs??[]),{at:now(),text:string(input.append,'append',2000)}].slice(-40);}
      if(input.parentId!==undefined){if(input.parentId!==''&&!validID(input.parentId))fail('Invalid parentId');if(input.parentId===id)fail('A task cannot parent itself');t.parentId=input.parentId||null;}
      if(input.dependsOn!==undefined){
        if(!Array.isArray(input.dependsOn)||input.dependsOn.length>20||input.dependsOn.some(v=>!validID(v)||v===id))fail('Invalid dependsOn list');
        t.dependsOn=[...new Set(input.dependsOn)];
      }
      if(input.heartbeatTimeoutSec!==undefined){if(!Number.isInteger(input.heartbeatTimeoutSec)||input.heartbeatTimeoutSec<30||input.heartbeatTimeoutSec>86400)fail('Heartbeat timeout must be 30..86400 sec');t.heartbeatTimeoutSec=input.heartbeatTimeoutSec;}
      if(input.heartbeatEnabled!==undefined){if(typeof input.heartbeatEnabled!=='boolean')fail('heartbeatEnabled must be boolean');t.heartbeatEnabled=input.heartbeatEnabled;}
      if(input.heartbeat===true){t.heartbeatEnabled=true;t.lastHeartbeatAt=now();t.staleNotifiedAt=null;}
      if(input.archived!==undefined){if(typeof input.archived!=='boolean')fail('archived must be boolean');t.archived=input.archived;}
      if(input.progress===undefined){
        if(input.current!==undefined||input.total!==undefined){if(t.total>0){t.progress=Math.min(100,Math.round(t.current/t.total*100));t.progressMeasured=true;}}
        else if(input.items!==undefined&&t.items.length){t.progress=Math.round(t.items.filter(x=>x.done).length/t.items.length*100);t.progressMeasured=true;}
        else if(input.status==='completed'&&t.progressMeasured!==false)t.progress=100;
      }
      if(t.status==='running'&&old.status!=='running')t.startedAt=now();
      if(['completed','failed','cancelled'].includes(t.status)&&old.status!==t.status)t.finishedAt=now();
      t.updatedAt=now();t.title??=id;
      t.blockAttestation=context.trustedUpdate===true&&t.status==='blocked' ? blockEvidenceDigest(t) : null;
      if(!s.tasks[id]&&Object.keys(s.tasks).length>=500)fail('Too many tasks; archive or delete some');
      s.tasks[id]=t;
      const entry={at:t.updatedAt,status:t.status,progress:t.progress,message:(t.message||'').slice(0,500)};
      (s.history[id]??=[]).push(entry);s.history[id]=s.history[id].slice(-160);
      s.events.unshift({id,...entry});s.events=s.events.slice(0,500);
      return shown(t);
    });
  }
  function messages(input={},context={}){
    if(!input||typeof input!=='object'||Array.isArray(input))fail('Expected a message operation object');
    const {action='list'}=input;
    const logMessage=(m,event,actor,note='')=>{
      (m.audit??=[]).push({at:now(),event,actor,note:String(note??'').slice(0,500)});
      m.audit=m.audit.slice(-150);
    };
    if(action==='list'){
      let arr=read().messages;
      if(input.to)arr=arr.filter(m=>m.to===input.to);
      if(input.unreadOnly)arr=arr.filter(m=>m.status==='unread');
      if(input.threadId)arr=arr.filter(m=>m.threadId===input.threadId||m.id===input.threadId);
      return arr.slice(-Math.min(300,Math.max(1,Number(input.limit)||100))).reverse();
    }
    if(action==='get')return read().messages.find(m=>m.id===input.id)??null;
    if(action==='post'||action==='reply'){
      const from=string(input.from??'agent','from',80),to=string(input.to??'controller','to',80);
      if(!from.trim()||!to.trim())fail('from and to must be non-empty');
      const body=string(input.body,'body',6000),subject=string(input.subject??'Agent message','subject',200);
      if(!body.trim())fail('Message body must not be empty');
      if(input.taskId!==undefined&&!validID(input.taskId))fail('Invalid task ID');
      const priority=input.priority??'normal';if(!['low','normal','high'].includes(priority))fail('Invalid priority');
      return edit(s=>{
        let threadId=null,replyTo=null;
        if(action==='reply'){
          const parent=s.messages.find(m=>m.id===input.inReplyTo);
          if(!parent)fail('Reply target not found');
          replyTo=parent.id;threadId=parent.threadId??parent.id;
        }
      // Continuity-first policy: every *trusted* new message addressed to
      // Local Main wakes Sol by default, even routine updates and replies.
      // Never upgrade plain HTTP/write-token messages into model invocations.
      // Explicit wake:false remains an opt-out for intentionally passive notes.
      const requested=to==='server-controller'&&from!=='server-controller'&&
        context.trustedWake===true&&input.wake!==false;
      if(input.wake===true&&to!=='server-controller')fail('Wake is only available for server-controller messages');
      if(input.wake===true&&!context.trustedWake)fail('Wake requires a separately authenticated local dispatcher or MCP call');
      let autoBlock=null;
      if(input.autoBlock!==undefined){
        const a=input.autoBlock;
        if(!context.trustedWake||from!=='tips-block-watch'||to!=='server-controller'||!requested||
          !a||typeof a!=='object'||!validID(a.taskId)||typeof a.updatedAt!=='string'||
          !Number.isFinite(Date.parse(a.updatedAt))||typeof a.hash!=='string'||!/^[a-f0-9]{64}$/.test(a.hash)){
          fail('Invalid trusted automatic blocker metadata');
        }
        autoBlock={taskId:a.taskId,updatedAt:a.updatedAt,hash:a.hash};
      }
      const tracked=input.tracked===true;
      if(tracked&&!context.trustedWake)fail('Tracked exchanges require trusted submission');
      const subTarget=/^sub-[a-z0-9_.-]{1,60}$/i.test(to);
      const taskId=input.taskId??(action==='post'&&subTarget?to:null);
      const m={id:randomUUID(),at:now(),from,to,subject,body,priority,taskId,
          status:'unread',threadId,replyTo,wakeAuthorized:requested&&Boolean(context.trustedWake),attempts:0,
          trustedSender:context.trustedWake===true,tracked,
          ...(autoBlock?{autoBlock}:{})};
        logMessage(m,action==='reply'?'reply_sent':'submitted',from);
        if(replyTo){const parent=s.messages.find(p=>p.id===replyTo);if(parent)logMessage(parent,'reply_received',from,m.id);}
        s.messages.push(m);s.messages=s.messages.slice(-1200);
        if(action==='post'&&subTarget){
          // Web->Local Sub and Main->Local Sub requests always appear in the
          // task board, even if the subagent worker has not been scheduled.
          // Do not lie about running/progress merely because a message exists.
          if(!s.tasks[to]){
            const task={id:to,title:`Subagent · ${to}`,kind:'progress',group:'Subagents',
              status:'pending',progress:0,progressMeasured:false,createdAt:m.at,updatedAt:m.at,
              message:`收到任务请求 · ${subject}`,details:`发起方 ${from} · 消息 ${m.id}`};
            s.tasks[to]=task;
            (s.history[to]??=[]).push({at:m.at,status:'pending',progress:0,message:task.message});
          }else{
            const task=s.tasks[to];
            task.logs=[...(task.logs??[]),{at:m.at,text:`新请求 ${m.id} · ${from} · ${subject}`}].slice(-40);
          }
        }
        return m;
      });
    }
    if(['delivered','ack','resolve','verify','finalize_controller','triage_controller'].includes(action)){
      return edit(s=>{
        const m=s.messages.find(m=>m.id===input.id);
        if(!m)fail('Message not found');
        if(action==='triage_controller'){
          // Passive messages must NEVER wake Sol on their own. The existing
          // authorized Sol Turn must explicitly report the review outcome.
          if(!context.trustedWake||m.to!=='server-controller'||m.status!=='unread')
            fail('Only unread queued Local Main messages may be triaged');
          const disposition=input.disposition;
          if(!['ack','resolved','delegated','defer'].includes(disposition))fail('Invalid triage disposition');
          const note=string(input.note,'note',1000);
          if(!note.trim())fail('A concrete triage note is required');
          const at=now();
          if(disposition==='delegated'){
            const child=s.messages.find(v=>v.id===input.evidenceId);
            if(!child||child.from!=='server-controller'||!child.to.startsWith('sub-')||
              !child.body.includes(m.id)||Date.parse(child.at)<Date.parse(m.at))
              fail('Delegation requires real Local Main -> Local Sub mail mentioning the original message ID');
            m.delegatedTo=child.to;m.delegationMessageId=child.id;
          }
          if(disposition!=='defer'){
            m.ackBy='server-controller';m.ackAt=at;
            m.status='acknowledged';
            logMessage(m,'acknowledged','server-controller',note);
          }
          if(disposition==='resolved'){
            if(m.tracked){
              m.verification={verdict:'accepted',by:'server-controller',at,note};
              logMessage(m,'verified_accepted','server-controller',note);
            }else logMessage(m,'resolved','server-controller',note);
            m.status='resolved';m.handledAt=at;
          }else if(disposition==='delegated'){
            logMessage(m,'delegated','server-controller',`${m.delegatedTo}: ${note}`);
          }else if(disposition==='defer'){
            // A reviewed-but-deferred automatic wake must not trigger another
            // Sol turn immediately. A later new message includes it as backlog.
            m.wakeAuthorized=false;
            logMessage(m,'deferred','server-controller',note);
          }
          m.triageAt=at;m.triageDisposition=disposition;m.note=note;
        }else if(action==='finalize_controller'){
          // Atomic receipt for the standalone Local Main worker. It is not an
          // external/MCP action: only the authorized worker can finalize its
          // *already claimed* message. Prevent half-ACKed tracked exchanges.
          if(!context.trustedWake||m.to!=='server-controller'||!m.wakeAuthorized||
            m.status!=='processing'||!m.claimAt)fail('Only the claimed Local Main may finalize a message');
          const verdict=input.verdict??'accepted';
          if(!['accepted','rejected','needs_changes'].includes(verdict))fail('Invalid controller verdict');
          const note=string(input.note??'','note',1000);
          const at=now();
          m.ackBy='server-controller';m.ackAt=at;
          logMessage(m,'acknowledged','server-controller');
          if(m.tracked){
            m.verification={verdict,by:'server-controller',at,note};
            m.status=verdict==='accepted'?'resolved':'acknowledged';
            logMessage(m,'verified_'+verdict,'server-controller',note);
          }else{
            m.status='resolved';
            logMessage(m,'resolved','server-controller',note);
          }
          m.handledAt=at;m.note=note;
        }else if(action==='delivered'){
          if(!context.trustedWake)fail('Only a trusted dispatcher may record delivery');
          if(m.status!=='unread'&&m.status!=='delivered')return m;
          const deliveredTurn=input.turnId!==undefined?string(input.turnId,'turnId',100):null;
          if(deliveredTurn&&deliveredTurn===m.deliveredTurnId)return m;
          m.status='delivered';
          m.deliveredAt??=now();
          m.lastDeliveredAt=now();
          m.deliveryCount=(m.deliveryCount??0)+1;
          if(deliveredTurn)m.deliveredTurnId=deliveredTurn;
          logMessage(m,'delivered','dispatcher',deliveredTurn??'');
        }else if(action==='verify'){
          if(!m.tracked)fail('Verification only applies to tracked exchanges');
          if(!context.trustedWake)fail('Verification requires a trusted recipient adapter');
          const actor=string(input.agentId,'agentId',80);
          if(actor!==m.to)fail('Only the recipient may verify this exchange');
          if(m.ackBy!==actor)fail('Recipient must ACK before verifying');
          const verdict=input.verdict;
          if(!['accepted','rejected','needs_changes'].includes(verdict))fail('Invalid verification verdict');
          if(m.verification)return m;
          const note=string(input.note??'','note',1000);
          m.verification={verdict,by:actor,at:now(),note};
          if(verdict==='accepted'){m.status='resolved';m.handledAt=m.verification.at;}
          logMessage(m,'verified_'+verdict,actor,note);
        }else{
          if(m.status==='resolved')return m;
          if(action==='resolve'&&m.tracked)fail('Tracked exchanges require recipient verification, not plain resolve');
          m.status=action==='ack'?'acknowledged':'resolved';m.handledAt=now();
          if(action==='ack')m.ackAt=m.handledAt;
          if(input.agentId!==undefined)m.ackBy=string(input.agentId,'agentId',80);
          logMessage(m,action==='ack'?'acknowledged':'resolved',input.agentId??'agent',input.note??'');
        }
        if(input.note!==undefined)m.note=string(input.note,'note',1000);
        return m;
      });
    }
    if(action==='delete'){
      if(!context.trustedWake)fail('Message deletion requires controller authorization');
      return edit(s=>{
        const size=s.messages.length;
        s.messages=s.messages.filter(m=>m.id!==input.id);
        return {deleted:s.messages.length<size,id:input.id};
      });
    }
    if(action==='claim'){
      if(!context.trustedWake)fail('Claim requires the trusted server worker');
      return edit(s=>{
        // Only one exclusive lease can own the next queued request.
        const msg=s.messages.find(m=>m.to==='server-controller'&&m.wakeAuthorized&&(
          m.status==='unread'||(m.status==='processing'&&Date.now()-Date.parse(m.claimAt||'')>90*60*1000))&&m.attempts<3&&
          (!m.retryNotBefore||Date.now()>=Date.parse(m.retryNotBefore)));
        if(!msg)return null;
        msg.status='processing';msg.attempts++;msg.claimAt=now();
        logMessage(msg,'claimed','server-controller',String(msg.attempts));
        return {...msg};
      });
    }
    if(action==='release'){
      if(!context.trustedWake)fail('Release requires trusted server worker');
      return edit(s=>{
        const m=s.messages.find(v=>v.id===input.id);
        if(!m||m.status!=='processing')fail('No matching in-process message');
        m.status=m.attempts>=3?'failed':'unread';
        m.retryNotBefore=m.attempts>=3?null:new Date(Date.now()+Math.min(30,m.attempts*5)*60000).toISOString();
        m.note=string(input.note??'Retry scheduled','note',1000);logMessage(m,'released','server-controller',m.note);return m;
      });
    }
    fail('Invalid message action');
  }
  function sweep(){
    return edit(s=>{
      const stale=[];
      for(const t of Object.values(s.tasks)){
        if(health(t)==='stale'&&!t.staleNotifiedAt){t.staleNotifiedAt=now();stale.push({id:t.id,title:t.title,status:'stale'});}
      }
      return stale;
    });
  }
  function notify(payload){
    const path=join(dir,'notifications.json');
    if(!existsSync(path))return;
    try{
      const conf=json(path),url=new URL(conf.url);
      if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['127.0.0.1','localhost'].includes(url.hostname)))return;
      if(payload.category==='task'&&!['completed','failed','blocked','stale'].includes(payload.status))return;
      if(payload.category==='message'&&!conf.messages)return;
      const title=payload.category==='message'?`Tips message (${payload.from})`:`Tips ${payload.status}: ${payload.title||payload.id}`;
      const body=payload.category==='message'?`${payload.subject}\n${payload.body.slice(0,250)}`:`${payload.title||payload.id}\n${payload.message||''}`;
      // Optional ntfy-compatible endpoint; never expose private token in alerts.
      void fetch(url,{method:'POST',redirect:'error',headers:{Title:encodeURIComponent(title),Priority:payload.status==='failed'||payload.status==='stale'?'high':'default', 'Content-Type':'text/plain; charset=utf-8'},body,signal:AbortSignal.timeout(6000)}).catch(()=>{});
    }catch{}
  }
  return {dir,credentials,snapshot,mutate,messages,sweep,notify};
}
