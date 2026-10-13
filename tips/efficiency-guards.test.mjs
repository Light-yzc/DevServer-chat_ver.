import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createTipsV2,MAX_TIPS_TASK_MESSAGE_LENGTH,mainWakeEligible,MAIN_WAKE_BATCH_DELAY_MS} from '../vendor/devspace/dist/tips-core.js';
import {createTipsAdmin} from '../vendor/devspace/dist/tips-admin.js';
import {subagentRegistry,MAX_CONSECUTIVE_SUB_FAILURES} from './subagents.mjs';
import {boundedTaskMessage} from './task-result-text.mjs';
import {applySubagentProgress} from './subagent-progress.mjs';

function fixture(){
  const root=mkdtempSync(join(tmpdir(),'tips-efficiency-'));
  const allowed=join(root,'allowed');mkdirSync(allowed);
  const config={stateDir:root,allowedRoots:[allowed]};
  const tips=createTipsV2(config);
  return {root,allowed,tips,agents:subagentRegistry(config,tips),admin:createTipsAdmin(config,tips),
    cleanup:()=>rmSync(root,{recursive:true,force:true})};
}

test('task result message supports 10240 chars, truncates beyond that, and keeps source reference',()=>{
  const x=fixture();try{
    assert.equal(MAX_TIPS_TASK_MESSAGE_LENGTH,10240);
    const within='界'.repeat(MAX_TIPS_TASK_MESSAGE_LENGTH);
    let saved=x.tips.mutate({action:'update',id:'air-long-result',message:within});
    assert.equal(saved.message,within);
    const over='测'.repeat(16000);
    saved=x.tips.mutate({action:'update',id:'air-long-result',message:over});
    assert.equal(saved.message.length,10240);
    assert.match(saved.message,/显示已截断/);
    const linked=boundedTaskMessage('实验结果'.repeat(3600),{sourcePath:'/research/results/last.txt'});
    assert.ok(linked.length<=10240);
    assert.match(linked,/完整结果：\/research\/results\/last\.txt/);
    saved=x.tips.mutate({action:'update',id:'air-long-result',message:linked});
    assert.equal(saved.message,linked);
    const progress=applySubagentProgress(x.tips,'air-long-result',{status:'running',message:over});
    assert.ok(progress.message.length<=10240);
    assert.throws(()=>x.tips.mutate({action:'update',id:'air-long-result',message:41}),/string/);
  }finally{x.cleanup()}
});

test('two failed managed turns trip a persistent circuit and prevent unreviewed restarts',()=>{
  const x=fixture();try{
    assert.equal(MAX_CONSECUTIVE_SUB_FAILURES,2);
    const name='sub-air-failure-qa';
    const a=x.agents.start({name,cwd:x.allowed,goal:'CPU-only analysis of crash log'});
    const once=x.agents.update(name,a.jobId,{status:'failed',exitCode:2,error:'turn failed'});
    assert.equal(once.consecutiveFailures,1);
    assert.equal(once.failureCircuitOpen,false);
    const b=x.agents.start({name,cwd:x.allowed,goal:'CPU-only independent diagnosis'});
    const twice=x.agents.update(name,b.jobId,{status:'failed',exitCode:2,error:'turn failed'});
    assert.equal(twice.consecutiveFailures,2);
    assert.equal(twice.failureCircuitOpen,true);
    assert.ok(twice.failureCircuitAt);
    assert.throws(()=>x.agents.start({name,cwd:x.allowed,goal:'Same failing research again'}),/failure circuit/);
    // Persistence must survive new registry objects and manager restarts.
    const fresh=subagentRegistry({stateDir:x.root,allowedRoots:[x.allowed]},x.tips);
    assert.equal(fresh.status(name).failureCircuitOpen,true);
    assert.throws(()=>fresh.start({name,cwd:x.allowed,goal:'Repeating blocked work'}),/failure circuit/);
    assert.throws(()=>fresh.resetFailureCircuit(name,'few'),/diagnosis/);
    assert.throws(()=>x.admin.run({action:'reset_sub_failure',id:name,viewToken:'bad',reason:'Repaired model invocation and documented exit 2'}),/view token/);
    const reset=x.admin.run({action:'reset_sub_failure',id:name,
      viewToken:x.tips.credentials.viewToken,reason:'Fixed Codex invocation and inspected stderr; one controlled CPU-only retry permitted'});
    assert.equal(reset.result.failureCircuitOpen,false);
    assert.equal(fresh.status(name).status,'failed','Reset must never enqueue or execute a new turn');
    assert.equal(fresh.status(name).consecutiveFailures,0);
    const resumed=fresh.start({name,cwd:x.allowed,goal:'One approved bounded CPU-only retry'});
    assert.equal(resumed.status,'queued');
    assert.ok(JSON.stringify(x.admin.run({action:'history',viewToken:x.tips.credentials.viewToken})).includes('reset_sub_failure'));
  }finally{x.cleanup()}
});

test('successful completed Turn resets a single failure count without lying about scientific acceptance',()=>{
  const x=fixture();try{
    const name='sub-air-simple-qa';const a=x.agents.start({name,cwd:x.allowed,goal:'CPU-only QA'});
    x.agents.update(name,a.jobId,{status:'failed',exitCode:2});
    const b=x.agents.start({name,cwd:x.allowed,goal:'Corrected invocation'});
    const success=x.agents.update(name,b.jobId,{status:'completed',exitCode:0});
    assert.equal(success.consecutiveFailures,0);
    assert.equal(success.failureCircuitOpen,false);
    assert.equal(x.tips.mutate({action:'get',id:name}).status,'pending','Registry status does not claim scientific validation');
  }finally{x.cleanup()}
});

test('10-minute batching saves Sol turns while still prioritizing real high-urgency requests',()=>{
  const x=fixture();try{
    const standard=x.tips.messages({action:'post',from:'web-air-main',to:'server-controller',
      subject:'Routine checkpoint',body:'QA logs updated'},{trustedWake:true});
    assert.equal(standard.wakeAuthorized,true);
    assert.equal(mainWakeEligible(standard,Date.parse(standard.at)+MAIN_WAKE_BATCH_DELAY_MS-1),false);
    assert.equal(mainWakeEligible(standard,Date.parse(standard.at)+MAIN_WAKE_BATCH_DELAY_MS),true);
    assert.equal(x.tips.messages({action:'claim'},{trustedWake:true}),null);
    const urgent=x.tips.messages({action:'post',from:'tips-subagent-manager',to:'server-controller',
      priority:'high',wake:true,subject:'Circuit breaker needs diagnosis',body:'2 consecutive failures'},{trustedWake:true});
    assert.equal(x.tips.messages({action:'claim'},{trustedWake:true}).id,urgent.id);
    assert.equal(x.tips.messages({action:'get',id:standard.id}).status,'unread');
  }finally{x.cleanup()}
});
