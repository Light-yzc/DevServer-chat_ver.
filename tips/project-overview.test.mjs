import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createTipsV2} from '../vendor/devspace/dist/tips-core.js';
import {createTipsProjectBoard} from '../vendor/devspace/dist/tips-project.js';
import {createWebIdentityStore} from '../vendor/devspace/dist/web-identity-store.js';
import {registerTipsTool,mountTipsRoutes} from '../vendor/devspace/dist/tips.js';
import {z} from 'zod/v4';
import express from 'express';
function fixture(){const root=mkdtempSync(join(tmpdir(),'tips-project-'));
  const tips=createTipsV2({stateDir:root}),projects=createTipsProjectBoard(tips);
  return {root,tips,projects,cleanup:()=>rmSync(root,{recursive:true,force:true})};}

test('AIR project aggregates existing legacy workstreams without migrating or duplicating cards',()=>{
  const f=fixture();try{
    for(const [id,group,status] of [
      ['air-causal','AIR-LIFE','blocked'],['air-paper','AIR / Paper','pending'],
      ['air-baseline','AIR-Research','running'],['sub-air-method','Subagents','failed'],
      ['tips-runtime','Tips','running'],['air-verified','AIR / Other','completed']])
      f.tips.mutate({action:'update',id,group,status,title:id,message:'Evidence will be checked'});
    const overview=f.projects.run({action:'overview'});
    const air=overview.projects.find(p=>p.id==='air'),infra=overview.projects.find(p=>p.id==='infrastructure');
    assert.equal(air.total,5);assert.equal(air.open,4);
    assert.equal(air.counts.blocked,1);assert.equal(air.counts.completed,1);
    assert.equal(infra.total,1);
    assert.equal(air.missingOwner,4);assert.equal(air.missingNextAction,4);
    assert.equal(f.tips.snapshot().tasks.length,6,'No shadow project backlog');
  }finally{f.cleanup()}
});

test('ordinary Agent can create/read, cannot curate, archive or delete an existing project task',()=>{
  const f=fixture();try{
    const created=f.projects.run({action:'create',id:'air-new-qa',projectId:'air',
      title:'Review AIR controls',message:'Audit CPU-only evidence',nextAction:'Run controlled tests',
      acceptanceCriteria:'Independent 10/10 checks',priority:'high'}, {actor:'web-air-reviewer-02'});
    assert.equal(created.created,true);
    assert.equal(created.task.owner,'web-air-reviewer-02');
    assert.equal(created.task.nextAction,'Run controlled tests');
    assert.equal(f.projects.run({action:'get',id:'air-new-qa'}).projectId,'air');
    assert.throws(()=>f.projects.run({action:'create',id:'air-new-qa',projectId:'air',
      title:'Overwrite',message:'Not allowed'}),/already exists/);
    for(const action of ['edit','archive','delete'])
      assert.throws(()=>f.projects.run({action,id:'air-new-qa',nextAction:'Spoofed override'}),/requires/);
    assert.throws(()=>f.tips.mutate({action:'archive',id:'air-new-qa'}),/manager authorization/);
    assert.throws(()=>f.tips.mutate({action:'delete',id:'air-new-qa'}),/manager authorization/);
    assert.throws(()=>f.tips.mutate({action:'update',id:'air-new-qa',archived:true}),/manager authorization/);
    assert.throws(()=>f.tips.mutate({action:'update',id:'air-new-qa',owner:'spoofed'}),/manager authorization/);
    const progress=f.tips.mutate({action:'update',id:'air-new-qa',status:'running',message:'5 test cases checked'});
    assert.equal(progress.owner,'web-air-reviewer-02');
    assert.equal(progress.message,'5 test cases checked');
  }finally{f.cleanup()}
});

test('authenticated manager can edit, archive and delete, with task history and audit',()=>{
  const f=fixture();try{
    f.projects.run({action:'create',id:'air-legacy-demo',title:'Demo',projectId:'air',message:'Check CPU'});
    const old=f.projects.run({action:'get',id:'air-legacy-demo'});
    assert.throws(()=>f.projects.run({action:'edit',id:old.id,viewToken:'bad',owner:'server-controller'}),/requires/);
    assert.throws(()=>f.projects.run({action:'edit',id:old.id,viewToken:f.tips.credentials.viewToken,
      expectedUpdatedAt:'1970-01-01T00:00:00Z',owner:'server-controller'}),/changed since/);
    const result=f.projects.run({action:'edit',id:old.id,owner:'server-controller',
      nextAction:'Review open tests',acceptanceCriteria:'Independent evidence recorded',
      gate:'GPU NO-GO',expectedUpdatedAt:old.updatedAt},
      {actor:'web-air-main',manager:true});
    assert.equal(result.task.owner,'server-controller');
    assert.equal(result.task.gate,'GPU NO-GO');
    assert.ok(f.projects.run({action:'history',id:old.id}).length>=2);
    assert.throws(()=>f.projects.run({action:'delete',id:old.id},{manager:true}),/Archive first/);
    f.projects.run({action:'archive',id:old.id},{manager:true,actor:'web-air-main'});
    assert.equal(f.tips.mutate({action:'get',id:old.id}).archived,true);
    f.projects.run({action:'delete',id:old.id},{manager:true,actor:'web-air-main'});
    assert.equal(f.projects.run({action:'get',id:old.id}),null);
    const audit=JSON.parse(readFileSync(join(f.tips.dir,'project-audit.json'),'utf8'));
    assert.deepEqual(audit.map(x=>x.action).slice(0,4),['delete','archive','edit','create']);
    assert.ok(!JSON.stringify(audit).includes(f.tips.credentials.viewToken));
  }finally{f.cleanup()}
});

test('private view token is sufficient for management, running tasks cannot be deleted or archived',()=>{
  const f=fixture();try{
    const id='air-qa-active';f.projects.run({action:'create',id,projectId:'air',title:'QA',message:'Verify'});
    f.projects.run({action:'edit',id,status:'running',viewToken:f.tips.credentials.viewToken});
    assert.throws(()=>f.projects.run({action:'archive',id,viewToken:f.tips.credentials.viewToken}),/Running/);
    assert.throws(()=>f.projects.run({action:'delete',id,viewToken:f.tips.credentials.viewToken}),/Running/);
    assert.equal(f.projects.run({action:'overview'}).projects.find(x=>x.id==='air').counts.running,1);
  }finally{f.cleanup()}
});

test('MCP scope authenticates Web Main management, while a claimed Web Sub may only create/read',async()=>{
  const f=fixture();try{
    const config={stateDir:f.root},roles=createWebIdentityStore(config);
    for(const [id,scope] of [['web-air-main','main-session'],['web-air-reviewer-02','sub-session']]){
      const p=roles.prepare({id,label:id});roles.claim({id,invite:p.invite,scope});
    }
    const tools={};registerTipsTool({registerTool:(name,_schema,callback)=>tools[name]=callback},config,z);
    const call=async(body,scope)=>{
      const result=await tools.tips_project(body,{_meta:{'openai/session':scope}});
      return {error:!!result.isError,data:result.isError?result.content[0].text:JSON.parse(result.content[0].text)};
    };
    const created=await call({action:'create',id:'air-web-created',projectId:'air',title:'Review',message:'Independent CPU check'},'sub-session');
    assert.equal(created.error,false);
    assert.equal(created.data.task.owner,'web-air-reviewer-02');
    const unauthorized=await call({action:'edit',id:'air-web-created',owner:'web-air-main'},'sub-session');
    assert.equal(unauthorized.error,true);assert.match(unauthorized.data,/requires/);
    const managed=await call({action:'edit',id:'air-web-created',owner:'web-air-main',nextAction:'Verify raw data'},'main-session');
    assert.equal(managed.error,false);assert.equal(managed.data.task.owner,'web-air-main');
    const spoofed=await call({action:'archive',id:'air-web-created',actor:'web-air-main'},'unknown-session');
    assert.equal(spoofed.error,true);
  }finally{f.cleanup()}
});

test('project dashboard HTTP uses existing Tips viewing credential; it does not create another password',async()=>{
  const f=fixture();let server;try{
    const app=express();mountTipsRoutes(app,{stateDir:f.root},express);
    server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s))});
    const base='http://127.0.0.1:'+server.address().port;
    const request=(method,key,body)=>fetch(base+'/tips/project/api',{method,headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
    assert.equal((await request('GET','not-correct')).status,401);
    const overview=await request('GET',f.tips.credentials.viewToken);
    assert.equal(overview.status,200);assert.equal((await overview.json()).projects.length,3);
    assert.equal((await request('POST','incorrect',{action:'create',id:'air-dashboard'})).status,401);
    const created=await request('POST',f.tips.credentials.viewToken,{action:'create',id:'air-dashboard',projectId:'air',title:'Dashboard',message:'Owner checkpoint'});
    assert.equal(created.status,200);
    assert.equal((await created.json()).task.owner,'tips-dashboard');
    const updated=await request('POST',f.tips.credentials.viewToken,{action:'edit',id:'air-dashboard',owner:'web-air-main',nextAction:'QA work'});
    assert.equal(updated.status,200);assert.equal((await updated.json()).task.owner,'web-air-main');
    const html=await (await fetch(base+'/tips')).text();
    assert.ok(html.includes('project-overview'));assert.ok(html.includes('project-edit-panel'));
    assert.ok(html.includes('<details id="admin-panel"'));
    assert.ok(html.includes('data-filter="open" class="active">未完成'));
    assert.ok(html.includes('show-archived'));
  }finally{if(server)await new Promise(resolve=>server.close(resolve));f.cleanup()}
});
