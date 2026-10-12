import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const source=readFileSync(new URL('./extension/background.js',import.meta.url),'utf8');
const id='11111111-1111-1111-1111-111111111111',role='web-air-main';
const chat='https://chatgpt.com/c/22222222-2222-2222-2222-222222222222';
const item={id,to:role};
const snapshot=(events=[item],acked=[])=>({roles:[role],events,acked});

async function fixture({initial={},responses=[]}={}){
  let clock=Date.parse('2026-10-12T15:00:00Z'),sent=0;
  const storage={enabled:false,done:{},submitted:{},pending:{},bindings:{},...initial};
  const chrome={storage:{local:{
    async get(keys){return Object.fromEntries(keys.map(key=>[key,storage[key]]));},
    async set(change){Object.assign(storage,change);},
  }},tabs:{async query(){return [{id:1,url:chat,title:role}];},
    async sendMessage(){sent++;return responses.shift()??{status:'sent'};},
    onUpdated:{addListener(){}},onRemoved:{addListener(){}}},
    runtime:{onInstalled:{addListener(){}},onStartup:{addListener(){}},onMessage:{addListener(){}}},
    alarms:{onAlarm:{addListener(){}},async create(){}}};
  const FakeDate=class extends Date{static now(){return clock;}};
  const ctx={chrome,Date:FakeDate,URL,setTimeout(){},clearTimeout(){},setInterval(){},clearInterval(){},WebSocket:class{}};
  runInNewContext(source,ctx);
  await new Promise(resolve=>setImmediate(resolve));
  storage.enabled=true;
  return {storage,ctx,count:()=>sent,advance:ms=>{clock+=ms}};
}

test('browser submit is submitted, not done; never re-submits while Web has not ACKed',async()=>{
  const f=await fixture();
  await f.ctx.absorbSnapshot(snapshot());
  assert.equal(f.count(),1);
  assert.ok(f.storage.submitted[id]);
  assert.equal(f.storage.pending[id],undefined);
  assert.equal(f.storage.done[id],undefined,'browser submission MUST NOT imply Web ACK');
  f.advance(7*24*60*60_000);
  for(let i=0;i<6;i++)await f.ctx.absorbSnapshot(snapshot());
  assert.equal(f.count(),1,'even many alarms/reconnections do not duplicate submission');
  // A vanished event is not evidence of ACK: expiry, logout and retention also
  // remove routing events. Persist submitted to prevent redelivery on return.
  await f.ctx.absorbSnapshot(snapshot([]));
  assert.equal(f.storage.done[id],undefined);
  assert.ok(f.storage.submitted[id]);
  await f.ctx.absorbSnapshot(snapshot());
  assert.equal(f.count(),1,'even a returning old message stays submitted');
  await f.ctx.absorbSnapshot(snapshot([],[item]));
  assert.ok(f.storage.done[id],'explicit MCP ACK transitions to done');
  assert.equal(f.storage.submitted[id],undefined);
  await f.ctx.absorbSnapshot(snapshot([],[item]));
  assert.equal(f.count(),1);
});

test('failed browser submission stays pending and is retried until successfully submitted',async()=>{
  const f=await fixture({responses:[{status:'busy'},{status:'not_ready',reason:'No Send'}, {status:'sent'}]});
  await f.ctx.absorbSnapshot(snapshot());
  assert.equal(f.count(),1);
  assert.ok(f.storage.pending[id]);
  f.advance(20_000);await f.ctx.absorbSnapshot(snapshot());
  assert.equal(f.count(),2);
  assert.ok(f.storage.pending[id]);
  f.advance(20_000);await f.ctx.absorbSnapshot(snapshot());
  assert.equal(f.count(),3);
  assert.ok(f.storage.submitted[id]);
  assert.equal(f.storage.done[id],undefined);
});

test('legacy done markers are migrated into submitted instead of re-sending or false ACK',async()=>{
  const f=await fixture({initial:{done:{[id]:Date.now()},pending:{[id]:item},attempts:{[id]:3}}});
  await f.ctx.absorbSnapshot(snapshot());
  assert.equal(f.count(),0);
  assert.equal(f.storage.submissionStateVersion,2);
  assert.ok(f.storage.submitted[id]);
  assert.equal(f.storage.pending[id],undefined,'previously submitted is no longer shown as pending');
  assert.equal(f.storage.done[id],undefined);
  await f.ctx.absorbSnapshot(snapshot([],[item]));
  assert.ok(f.storage.done[id]);
  assert.equal(f.storage.submitted[id],undefined);
});
