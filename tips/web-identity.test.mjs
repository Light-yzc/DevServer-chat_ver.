import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWebIdentityStore } from '../vendor/devspace/dist/web-identity-store.js';

const NOW=Date.parse('2026-10-12T08:00:00Z');
function harness(){
  const dir=mkdtempSync(join(tmpdir(),'devspace-web-identity-'));
  let current=NOW;
  const store=createWebIdentityStore({stateDir:dir},{now:()=>current});
  return {store,now:n=>{current=n},cleanup:()=>rmSync(dir,{recursive:true,force:true})};
}
test('prepare → self claim (no approval) → conversation recognizes its own role',()=>{
  const h=harness();try{
    const slot=h.store.prepare({id:'web-reviewer-01',label:'Experiment reviewer'});
    assert.equal(slot.identity.status,'available');
    assert.ok(slot.invite.length>=30);
    assert.equal(h.store.whoami({scope:'chat-a'}).recognized,false);
    const claim=h.store.claim({id:'web-reviewer-01',invite:slot.invite,scope:'chat-a'});
    assert.equal(claim.identity.status,'claimed');
    assert.equal(claim.scopeBound,true);
    assert.equal(h.store.whoami({scope:'chat-a'}).identity.id,'web-reviewer-01');
    assert.equal(h.store.whoami({scope:'chat-a'}).by,'conversation_scope');
    assert.equal(h.store.whoami({scope:'chat-b'}).recognized,false);
    assert.equal(h.store.whoami({claimKey:claim.claimKey}).identity.id,'web-reviewer-01');
    assert.throws(()=>h.store.claim({id:'web-reviewer-01',invite:slot.invite,scope:'chat-b'}),/invalid|used|claimed/i);
    const list=h.store.list();
    assert.equal(list.length,1);assert.ok(!('claimKey' in list[0]));assert.ok(!('invite' in list[0]));
    assert.ok(!JSON.stringify(list).includes(claim.claimKey));
  }finally{h.cleanup()}
});

test('one chat cannot claim two active identities',()=>{
  const h=harness();try{
    const a=h.store.prepare({id:'web-main',label:'Main'}),b=h.store.prepare({id:'web-second',label:'Second'});
    h.store.claim({id:a.identity.id,invite:a.invite,scope:'chat-a'});
    assert.throws(()=>h.store.claim({id:b.identity.id,invite:b.invite,scope:'chat-a'}),/already claimed/);
    assert.equal(h.store.list().find(x=>x.id==='web-second').status,'available');
  }finally{h.cleanup()}
});

test('concurrent/replayed invitation cannot seize a claimed identity',()=>{
  const h=harness();try{
    const slot=h.store.prepare({id:'web-test-01',label:'Test'});
    h.store.claim({id:slot.identity.id,invite:slot.invite,scope:'one'});
    assert.throws(()=>h.store.prepare({id:'web-test-01',label:'Hijack'}),/already claimed/);
    assert.throws(()=>h.store.claim({id:slot.identity.id,invite:slot.invite,scope:'two'}));
    assert.throws(()=>h.store.release({scope:'two'}),/not recognized|No recognized/);
  }finally{h.cleanup()}
});

test('invitation expires at 10 minutes; claim lease expires at 7 days',()=>{
  const h=harness();try{
    const slot=h.store.prepare({id:'web-short',label:'Timed'});
    h.now(NOW+10*60*1000);
    assert.throws(()=>h.store.claim({id:'web-short',invite:slot.invite,scope:'a'}),/expired/);
    const renewed=h.store.prepare({id:'web-short',label:'Timed again'});
    const claim=h.store.claim({id:'web-short',invite:renewed.invite,scope:'a'});
    h.now(NOW+7*24*60*60*1000);
    assert.equal(h.store.whoami({scope:'a'}).recognized,true);
    h.now(NOW+7*24*60*60*1000+10*60*1000);
    assert.equal(h.store.whoami({scope:'a'}).recognized,false);
    assert.equal(h.store.whoami({claimKey:claim.claimKey}).recognized,false);
  }finally{h.cleanup()}
});

test('fallback claim key and release are private and one-time',()=>{
  const h=harness();try{
    const slot=h.store.prepare({id:'web-no-scope',label:'Fallback'});
    const claim=h.store.claim({id:slot.identity.id,invite:slot.invite});
    assert.equal(claim.scopeBound,false);
    assert.equal(h.store.whoami({}).recognized,false);
    assert.equal(h.store.authenticate({claimKey:claim.claimKey}).id,'web-no-scope');
    assert.equal(h.store.renew({claimKey:claim.claimKey}).status,'claimed');
    assert.equal(h.store.release({claimKey:claim.claimKey}).status,'released');
    assert.throws(()=>h.store.authenticate({claimKey:claim.claimKey}),/not recognized/);
  }finally{h.cleanup()}
});
