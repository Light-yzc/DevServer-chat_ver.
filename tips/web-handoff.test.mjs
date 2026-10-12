import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createTipsV2} from '../vendor/devspace/dist/tips-core.js';
import {requestWebHandoff,scanWebHandoffs,WEB_ACK_TIMEOUT_MS,WEB_REVIEW_TIMEOUT_MS} from './web-handoff.mjs';

const role='web-air-main';
function fixture(){
  const dir=mkdtempSync(join(tmpdir(),'web-sol-handoff-'));
  const tips=createTipsV2({stateDir:dir});
  const roles=[{id:role,status:'claimed',leaseExpiresAt:new Date(Date.now()+2*86400_000).toISOString()}];
  const req=(sourceId='main-original')=>requestWebHandoff(tips,roles,{to:role,
    subject:'Review causal evidence',body:'Check CPU-only causal evidence, GPU remains frozen',sourceId});
  return {tips,roles,req,cleanup:()=>rmSync(dir,{recursive:true,force:true})};
}

test('Sol Web handoff requires a valid claimed Web identity, creates tracked mail + task, deduplicates retries',()=>{
  const f=fixture();try{
    const h=f.req();assert.equal(h.status,'pending');
    const m=f.tips.messages({action:'get',id:h.messageId});
    assert.equal(m.from,'server-controller');assert.equal(m.to,role);
    assert.equal(m.tracked,true);assert.equal(m.wakeAuthorized,false);
    const card=f.tips.mutate({action:'get',id:h.id});
    assert.equal(card.status,'pending');assert.equal(card.progressMeasured,false);
    assert.equal(JSON.parse(card.details).sourceId,'main-original');
    const second=f.req();assert.equal(second.id,h.id);assert.equal(second.deduplicated,true);
    assert.equal(f.tips.messages({action:'list',limit:300}).length,1);
    assert.throws(()=>requestWebHandoff(f.tips,[],{to:role,subject:'s',body:'b'}),/not currently claimed/);
  }finally{f.cleanup()}
});

test('45m without real Web ACK queues exactly ONE Sol fallback; no model call from watcher',()=>{
  const f=fixture();try{
    const h=f.req();const msg=f.tips.messages({action:'get',id:h.messageId});
    assert.equal(scanWebHandoffs(f.tips,{now:Date.parse(msg.at)+WEB_ACK_TIMEOUT_MS-1}).fallbacks,0);
    const s=scanWebHandoffs(f.tips,{now:Date.parse(msg.at)+WEB_ACK_TIMEOUT_MS+1});
    assert.equal(s.fallbacks,1);
    const second=scanWebHandoffs(f.tips,{now:Date.parse(msg.at)+2*WEB_ACK_TIMEOUT_MS});
    assert.equal(second.fallbacks,0);
    const fallback=f.tips.messages({action:'list',limit:300}).find(x=>x.from==='tips-web-handoff-watch');
    assert.ok(fallback);
    assert.equal(fallback.to,'server-controller');
    assert.equal(fallback.wakeAuthorized,true);
    assert.equal(fallback.taskId,h.id);
    assert.equal(f.tips.mutate({action:'get',id:h.id}).status,'blocked');
    assert.equal(f.tips.messages({action:'claim'},{trustedWake:true}).id,fallback.id);
  }finally{f.cleanup()}
});

test('Actual Web ACK prevents fallback and upgrades card; formal verification completes handoff',()=>{
  const f=fixture();try{
    const h=f.req(),m=f.tips.messages({action:'get',id:h.messageId});
    f.tips.messages({action:'ack',id:m.id,agentId:role});
    const scan=scanWebHandoffs(f.tips,{now:Date.parse(m.at)+2*WEB_ACK_TIMEOUT_MS});
    assert.equal(scan.fallbacks,0);assert.equal(scan.acked,1);
    assert.equal(f.tips.mutate({action:'get',id:h.id}).status,'running');
    f.tips.messages({action:'verify',id:m.id,agentId:role,verdict:'accepted',note:'Reviewed actual evidence'}, {trustedWake:true});
    const outcome=scanWebHandoffs(f.tips);
    assert.equal(outcome.finished,1);
    assert.equal(f.tips.mutate({action:'get',id:h.id}).status,'completed');
  }finally{f.cleanup()}
});

test('Web ACK without a final verdict eventually gets exactly one safe Local Main fallback',()=>{
  const f=fixture();try{
    const h=f.req('slow-review'),m=f.tips.messages({action:'get',id:h.messageId});
    const ack=f.tips.messages({action:'ack',id:m.id,agentId:role});
    assert.equal(scanWebHandoffs(f.tips,{now:Date.parse(ack.ackAt)+WEB_REVIEW_TIMEOUT_MS-1000}).fallbacks,0);
    assert.equal(scanWebHandoffs(f.tips,{now:Date.parse(ack.ackAt)+WEB_REVIEW_TIMEOUT_MS+1000}).fallbacks,1);
    assert.equal(scanWebHandoffs(f.tips,{now:Date.parse(ack.ackAt)+2*WEB_REVIEW_TIMEOUT_MS}).fallbacks,0);
  }finally{f.cleanup()}
});

test('Web reviewer rejection asks for a single fallback without pretending completion',()=>{
  const f=fixture();try{
    const h=f.req('reject-review');
    f.tips.messages({action:'ack',id:h.messageId,agentId:role});
    f.tips.messages({action:'verify',id:h.messageId,agentId:role,verdict:'needs_changes',note:'Insufficient control'}, {trustedWake:true});
    assert.equal(scanWebHandoffs(f.tips).fallbacks,1);
    assert.equal(scanWebHandoffs(f.tips).fallbacks,0);
    assert.equal(f.tips.mutate({action:'get',id:h.id}).status,'blocked');
  }finally{f.cleanup()}
});
