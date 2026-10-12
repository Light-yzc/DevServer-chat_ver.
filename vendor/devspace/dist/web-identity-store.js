/** Private per-conversation identity leases for authorized DevSpace MCP clients. */
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ID=/^web-[a-z0-9][a-z0-9_.-]{0,58}$/;
const INVITE_TTL=10*60*1000;
const LEASE_TTL=7*24*60*60*1000;
const wait=new Int32Array(new SharedArrayBuffer(4));
const sha=v=>createHash('sha256').update(v).digest('hex');
const stamp=time=>new Date(time).toISOString();
function safeEqual(a,b){
  if(typeof a!=='string'||typeof b!=='string')return false;
  const x=Buffer.from(a),y=Buffer.from(b);
  return x.length===y.length&&timingSafeEqual(x,y);
}
const validId=id=>typeof id==='string'&&ID.test(id);
function fail(message){throw Error(message)}

export function createWebIdentityStore(config,options={}){
  const dir=join(config.stateDir,'tips');mkdirSync(dir,{recursive:true,mode:0o700});
  const file=options.file??join(dir,'web-identities.json');
  const lock=file+'.lock';
  const time=options.now??(()=>Date.now());
  function atomic(state){
    const tmp=`${file}.${process.pid}.${randomUUID()}.tmp`;
    try{writeFileSync(tmp,JSON.stringify(state,null,2)+'\n',{mode:0o600});renameSync(tmp,file)}finally{rmSync(tmp,{force:true})}
  }
  function read(){
    if(!existsSync(file))return {version:1,serverKey:randomBytes(32).toString('hex'),roles:{}};
    const state=JSON.parse(readFileSync(file,'utf8'));
    if(!state.serverKey||!state.roles)fail('Corrupt Web identity registry');
    return state;
  }
  function edit(fn){
    let acquired=false;
    for(let n=0;n<160;n++){
      try{mkdirSync(lock,{mode:0o700});acquired=true;break}
      catch(e){
        if(e.code!=='EEXIST')throw e;
        try{if(time()-statSync(lock).mtimeMs>30000)rmSync(lock,{recursive:true,force:true})}catch{}
        Atomics.wait(wait,0,0,20);
      }
    }
    if(!acquired)fail('Web identity registry busy');
    try{const state=read();const value=fn(state);atomic(state);return value}finally{rmSync(lock,{recursive:true,force:true})}
  }
  const scopeHash=(state,scope)=>scope?createHmac('sha256',Buffer.from(state.serverKey,'hex')).update(scope).digest('hex'):null;
  function expose(role){
    return {id:role.id,label:role.label,status:role.status,createdAt:role.createdAt,
      claimedAt:role.claimedAt??null,leaseExpiresAt:role.leaseExpiresAt??null,
      inviteExpiresAt:role.status==='available'?role.inviteExpiresAt??null:null,
      scopeBound:Boolean(role.scopeHash),lastSeenAt:role.lastSeenAt??null};
  }
  function resolveIdentity(state,{scope,claimKey}={}){
    const now=time(),digest=scopeHash(state,scope),tokenHash=typeof claimKey==='string'?sha(claimKey):null;
    const matches=Object.values(state.roles).filter(role=>role.status==='claimed'&&Date.parse(role.leaseExpiresAt)>now);
    if(digest){const found=matches.find(r=>safeEqual(r.scopeHash,digest));if(found)return found}
    if(tokenHash){const found=matches.find(r=>safeEqual(r.claimKeyHash,tokenHash));if(found)return found}
    return null;
  }
  function prepare({id,label}={}){
    if(!validId(id))fail('Web identity ID must start with web- and contain only letters/numbers/._-');
    if(typeof label!=='string'||!label.trim()||label.length>100)fail('label must be 1..100 characters');
    return edit(state=>{
      const existing=state.roles[id],now=time();
      if(existing&&existing.status==='claimed'&&Date.parse(existing.leaseExpiresAt)>now)
        fail('Identity already claimed; cannot replace an active chat');
      const invite=randomBytes(24).toString('base64url');
      state.roles[id]={id,label,createdAt:existing?.createdAt??stamp(now),status:'available',
        inviteHash:sha(invite),inviteExpiresAt:stamp(now+INVITE_TTL),claimedAt:null,
        leaseExpiresAt:null,claimKeyHash:null,scopeHash:null,lastSeenAt:null};
      return {identity:expose(state.roles[id]),invite,inviteExpiresAt:state.roles[id].inviteExpiresAt,
        note:'One-time invitation; share privately with the intended Web Chat; no approval is required'};
    });
  }
  function claim({id,invite,scope}={}){
    if(!validId(id)||typeof invite!=='string'||invite.length>200)fail('Valid ID and invitation required');
    return edit(state=>{
      const role=state.roles[id],now=time();
      if(!role||role.status!=='available'||Date.parse(role.inviteExpiresAt)<=now||!safeEqual(role.inviteHash,sha(invite)))
        fail('Invitation invalid, expired, used or identity already claimed');
      const existing=resolveIdentity(state,{scope});
      if(existing)fail(`This Chat has already claimed ${existing.id}. Release it before claiming another.`);
      const claimKey=randomBytes(32).toString('base64url');
      role.status='claimed';role.claimedAt=stamp(now);role.lastSeenAt=stamp(now);
      role.leaseExpiresAt=stamp(now+LEASE_TTL);role.scopeHash=scopeHash(state,scope);
      role.claimKeyHash=sha(claimKey);role.inviteHash=null;role.inviteExpiresAt=null;
      return {identity:expose(role),claimKey,
        scopeBound:Boolean(role.scopeHash),
        note:role.scopeHash?'This chat can recognize itself on future calls carrying the same session metadata. Keep claimKey private as fallback.':'No stable conversation metadata was provided. Pass claimKey for subsequent calls and keep it private.'};
    });
  }
  function whoami(context={}){
    const state=read(),role=resolveIdentity(state,context);
    return role?{recognized:true,identity:expose(role),by:scopeHash(state,context.scope)&&safeEqual(role.scopeHash,scopeHash(state,context.scope))?'conversation_scope':'claim_key'}:
      {recognized:false,scopeAvailable:Boolean(context.scope),message:'No active identity bound. Claim a prepared web-* role with its one-time invite.'};
  }
  function authenticate(context){
    const state=read(),role=resolveIdentity(state,context);
    if(!role)fail('Web Chat is not recognized: claim a role, or provide your private claimKey');
    return expose(role);
  }
  function renew(context={}){
    return edit(state=>{
      const role=resolveIdentity(state,context);if(!role)fail('No recognized Web identity');
      role.leaseExpiresAt=stamp(time()+LEASE_TTL);role.lastSeenAt=stamp(time());
      return expose(role);
    });
  }
  function release(context={}){
    return edit(state=>{
      const role=resolveIdentity(state,context);if(!role)fail('No recognized Web identity');
      role.status='released';role.scopeHash=null;role.claimKeyHash=null;role.leaseExpiresAt=null;
      role.lastSeenAt=stamp(time());return expose(role);
    });
  }
  function list(){const state=read();return Object.values(state.roles).map(expose).sort((a,b)=>a.id.localeCompare(b.id))}
  return {prepare,claim,whoami,authenticate,renew,release,list};
}
