import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createTipsV2,mainWakeEligible,MAIN_WAKE_BATCH_DELAY_MS} from '../vendor/devspace/dist/tips-core.js';
import {finalizeMainMessage} from './controller-receipts.mjs';

function fixture(){
  const stateDir=mkdtempSync(join(tmpdir(),'tips-main-receipt-'));
  const tips=createTipsV2({stateDir});
  const post=(tracked=false,wake=true)=>tips.messages({action:'post',from:'web-air-main',to:'server-controller',
    subject:'CPU study checkpoint',body:'Review the CPU controls; no GPU',tracked,wake,
    priority:wake?'high':'normal'},{trustedWake:true});
  return {tips,post,cleanup:()=>rmSync(stateDir,{recursive:true,force:true})};
}

test('explicitly awakened tracked Main request gets atomic ACK and verified receipt',()=>{
  const x=fixture();try{
    const msg=x.post(true);
    const claimed=x.tips.messages({action:'claim'},{trustedWake:true});
    assert.equal(claimed.id,msg.id);
    const result=finalizeMainMessage(x.tips,claimed,{verdict:'accepted',note:'CPU-only review completed'});
    assert.equal(result.status,'resolved');
    assert.equal(result.ackBy,'server-controller');
    assert.equal(result.verification.verdict,'accepted');
    assert.deepEqual(result.audit.map(e=>e.event),['submitted','claimed','acknowledged','verified_accepted']);
    assert.throws(()=>finalizeMainMessage(x.tips,claimed),/claimed Local Main/);
  }finally{x.cleanup()}
});

test('untracked authorized Main request resolves with ACK and no verification object',()=>{
  const x=fixture();try{
    const msg=x.post(false);const claimed=x.tips.messages({action:'claim'},{trustedWake:true});
    assert.equal(claimed.id,msg.id);
    const result=finalizeMainMessage(x.tips,claimed,{note:'Completed and recorded'});
    assert.equal(result.status,'resolved');
    assert.equal(result.ackBy,'server-controller');
    assert.equal(result.verification,undefined);
    assert.deepEqual(result.audit.map(e=>e.event),['submitted','claimed','acknowledged','resolved']);
  }finally{x.cleanup()}
});

test('tracked skipped message is rejected, not misrepresented as research success',()=>{
  const x=fixture();try{
    const msg=x.post(true);const claimed=x.tips.messages({action:'claim'},{trustedWake:true});
    const result=finalizeMainMessage(x.tips,claimed,{verdict:'rejected',note:'stale preregistration'});
    assert.equal(result.status,'acknowledged');
    assert.equal(result.verification.verdict,'rejected');
    assert.equal(result.ackBy,'server-controller');
    assert.equal(result.audit.at(-1).event,'verified_rejected');
  }finally{x.cleanup()}
});

test('messages without wake permission are not claimed and cannot be finalized; others cannot spoof',()=>{
  const x=fixture();try{
    const unawakened=x.post(true,false);
    assert.equal(x.tips.messages({action:'claim'},{trustedWake:true}),null);
    assert.throws(()=>finalizeMainMessage(x.tips,unawakened),/claimed Local Main/);
    const waking=x.post(true,true);
    const claimed=x.tips.messages({action:'claim'},{trustedWake:true});
    assert.equal(claimed.id,waking.id);
    assert.throws(()=>x.tips.messages({action:'finalize_controller',id:claimed.id}),/claimed Local Main/);
    assert.throws(()=>x.tips.messages({action:'finalize_controller',id:unawakened.id},{trustedWake:true}),/claimed Local Main/);
    assert.throws(()=>x.tips.messages({action:'finalize_controller',id:claimed.id,verdict:'invalid'},{trustedWake:true}),/verdict/);
    assert.equal(x.tips.messages({action:'get',id:unawakened.id}).status,'unread');
  }finally{x.cleanup()}
});

test('dashboard mailbox summary separates passive Sol mail, authorized wake, and legacy inbox',()=>{
  const x=fixture();try{
    x.post(true,false);
    x.post(true,true);
    x.tips.messages({action:'post',from:'old-web',to:'controller',subject:'Old message',body:'Old queue'});
    const m=x.tips.snapshot().mailbox;
    assert.equal(m.passiveMain,1);
    assert.equal(m.authorizedMain,1);
    assert.equal(m.legacyController,1);
    assert.equal(m.unreadController,3);
  }finally{x.cleanup()}
});

test('routine trusted Sol wake is batched for 10 minutes, high priority still immediate',()=>{
  const x=fixture();try{
    const trusted=x.tips.messages({action:'post',from:'sub-air-review',to:'server-controller',
      subject:'Routine but actionable',body:'Please coordinate next CPU-only study'},{trustedWake:true});
    assert.equal(trusted.wakeAuthorized,true);
    assert.equal(mainWakeEligible(trusted,Date.parse(trusted.at)+MAIN_WAKE_BATCH_DELAY_MS-1),false);
    assert.equal(mainWakeEligible(trusted,Date.parse(trusted.at)+MAIN_WAKE_BATCH_DELAY_MS),true);
    const self=x.tips.messages({action:'post',from:'server-controller',to:'server-controller',
      subject:'Self note',body:'Do not call Sol recursively'},{trustedWake:true});
    assert.equal(self.wakeAuthorized,false);
    const passive=x.tips.messages({action:'post',from:'web-main',to:'server-controller',
      body:'Passive archive',wake:false},{trustedWake:true});
    assert.equal(passive.wakeAuthorized,false);
    const untrusted=x.tips.messages({action:'post',from:'untrusted-http-writer',to:'server-controller',
      body:'No implicit escalation'});
    assert.equal(untrusted.wakeAuthorized,false);
    assert.throws(()=>x.tips.messages({action:'post',from:'untrusted-http-writer',
      to:'server-controller',body:'Unauthorized explicit wake',wake:true}),/Wake requires/);
    assert.equal(x.tips.messages({action:'claim'},{trustedWake:true}),null,'Routine mail waits for batch window');
    const urgent=x.tips.messages({action:'post',from:'sub-air-review',to:'server-controller',
      priority:'high',body:'Immediate human-approved gate review'},{trustedWake:true});
    assert.equal(x.tips.messages({action:'claim'},{trustedWake:true}).id,urgent.id);
  }finally{x.cleanup()}
});
