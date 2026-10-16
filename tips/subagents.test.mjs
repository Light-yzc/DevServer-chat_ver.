import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTipsV2 } from '../vendor/devspace/dist/tips-core.js';
import { subagentRegistry,MAX_REGISTERED_SUBAGENTS } from './subagents.mjs';

const harness=()=>{
  const dir=mkdtempSync(join(tmpdir(),'tips-subagent-test-'));
  const root=join(dir,'allowed');mkdirSync(root);
  const tips=createTipsV2({stateDir:dir});
  const registry=subagentRegistry({allowedRoots:[root]},tips);
  return {dir,root,tips,registry,cleanup:()=>rmSync(dir,{recursive:true,force:true})};
};
test('register, queue, finish, and resume persistent agent ID',()=>{
  const t=harness();try{
    let x=t.registry.start({name:'sub-check',goal:'Summarize AIR docs.',cwd:t.root});
    assert.equal(x.status,'queued');assert.equal(x.model,'gpt-6-luna');
    assert.equal(x.sandbox,'danger-full-access');
    const queued=t.tips.mutate({action:'get',id:'sub-check'});
    assert.equal(queued.status,'pending');
    assert.equal(queued.kind,'progress');
    assert.equal(queued.progress,0);
    assert.equal(queued.progressMeasured,false);
    assert.match(queued.message,/已排队/);
    assert.match(queued.details,/Summarize AIR docs/);
    assert.equal(t.registry.list().length,1);
    assert.throws(()=>t.registry.start({name:'sub-check',goal:'overlap',cwd:t.root}),/already running/);
    x=t.registry.update('sub-check',x.jobId,{status:'completed',lastResult:'Results done'});
    assert.equal(x.status,'completed');
    const next=t.registry.start({name:'sub-check',goal:'Second task',cwd:t.root});
    assert.notEqual(next.jobId,x.jobId);assert.equal(next.revision,2);
    assert.equal(t.tips.mutate({action:'get',id:'sub-check'}).progress,0);
    assert.equal(t.tips.mutate({action:'get',id:'sub-check'}).progressMeasured,false);
    assert.equal(t.registry.stop('sub-check').status,'stopped');
  }finally{t.cleanup()}
});
test('a resumed worker does not leak a prior Web delegator into a new Job',()=>{
  const t=harness();try{
    const original=t.registry.start({name:'sub-air-web-owner',goal:'Review experimental protocol',cwd:t.root,
      reportTo:'web-air-main'});
    assert.equal(original.reportTo,'web-air-main');
    t.registry.update(original.name,original.jobId,{status:'completed'});
    const local=t.registry.start({name:original.name,goal:'New local task',cwd:t.root});
    assert.equal(local.reportTo,null);
    t.registry.update(local.name,local.jobId,{status:'completed'});
    assert.throws(()=>t.registry.start({name:original.name,goal:'Invalid recipient',cwd:t.root,
      reportTo:'../../secret'}),/Invalid reportTo/);
  }finally{t.cleanup()}
});
test('path guard and unsafe names rejected',()=>{
  const t=harness();try{
    assert.throws(()=>t.registry.start({name:'../name',goal:'x',cwd:t.root}),/name/);
    assert.throws(()=>t.registry.start({name:'sub-outside',goal:'x',cwd:'/tmp'}),/allowedRoot/);
    assert.throws(()=>t.registry.start({name:'sub-model',goal:'x',cwd:t.root,model:'bogus'}),/model/);
  }finally{t.cleanup()}
});
test('custom Codex model uses explicitly configured model provider and persists both for resumed session',()=>{
  const t=harness();try{
    const configPath=join(t.dir,'codex.toml');
    writeFileSync(configPath,'[model_providers.runanytime_grok]\nwire_api = "responses"\nenv_key = "RUNANYTIME_API_KEY"\n[model_providers.ly_3090_proxy]\nwire_api = "responses"\n');
    const registry=subagentRegistry({allowedRoots:[t.root],codexConfigPath:configPath},t.tips);
    const a=registry.start({name:'sub-grok-probe',goal:'Config-only test',cwd:t.root,
      model:'grok-4.7',provider:'runanytime_grok'});
    assert.equal(a.model,'grok-4.7');assert.equal(a.provider,'runanytime_grok');
    registry.update(a.name,a.jobId,{status:'completed'});
    assert.throws(()=>registry.start({name:a.name,cwd:t.root,goal:'Wrong provider',model:'grok-4.7',
      provider:'ly_3090_proxy'}),/provider/);
    assert.equal(registry.start({name:a.name,cwd:t.root,goal:'Same configured provider',
      model:'grok-4.7',provider:'runanytime_grok'}).provider,'runanytime_grok');
  }finally{t.cleanup()}
});
test('all new Subagent launch requests normalize even explicitly restricted sandbox to full',()=>{
  const t=harness();try{
    const a=t.registry.start({name:'sub-restricted-request',goal:'No GPU authorization implied',cwd:t.root,sandbox:'read-only'});
    assert.equal(a.sandbox,'danger-full-access');
    t.registry.stop(a.name);
    const b=t.registry.start({name:a.name,goal:'Resume with legacy workspace flag',cwd:t.root,sandbox:'workspace-write'});
    assert.equal(b.sandbox,'danger-full-access');
  }finally{t.cleanup()}
});
test('full-access migration refuses active work and upgrades idle historic identities without losing session state',()=>{
  const t=harness();try{
    const a=t.registry.start({name:'sub-legacy',goal:'Prior job',cwd:t.root});
    assert.throws(()=>t.registry.promoteFullAccess(),/queued or active/);
    t.registry.update(a.name,a.jobId,{status:'completed',pid:null,sandbox:'workspace-write'});
    const report=t.registry.promoteFullAccess();
    assert.deepEqual(report,{total:1,promoted:1,alreadyFull:0,sandbox:'danger-full-access',threadIdsPreserved:true});
    const after=t.registry.status(a.name);
    assert.equal(after.sandbox,'danger-full-access');
    assert.equal(after.jobId,a.jobId);
    assert.equal(after.previousSandbox,'workspace-write');
    assert.equal(t.registry.promoteFullAccess().promoted,0,'migration is idempotent');
    assert.equal(t.registry.start({name:a.name,goal:'Resume',cwd:t.root}).sandbox,'danger-full-access');
  }finally{t.cleanup()}
});
test('trusted Tips route works for queued/subagent mailbox',()=>{
  const t=harness();try{
    t.registry.start({name:'sub-alpha',goal:'Analyze a schema.',cwd:t.root});
    const m=t.registry.send({name:'sub-alpha',from:'server-controller',subject:'Check logs',body:'Review error details'});
    assert.equal(m.status,'unread');assert.equal(m.to,'sub-alpha');assert.equal(m.trustedSender,true);
    assert.equal(m.taskId,'sub-alpha');
    const card=t.tips.mutate({action:'get',id:'sub-alpha'});
    assert.ok(card.logs.some(x=>x.text.includes(m.id)));
    assert.equal(t.tips.messages({action:'list',to:'sub-alpha'})[0].id,m.id);
    assert.equal(t.tips.messages({action:'delivered',id:m.id,turnId:'turn1'},{trustedWake:true}).status,'delivered');
    const ack=t.tips.messages({action:'ack',id:m.id,agentId:'sub-alpha'});
    assert.equal(ack.status,'acknowledged');assert.equal(ack.ackBy,'sub-alpha');
    assert.equal(t.tips.messages({action:'resolve',id:m.id}).status,'resolved');
  }finally{t.cleanup()}
});
test('Web->Local Sub instruction creates a Tips task card even before scheduling',()=>{
  const t=harness();try{
    const msg=t.tips.messages({action:'post',from:'web-air-main',to:'sub-new-review',
      subject:'Review the AIR CPU checkpoint',body:'Read evidence only; GPU frozen'},{trustedWake:true});
    assert.equal(msg.taskId,'sub-new-review');
    const task=t.tips.mutate({action:'get',id:'sub-new-review'});
    assert.equal(task.status,'pending');
    assert.equal(task.kind,'progress');
    assert.match(task.message,/收到任务请求/);
    assert.match(task.details,/web-air-main/);
  }finally{t.cleanup()}
});
test('register up to 128 persistent agent identities without increasing parallel execution',()=>{
  const t=harness();try{
    assert.equal(MAX_REGISTERED_SUBAGENTS,128);
    for(let i=0;i<MAX_REGISTERED_SUBAGENTS;i++){
      const name=`sub-capacity-${String(i).padStart(3,'0')}`;
      const agent=t.registry.start({name,goal:'CPU-only synthetic registration; never execute',cwd:t.root});
      assert.equal(agent.status,'queued');
    }
    assert.equal(t.registry.list().length,128);
    assert.throws(()=>t.registry.start({name:'sub-capacity-128',goal:'should reject',cwd:t.root}),/cap of 128/);
    const entry=t.registry.status('sub-capacity-000');
    t.registry.update(entry.name,entry.jobId,{status:'completed'});
    const resumed=t.registry.start({name:entry.name,goal:'Same name should reuse slot',cwd:t.root});
    assert.equal(resumed.revision,2);
    assert.equal(t.registry.list().length,128);
  }finally{t.cleanup()}
});
