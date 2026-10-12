import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTipsV2 } from '../vendor/devspace/dist/tips-core.js';
import { tipsProtocol,needsDelivery,shouldInjectProtocol,MAIL_REDELIVERY_DELAY_MS,MAX_MAIL_DELIVERIES } from './subagent-protocol.mjs';

test('each new thread receives the explicit ACK/RESOLVE/Tips protocol once',()=>{
  const protocol=tipsProtocol('sub-example');
  assert.ok(protocol.includes('sub-example'));
  for(const phrase of ['ACK','RESOLVE','<tips-actions>','controller','ONCE'])
    assert.ok(protocol.includes(phrase),phrase);
  assert.equal(shouldInjectProtocol(null),true);
  assert.equal(shouldInjectProtocol({threadId:'t1',protocolInjected:false}),true);
  assert.equal(shouldInjectProtocol({threadId:'t1',protocolInjected:true}),false);
  assert.equal(shouldInjectProtocol({threadId:'legacy'}),false);
});

test('undelivered messages are retried only after cooldown and at most three times',()=>{
  const first=Date.parse('2026-10-12T10:00:00Z');
  const temp=mkdtempSync(join(tmpdir(),'tips-redelivery-'));
  try{
    const tips=createTipsV2({stateDir:temp});
    const message=tips.messages({action:'post',from:'controller',to:'sub-foo',body:'Read this',subject:'Test'},
      {trustedWake:true});
    assert.ok(needsDelivery(message,first));
    let m=tips.messages({action:'delivered',id:message.id,turnId:'turn1'}, {trustedWake:true});
    assert.equal(m.status,'delivered');assert.equal(m.deliveryCount,1);
    assert.equal(needsDelivery(m,Date.parse(m.lastDeliveredAt)+MAIL_REDELIVERY_DELAY_MS-1),false);
    assert.equal(needsDelivery(m,Date.parse(m.lastDeliveredAt)+MAIL_REDELIVERY_DELAY_MS),true);
    m=tips.messages({action:'delivered',id:message.id,turnId:'turn1'}, {trustedWake:true});
    assert.equal(m.deliveryCount,1,'same turn must not count twice');
    m=tips.messages({action:'delivered',id:message.id,turnId:'turn2'}, {trustedWake:true});
    assert.equal(m.deliveryCount,2);
    m=tips.messages({action:'delivered',id:message.id,turnId:'turn3'}, {trustedWake:true});
    assert.equal(m.deliveryCount,MAX_MAIL_DELIVERIES);
    assert.equal(needsDelivery(m,Date.parse(m.lastDeliveredAt)+3*MAIL_REDELIVERY_DELAY_MS),false);
    m=tips.messages({action:'ack',id:message.id,agentId:'sub-foo'});
    assert.equal(needsDelivery(m,Date.parse(m.lastDeliveredAt)+3*MAIL_REDELIVERY_DELAY_MS),false);
  }finally{rmSync(temp,{recursive:true,force:true})}
});

test('plain HTTP token or completed message never invokes a managed subagent',()=>{
  const now=Date.now();
  assert.equal(needsDelivery({status:'unread',trustedSender:false},now),false);
  assert.equal(needsDelivery({status:'resolved',trustedSender:true},now),false);
  assert.equal(needsDelivery({status:'acknowledged',trustedSender:true},now),false);
  assert.equal(needsDelivery({status:'delivered',trustedSender:true,deliveryCount:1,lastDeliveredAt:'invalid'},now),false);
});
