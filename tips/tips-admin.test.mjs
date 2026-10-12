import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,mkdtempSync,mkdirSync,readFileSync,writeFileSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import express from 'express';
import {createTipsV2} from '../vendor/devspace/dist/tips-core.js';
import {createTipsAdmin} from '../vendor/devspace/dist/tips-admin.js';
import {createWebIdentityStore} from '../vendor/devspace/dist/web-identity-store.js';
import {subagentRegistry} from './subagents.mjs';
import {mountTipsRoutes} from '../vendor/devspace/dist/tips.js';

function fixture(){
  const dir=mkdtempSync(join(tmpdir(),'tips-administration-'));
  const allowed=join(dir,'allowed');mkdirSync(allowed);
  const config={stateDir:dir,allowedRoots:[allowed]};
  const tips=createTipsV2(config),admin=createTipsAdmin(config,tips);
  const web=createWebIdentityStore(config),sub=subagentRegistry(config,tips);
  const run=(action,id,key=tips.credentials.viewToken)=>admin.run({action,id,viewToken:key,reason:'administrative cleanup'});
  return {dir,allowed,config,tips,admin,web,sub,run,cleanup:()=>rmSync(dir,{recursive:true,force:true})};
}

test('Tips view token grants management; removing Web identity preserves mail',()=>{
  const x=fixture();try{
    const p=x.web.prepare({id:'web-archive',label:'Old chat'});
    const claim=x.web.claim({id:'web-archive',scope:'old-session',invite:p.invite});
    const mail=x.tips.messages({action:'post',from:'test-worker',to:'web-archive',subject:'Older mail',body:'Retain this'});
    assert.throws(()=>x.run('remove_web','web-archive','wrong'),/view token/);
    assert.throws(()=>x.run('remove_web','web-archive',''),/view token/);
    assert.equal(x.web.whoami({scope:'old-session'}).recognized,true);
    const result=x.run('remove_web','web-archive');
    assert.equal(result.result.removed,true);
    assert.equal(x.web.whoami({claimKey:claim.claimKey}).recognized,false);
    assert.equal(x.web.list().find(v=>v.id==='web-archive'),undefined);
    assert.equal(x.tips.messages({action:'get',id:mail.id}).body,'Retain this');
    assert.equal(x.run('history').events[0].id,'web-archive');
    assert.ok(!readFileSync(join(x.tips.dir,'admin-audit.json'),'utf8').includes(x.tips.credentials.viewToken));
  }finally{x.cleanup()}
});

test('active/queued Sub cannot be removed; stopped Sub can; retained Thread is detached',()=>{
  const x=fixture();try{
    const a=x.sub.start({name:'sub-old',goal:'Check document',cwd:x.allowed});
    assert.throws(()=>x.run('remove_sub','sub-old'),/active\/queued/);
    assert.equal(x.sub.status('sub-old').status,'queued');
    const directory=join(x.tips.dir,'app-agents');mkdirSync(directory,{recursive:true});
    writeFileSync(join(directory,'sub-old.json'),JSON.stringify({threadId:'t-old'}));
    x.run('stop_sub','sub-old');
    const result=x.run('remove_sub','sub-old');
    assert.equal(result.result.removed,true);
    assert.equal(x.sub.status('sub-old'),null);
    assert.equal(existsSync(join(directory,'sub-old.json')),false);
    const saved=readdirSync(join(directory,'retired'));
    assert.equal(saved.length,1);
    assert.equal(JSON.parse(readFileSync(join(directory,'retired',saved[0]),'utf8')).threadId,'t-old');
    const fresh=x.sub.start({name:'sub-old',goal:'New independent task',cwd:x.allowed});
    assert.equal(fresh.status,'queued');
    assert.notEqual(fresh.jobId,a.jobId);
  }finally{x.cleanup()}
});

test('running task cannot be removed; archive and deletion only after a terminal state',()=>{
  const x=fixture();try{
    x.tips.mutate({action:'update',id:'air-safe',title:'Safe test',status:'running'});
    assert.throws(()=>x.run('delete_task','air-safe'),/Running task/);
    assert.throws(()=>x.run('archive_task','air-safe'),/Running tasks/);
    x.tips.mutate({action:'update',id:'air-safe',status:'completed'});
    x.run('archive_task','air-safe');
    assert.equal(x.tips.mutate({action:'get',id:'air-safe'}).archived,true);
    x.run('delete_task','air-safe');
    assert.equal(x.tips.mutate({action:'get',id:'air-safe'}),null);
  }finally{x.cleanup()}
});

test('processing message cannot be deleted; other explicit deletions are audited',()=>{
  const x=fixture();try{
    const m=x.tips.messages({action:'post',from:'cpu',to:'server-controller',wake:true,
      subject:'Urgent work',body:'Please verify'},{trustedWake:true});
    const claimed=x.tips.messages({action:'claim'},{trustedWake:true});
    assert.equal(claimed.id,m.id);
    assert.throws(()=>x.run('delete_message',m.id),/being processed/);
    const other=x.tips.messages({action:'post',from:'test',to:'web-next',subject:'Old',body:'Old note'});
    assert.equal(x.run('delete_message',other.id).result.deleted,true);
    assert.equal(x.tips.messages({action:'get',id:other.id}),null);
    assert.equal(x.tips.messages({action:'get',id:m.id}).status,'processing');
  }finally{x.cleanup()}
});

test('Tips admin HTTP only needs the dashboard view token, not a second key',async()=>{
  const x=fixture();let server;
  try{
    const app=express();mountTipsRoutes(app,x.config,express);
    server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s))});
    const base='http://127.0.0.1:'+server.address().port;
    const post=(viewToken)=>fetch(base+'/tips/admin/api',{method:'POST',
      headers:{Authorization:'Bearer '+viewToken,'Content-Type':'application/json'},
      body:JSON.stringify({action:'history'})});
    assert.equal((await post('wrong')).status,401);
    const allowed=await post(x.tips.credentials.viewToken);
    assert.equal(allowed.status,200);
    assert.deepEqual((await allowed.json()).events,[]);
    const html=await (await fetch(base+'/tips/agents')).text();
    assert.ok(html.includes('admin-panel'));
    assert.ok(!html.includes('admin-unlock'));
    assert.ok(!html.includes('admin-key'));
  }finally{if(server)await new Promise(resolve=>server.close(resolve));x.cleanup()}
});
