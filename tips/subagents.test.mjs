import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTipsV2 } from '../vendor/devspace/dist/tips-core.js';
import { subagentRegistry } from './subagents.mjs';

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
    assert.equal(x.sandbox,'workspace-write');
    assert.equal(t.registry.list().length,1);
    assert.throws(()=>t.registry.start({name:'sub-check',goal:'overlap',cwd:t.root}),/already running/);
    x=t.registry.update('sub-check',x.jobId,{status:'completed',lastResult:'Results done'});
    assert.equal(x.status,'completed');
    const next=t.registry.start({name:'sub-check',goal:'Second task',cwd:t.root});
    assert.notEqual(next.jobId,x.jobId);assert.equal(next.revision,2);
    assert.equal(t.registry.stop('sub-check').status,'stopped');
  }finally{t.cleanup()}
});
test('path guard and unsafe names rejected',()=>{
  const t=harness();try{
    assert.throws(()=>t.registry.start({name:'../name',goal:'x',cwd:t.root}),/name/);
    assert.throws(()=>t.registry.start({name:'sub-outside',goal:'x',cwd:'/tmp'}),/allowedRoot/);
    assert.throws(()=>t.registry.start({name:'sub-model',goal:'x',cwd:t.root,model:'bogus'}),/model/);
  }finally{t.cleanup()}
});
test('trusted Tips route works for queued/subagent mailbox',()=>{
  const t=harness();try{
    t.registry.start({name:'sub-alpha',goal:'Analyze a schema.',cwd:t.root});
    const m=t.registry.send({name:'sub-alpha',from:'server-controller',subject:'Check logs',body:'Review error details'});
    assert.equal(m.status,'unread');assert.equal(m.to,'sub-alpha');assert.equal(m.trustedSender,true);
    assert.equal(t.tips.messages({action:'list',to:'sub-alpha'})[0].id,m.id);
    assert.equal(t.tips.messages({action:'delivered',id:m.id,turnId:'turn1'},{trustedWake:true}).status,'delivered');
    const ack=t.tips.messages({action:'ack',id:m.id,agentId:'sub-alpha'});
    assert.equal(ack.status,'acknowledged');assert.equal(ack.ackBy,'sub-alpha');
    assert.equal(t.tips.messages({action:'resolve',id:m.id}).status,'resolved');
  }finally{t.cleanup()}
});
