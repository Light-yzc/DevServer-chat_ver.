import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createTipsV2} from '../vendor/devspace/dist/tips-core.js';
import {pendingMainBatch,applyBatchReceipt,batchPrompt,MAX_MAIN_BATCH} from './main-inbox-batch.mjs';

function fixture(){const dir=mkdtempSync(join(tmpdir(),'tips-batch-'));const tips=createTipsV2({stateDir:dir});
  return {dir,tips,cleanup:()=>rmSync(dir,{recursive:true,force:true}),
    post:(subject,wake=false,tracked=true)=>tips.messages({action:'post',from:'web-air-main',to:'server-controller',
      subject,body:`Evidence for ${subject}; CPU only; preserve GPU freeze`,wake,tracked,priority:wake?'high':'normal'},{trustedWake:true})};}

test('passive messages do not wake Sol; independent urgent wake collects latest passive batch',()=>{
  const x=fixture();try{
    for(let i=0;i<MAX_MAIN_BATCH+3;i++)x.post('Old checkpoint '+i);
    const urgent=x.post('URGENT user request',true);
    const batch=pendingMainBatch(x.tips,{excludeIds:[urgent.id]});
    assert.equal(batch.total,MAX_MAIN_BATCH+3);
    assert.equal(batch.messages.length,MAX_MAIN_BATCH);
    assert.equal(batch.omitted,3);
    assert.ok(batch.messages.every(m=>!m.subject.includes('URGENT')));
    assert.ok(batch.messages.some(m=>m.subject.includes('Old checkpoint 14')));
    const claimed=x.tips.messages({action:'claim'},{trustedWake:true});
    assert.equal(claimed.id,urgent.id);
    assert.equal(x.tips.messages({action:'get',id:batch.messages[0].id}).status,'unread');
    const prompt=batchPrompt(batch,join(x.dir,'triage.json'),urgent.id);
    assert.match(prompt,/Sol MAIN COORDINATOR/);
    assert.match(prompt,/do NOT start additional model Turns/);
    assert.match(prompt,/Owner locks/);
  }finally{x.cleanup()}
});

test('actual Sol disposition ACK/resolve/delegate changes only explicitly reviewed messages',()=>{
  const x=fixture();try{
    const seen=x.post('Review dataset');const finished=x.post('Already completed');
    const work=x.post('Ask Luna to inspect');const left=x.post('Not reviewed');
    const urgent=x.post('Emergency',true);
    const batch=pendingMainBatch(x.tips,{excludeIds:[urgent.id]}),path=join(x.dir,'outcomes.json');
    const evidence=x.tips.messages({action:'post',from:'server-controller',to:'sub-reviewer',
      subject:'Inspect note',body:`Original message ${work.id}, audit CPU artifacts`,tracked:true},{trustedWake:true});
    writeFileSync(path,JSON.stringify({wakeMessageId:urgent.id,outcomes:[
      {id:seen.id,disposition:'ack',note:'Read; research is pending'},
      {id:finished.id,disposition:'resolved',note:'Checked completed artifacts and logs'},
      {id:work.id,disposition:'delegated',note:'Sent actual Luna sub request',evidenceId:evidence.id},
    ]}));
    const result=applyBatchReceipt(x.tips,batch,path,urgent.id);
    assert.equal(result.applied,3);assert.equal(result.missing,1);
    assert.equal(x.tips.messages({action:'get',id:seen.id}).status,'acknowledged');
    assert.equal(x.tips.messages({action:'get',id:finished.id}).verification.verdict,'accepted');
    assert.equal(x.tips.messages({action:'get',id:work.id}).delegationMessageId,evidence.id);
    assert.equal(x.tips.messages({action:'get',id:left.id}).status,'unread');
    assert.equal(x.tips.messages({action:'claim'},{trustedWake:true}).id,urgent.id);
  }finally{x.cleanup()}
});

test('reports cannot fake delegation, impersonate another Sol wake, or claim unreviewed messages',()=>{
  const x=fixture();try{
    const passive=x.post('Old mail');const urgent=x.post('Urgent wake',true);
    const batch=pendingMainBatch(x.tips,{excludeIds:[urgent.id]}),file=join(x.dir,'batch.json');
    writeFileSync(file,JSON.stringify({wakeMessageId:'some-other-wake',outcomes:[{id:passive.id,disposition:'resolved',note:'no'}]}));
    assert.equal(applyBatchReceipt(x.tips,batch,file,urgent.id).applied,0);
    const fake=x.tips.messages({action:'post',from:'web-air-main',to:'sub-reviewer',
      body:`Original ${passive.id}`},{trustedWake:true});
    writeFileSync(file,JSON.stringify({wakeMessageId:urgent.id,outcomes:[
      {id:passive.id,disposition:'delegated',note:'Fake work',evidenceId:fake.id},
      {id:urgent.id,disposition:'resolved',note:'I read urgent'},
      {id:passive.id,disposition:'ack',note:'duplicate'},
    ]}));
    const result=applyBatchReceipt(x.tips,batch,file,urgent.id);
    assert.equal(result.applied,0);
    assert.equal(x.tips.messages({action:'get',id:passive.id}).status,'unread');
    assert.equal(x.tips.messages({action:'get',id:urgent.id}).status,'unread');
  }finally{x.cleanup()}
});

test('explicit defer stays unread but records a real reviewer decision',()=>{
  const x=fixture();try{
    const msg=x.post('Check later'),batch=pendingMainBatch(x.tips),file=join(x.dir,'batch.json');
    writeFileSync(file,JSON.stringify({wakeMessageId:'trigger',outcomes:[{id:msg.id,disposition:'defer',note:'GPU freeze pending operator'}]}));
    const result=applyBatchReceipt(x.tips,batch,file,'trigger');
    assert.equal(result.deferred,1);
    const actual=x.tips.messages({action:'get',id:msg.id});
    assert.equal(actual.status,'unread');assert.equal(actual.triageDisposition,'defer');
    assert.equal(actual.audit.at(-1).event,'deferred');
  }finally{x.cleanup()}
});

test('a claimed Sol Turn can truthfully coalesce other authorized wake requests',()=>{
  const f=fixture();try{
    const first=f.post('First coordination',true);
    const second=f.post('Second coordination',true);
    const third=f.post('Third coordination',true);
    const claimed=f.tips.messages({action:'claim'},{trustedWake:true});
    assert.equal(claimed.id,first.id);
    const batch=pendingMainBatch(f.tips,{excludeIds:[claimed.id]});
    assert.deepEqual(batch.messages.map(m=>m.id),[second.id,third.id]);
    const file=join(f.dir,'coalesce.json');
    writeFileSync(file,JSON.stringify({wakeMessageId:first.id,outcomes:[
      {id:second.id,disposition:'resolved',note:'Checked and reconciled this request in same Sol turn'},
      {id:third.id,disposition:'ack',note:'Already assessed, waiting for Luna result'},
    ]}));
    const receipt=applyBatchReceipt(f.tips,batch,file,first.id);
    assert.equal(receipt.applied,2);
    assert.equal(f.tips.messages({action:'get',id:second.id}).status,'resolved');
    assert.equal(f.tips.messages({action:'get',id:third.id}).status,'acknowledged');
    assert.equal(f.tips.messages({action:'claim'},{trustedWake:true}),null,'No duplicate Sol execution from coalesced mail');
  }finally{f.cleanup()}
});
