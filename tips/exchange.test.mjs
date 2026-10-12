import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createTipsV2} from '../vendor/devspace/dist/tips-core.js';

test('tracked Web exchange records delivery, ACK, reply and recipient acceptance',()=>{
  const root=mkdtempSync(join(tmpdir(),'tips-exchange-test-'));
  try{
    const tips=createTipsV2({stateDir:root});
    assert.throws(()=>tips.messages({action:'post',tracked:true,from:'controller',to:'sub-test',body:'Check CPU-only result'}),/trusted/);
    const m=tips.messages({action:'post',tracked:true,from:'controller',to:'sub-test',body:'Check CPU-only result'},{trustedWake:true});
    assert.equal(m.audit[0].event,'submitted');
    assert.equal(tips.messages({action:'delivered',id:m.id,turnId:'t1'},{trustedWake:true}).audit.at(-1).event,'delivered');
    assert.throws(()=>tips.messages({action:'verify',id:m.id,agentId:'sub-test',verdict:'accepted'},{trustedWake:true}),/ACK/);
    assert.throws(()=>tips.messages({action:'resolve',id:m.id}),/verification/);
    assert.equal(tips.messages({action:'ack',id:m.id,agentId:'sub-test'}).status,'acknowledged');
    const reply=tips.messages({action:'reply',from:'sub-test',to:'controller',inReplyTo:m.id,body:'Evidence checked'},{trustedWake:true});
    assert.equal(reply.replyTo,m.id);
    assert.equal(tips.messages({action:'get',id:m.id}).audit.at(-1).event,'reply_received');
    assert.throws(()=>tips.messages({action:'verify',id:m.id,agentId:'controller',verdict:'accepted'},{trustedWake:true}),/recipient/);
    const accepted=tips.messages({action:'verify',id:m.id,agentId:'sub-test',verdict:'accepted',note:'Verified CPU logs'},{trustedWake:true});
    assert.equal(accepted.status,'resolved');
    assert.equal(accepted.verification.by,'sub-test');
    assert.equal(accepted.audit.at(-1).event,'verified_accepted');
  }finally{rmSync(root,{force:true,recursive:true})}
});

test('needs_changes verification does not pretend completion',()=>{
  const root=mkdtempSync(join(tmpdir(),'tips-exchange-test-'));
  try{
    const tips=createTipsV2({stateDir:root});
    const m=tips.messages({action:'post',tracked:true,from:'sub-a',to:'sub-b',body:'Please review'},{trustedWake:true});
    tips.messages({action:'delivered',id:m.id,turnId:'t1'},{trustedWake:true});
    tips.messages({action:'ack',id:m.id,agentId:'sub-b'});
    const result=tips.messages({action:'verify',id:m.id,agentId:'sub-b',verdict:'needs_changes',note:'No evidence'},{trustedWake:true});
    assert.equal(result.status,'acknowledged');
    assert.equal(result.verification.verdict,'needs_changes');
  }finally{rmSync(root,{force:true,recursive:true})}
});
