/** Tips-view-token-authorized administration for MCP and dashboard.
 * The same view token provides read AND management access. */
import {timingSafeEqual,randomUUID} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync,renameSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {createWebIdentityStore} from './web-identity-store.js';
import {subagentRegistry} from '../../../tips/subagents.mjs';

const equal=(a,b)=>{
  if(typeof a!=='string'||typeof b!=='string'||!a.length)return false;
  const x=Buffer.from(a),y=Buffer.from(b);
  return x.length===y.length&&timingSafeEqual(x,y);
};

export function createTipsAdmin(config,tips){
  const registry=subagentRegistry(config,tips),web=createWebIdentityStore(config);
  const auditPath=join(tips.dir,'admin-audit.json');
  const allowed=new Set(['history','remove_web','revoke_web','remove_sub','stop_sub','archive_task','delete_task','delete_message']);
  function audit(event){
    const lock=auditPath+'.lock';
    let got=false;
    // Admin calls are rare; refuse conflicting concurrent writes instead of
    // dropping audit data. Keep the lock short-lived and synchronous.
    try{
      mkdirSync(lock,{mode:0o700});got=true;
      const previous=existsSync(auditPath)?JSON.parse(readFileSync(auditPath,'utf8')):[];
      const updated=[{at:new Date().toISOString(),...event},...previous].slice(0,500);
      const tmp=auditPath+'.'+randomUUID()+'.tmp';
      try{writeFileSync(tmp,JSON.stringify(updated,null,2)+'\n',{mode:0o600});renameSync(tmp,auditPath)}
      finally{rmSync(tmp,{force:true})}
    }finally{if(got)rmSync(lock,{recursive:true,force:true})}
  }
  function run(input={}){
    if(!input||typeof input!=='object'||Array.isArray(input)||!allowed.has(input.action))
      throw Error('Unknown admin action');
    if(!equal(input.viewToken,tips.credentials.viewToken))throw Error('Invalid Tips view token');
    if(input.action==='history')return {events:existsSync(auditPath)?JSON.parse(readFileSync(auditPath,'utf8')).slice(0,100):[]};
    const id=input.id;
    if(typeof id!=='string'||id.length<1||id.length>100)throw Error('Target ID required');
    if(typeof input.reason!=='undefined'&&(typeof input.reason!=='string'||input.reason.length>400))
      throw Error('Invalid reason');
    const reason=input.reason??'';
    let result;
    switch(input.action){
      case 'revoke_web':result=web.revoke(id,input.viewToken,tips.credentials.viewToken,reason);break;
      case 'remove_web':result=web.remove(id,input.viewToken,tips.credentials.viewToken,reason);break;
      case 'stop_sub':result=registry.stop(id);break;
      case 'remove_sub':result=registry.remove(id);break;
      case 'archive_task':{
        const task=tips.mutate({action:'get',id});
        if(!task)throw Error('Unknown task');
        if(task.status==='running')throw Error('Running tasks cannot be archived; first finish or pause through the owning Agent');
        result=tips.mutate({action:'archive',id},{trustedManage:true});break;
      }
      case 'delete_task':{
        const task=tips.mutate({action:'get',id});
        if(!task)throw Error('Unknown task');
        if(task.status==='running')throw Error('Running task deletion refused; stop its owner and finish/pause it first');
        if(!task.archived)throw Error('Archive task before deleting its Tips record');
        result=tips.mutate({action:'delete',id},{trustedManage:true});break;
      }
      case 'delete_message':{
        const msg=tips.messages({action:'get',id});
        if(!msg)throw Error('Unknown message');
        if(msg.status==='processing')throw Error('Cannot delete message currently being processed');
        result=tips.messages({action:'delete',id},{trustedWake:true});break;
      }
    }
    audit({action:input.action,id,reason,result:input.action==='stop_sub'?{status:result.status}:{ok:true}});
    return {ok:true,action:input.action,id,result};
  }
  return {run};
}
