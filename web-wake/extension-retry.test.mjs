import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const source=readFileSync(new URL('./extension/background.js',import.meta.url),'utf8');
const id='11111111-1111-1111-1111-111111111111',role='web-air-main';
const chat='https://chatgpt.com/c/22222222-2222-2222-2222-222222222222';
const item={id,to:role};
const snapshot=(events=[item],acked=[])=>({roles:[role],events,acked});

async function fixture({initial={},responses=[],statuses=[],onStatus,onWake,injectionFails=false}={}){
  let clock=Date.parse('2026-10-12T15:00:00Z'),sent=0,injected=0,runtimeListener,installedListener;
  const tab={id:1,url:chat,title:role};
  let control;
  const storage={enabled:false,endpoint:'wss://regen.centralus.cloudapp.azure.com/web-wake/ws',done:{},submitted:{},pending:{},bindings:{},...initial};
  const chrome={storage:{local:{
    async get(keys){return structuredClone(Object.fromEntries((typeof keys==='string'?[keys]:keys).map(key=>[key,storage[key]])));},
    async set(change){Object.assign(storage,structuredClone(change));},
  }},tabs:{async query(){return [tab];},async get(){return tab;},
    async sendMessage(_id,msg){if(msg.type==='DEVSPACE_STATUS'){await onStatus?.(control);const status=statuses.shift()??{status:'idle',version:'0.1.9',lastActivityAt:clock-31*60_000};if(status instanceof Error)throw status;return status;}sent++;await onWake?.(control);return responses.shift()??{status:'sent'};},
    onUpdated:{addListener(){}},onRemoved:{addListener(){}}},
    scripting:{async executeScript(){injected++;if(injectionFails)throw Error('Site access denied');}},
    runtime:{id:'test-extension',getManifest:()=>({version:'0.1.9'}),onInstalled:{addListener(fn){installedListener=fn;}},onStartup:{addListener(){}},onMessage:{addListener(fn){runtimeListener=fn;}}},
    alarms:{onAlarm:{addListener(){}},async create(){}}};
  const FakeDate=class extends Date{static now(){return clock;}};
  const ctx={chrome,Date:FakeDate,URL,setTimeout(){},clearTimeout(){},setInterval(){},clearInterval(){},WebSocket:class{}};
  runInNewContext(source,ctx);
  await new Promise(resolve=>setImmediate(resolve));
  storage.enabled=true;
  control={storage,ctx,tab,count:()=>sent,injections:()=>injected,advance:ms=>{clock+=ms},
    installed:()=>installedListener(),
    check:(msg={role,ids:[id]},sender={id:'test-extension',frameId:0,tab})=>new Promise(resolve=>runtimeListener({type:'DEVSPACE_WAKE_CHECK',...msg},sender,resolve))};
  return control;
}

test('browser submit remains submitted not done; no repeat before quiet timeout, ACK remains authoritative',async()=>{
  const f=await fixture();
  await f.ctx.absorbSnapshot(snapshot());
  assert.equal(f.count(),1);
  assert.ok(f.storage.submitted[id]);
  assert.equal(f.storage.pending[id],undefined);
  assert.equal(f.storage.done[id],undefined,'browser submission MUST NOT imply Web ACK');
  f.advance(29*60_000);
  for(let i=0;i<6;i++)await f.ctx.absorbSnapshot(snapshot());
  assert.equal(f.count(),1,'routine alarms before recovery window never duplicate submission');
  // A vanished event is not evidence of ACK: expiry, logout and retention also
  // remove routing events. Persist submitted to prevent redelivery on return.
  await f.ctx.absorbSnapshot(snapshot([]));
  assert.equal(f.storage.done[id],undefined);
  assert.ok(f.storage.submitted[id]);
  await f.ctx.absorbSnapshot(snapshot());
  assert.equal(f.count(),1,'returning old message before timeout stays submitted');
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

test('submitted without ACK and quiet 30 minutes gets one recovery, then a second after two hours, never a third',async()=>{
  const f=await fixture();
  await f.ctx.absorbSnapshot(snapshot());assert.equal(f.count(),1);
  f.advance(30*60_000+1000);await f.ctx.absorbSnapshot(snapshot());
  assert.equal(f.count(),2);assert.equal(f.storage.recoveries[id].count,1);
  assert.ok(f.storage.submitted[id]);assert.equal(f.storage.done[id],undefined);
  f.advance(119*60_000);await f.ctx.absorbSnapshot(snapshot());assert.equal(f.count(),2);
  f.advance(61_000);await f.ctx.absorbSnapshot(snapshot());
  assert.equal(f.count(),3);assert.equal(f.storage.recoveries[id].count,2);
  f.advance(6*60*60_000);for(let i=0;i<4;i++)await f.ctx.absorbSnapshot(snapshot());
  assert.equal(f.count(),3,'recovery budget is exhausted');
  assert.equal(f.storage.done[id],undefined,'submission is never impersonated as ACK');
});

test('ACK cancels scheduled recovery and removes its retry ledger',async()=>{
  const f=await fixture();await f.ctx.absorbSnapshot(snapshot());
  f.advance(31*60_000);await f.ctx.absorbSnapshot(snapshot());assert.equal(f.storage.recoveries[id].count,1);
  await f.ctx.absorbSnapshot(snapshot([],[item]));
  assert.ok(f.storage.done[id]);assert.equal(f.storage.submitted[id],undefined);
  assert.equal(f.storage.recoveries[id],undefined);
  f.advance(3*60*60_000);await f.ctx.absorbSnapshot(snapshot([],[item]));
  assert.equal(f.count(),2);
});

test('final pre-click check authorizes only the due recovery attempt for still-unACKed IDs',async()=>{
  const f=await fixture({statuses:[{status:'idle',version:'0.1.9',lastActivityAt:0},
    {status:'busy',version:'0.1.9'}]});
  await f.ctx.absorbSnapshot(snapshot());
  f.advance(30*60_000+1000);
  await f.ctx.absorbSnapshot(snapshot()); // blocked by a busy page
  const req={role,ids:[id],retry:1,lastActivityAt:f.storage.submitted[id]};
  assert.equal((await f.check(req)).ok,true);
  assert.equal((await f.check({...req,retry:2})).ok,false,'no skipping attempts');
  assert.equal((await f.check({...req,lastActivityAt:f.storage.submitted[id]+29*60_000})).ok,false,
    'recent user activity blocks a late retry');
  await f.ctx.absorbSnapshot(snapshot([],[item]));
  assert.equal((await f.check(req)).ok,false,'ACK arriving before Send cancels recovery');
});

test('recovery follows original conversation binding and ignores duplicate matching tabs',async()=>{
  const f=await fixture();await f.ctx.absorbSnapshot(snapshot());
  f.advance(31*60_000);
  f.storage.bindings[role]='44444444-4444-4444-4444-444444444444';
  await f.ctx.absorbSnapshot(snapshot());
  assert.equal(f.count(),1);
  assert.ok(f.storage.submitted[id]);
});

test('several unACKed IDs are recovered as one batch, not one chat prompt per ID',async()=>{
  const next={id:'55555555-5555-5555-5555-555555555555',to:role};
  const f=await fixture();await f.ctx.absorbSnapshot(snapshot([item,next]));
  assert.equal(f.count(),1);
  f.advance(31*60_000);await f.ctx.absorbSnapshot(snapshot([item,next]));
  assert.equal(f.count(),2);
  assert.equal(f.storage.recoveries[id].count,1);
  assert.equal(f.storage.recoveries[next.id].count,1);
});

test('a recently active Web conversation postpones recovery until 30 minutes quiet',async()=>{
  const f=await fixture();await f.ctx.absorbSnapshot(snapshot());
  f.advance(31*60_000);
  const recent=f.storage.submitted[id]+30*60_000;
  // Status can be idle after 20 seconds while the Web was recently active.
  const g=await fixture({initial:{submitted:{[id]:f.storage.submitted[id]},openEvents:{[id]:role}},
    statuses:[{status:'idle',version:'0.1.9',lastActivityAt:recent}]});
  g.advance(31*60_000);
  await g.ctx.absorbSnapshot(snapshot());assert.equal(g.count(),0);
  g.advance(31*60_000);await g.ctx.absorbSnapshot(snapshot());
  assert.equal(g.count(),1,'after full inactivity window the reminder can resume');
  assert.equal(g.storage.recoveries[id].count,1);
});

test('no recovery if Web busy or has draft; no recovered message after snapshot disappearance',async()=>{
  const f=await fixture({statuses:[{status:'idle',version:'0.1.9',lastActivityAt:0},
    {status:'busy',version:'0.1.9'}]});
  await f.ctx.absorbSnapshot(snapshot());f.advance(31*60_000);
  await f.ctx.absorbSnapshot(snapshot());assert.equal(f.count(),1);
  await f.ctx.absorbSnapshot(snapshot([]));f.advance(31*60_000);
  await f.ctx.absorbSnapshot(snapshot([]));assert.equal(f.count(),1);
  assert.ok(f.storage.submitted[id]);
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


test('processing holds all new IDs pending; idle sends the accumulated batch once',async()=>{
  const other={id:'33333333-3333-3333-3333-333333333333',to:role};
  const f=await fixture({statuses:[{status:'busy',version:'0.1.9'},{status:'busy',version:'0.1.9'}]});
  await f.ctx.absorbSnapshot(snapshot());f.advance(60_000);await f.ctx.absorbSnapshot(snapshot([item,other]));
  assert.equal(f.count(),0);assert.equal(Object.keys(f.storage.pending).length,2);
  f.advance(30_000);await f.ctx.pump();assert.equal(f.count(),1);assert.equal(Object.keys(f.storage.submitted).length,2);
});
test('missing or outdated content script is recovered through a read-only probe without reloading',async()=>{
  for(const status of [new Error('Receiving end does not exist'),{status:'idle',version:'0.1.7'}]){
    const f=await fixture({statuses:[status,{status:'busy',version:'0.1.9'}]});await f.ctx.absorbSnapshot(snapshot());
    assert.equal(f.injections(),1);assert.equal(f.count(),0);assert.ok(f.storage.pending[id]);
    f.advance(30_000);await f.ctx.pump();assert.equal(f.count(),1);assert.equal(f.injections(),1);
  }
});
test('sleeping tabs wait; blocked script recovery is throttled and preserves pending',async()=>{
  const asleep=await fixture();asleep.tab.discarded=true;await asleep.ctx.absorbSnapshot(snapshot());assert.equal(asleep.count(),0);assert.equal(asleep.injections(),0);
  const f=await fixture({statuses:[new Error('missing'),new Error('missing')],injectionFails:true});await f.ctx.absorbSnapshot(snapshot());
  f.advance(20_000);await f.ctx.pump();assert.equal(f.injections(),1);assert.equal(f.count(),0);assert.ok(f.storage.pending[id]);
});
test('ACK arriving during idle probe removes stale batch before dispatch',async()=>{
  let once=false;
  const f=await fixture({onStatus:async f=>{if(!once){once=true;await f.ctx.absorbSnapshot(snapshot([],[item]));}}});
  await f.ctx.absorbSnapshot(snapshot());assert.equal(f.count(),0);assert.ok(f.storage.done[id]);assert.equal(f.storage.pending[id],undefined);
});
test('concurrent snapshot during dispatch neither loses newly queued mail nor resurrects ACK',async()=>{
  const other={id:'33333333-3333-3333-3333-333333333333',to:role};
  const f=await fixture({onWake:f=>f.ctx.absorbSnapshot(snapshot([other],[item]))});
  await f.ctx.absorbSnapshot(snapshot());assert.ok(f.storage.pending[other.id]);assert.ok(f.storage.done[id]);assert.equal(f.storage.submitted[id],undefined);
});
test('last-moment check rejects ACKed messages, disabled wake, and wrong conversation/sender',async()=>{
  const f=await fixture({statuses:[{status:'busy',version:'0.1.9'}]});await f.ctx.absorbSnapshot(snapshot());
  assert.equal((await f.check()).ok,true);
  f.storage.enabled=false;assert.equal((await f.check()).ok,false);f.storage.enabled=true;
  f.tab.url='https://chatgpt.com/c/44444444-4444-4444-4444-444444444444';f.storage.bindings[role]='22222222-2222-2222-2222-222222222222';assert.equal((await f.check()).ok,false);
  assert.equal((await f.check(undefined,{id:'other',frameId:0,tab:f.tab})).ok,false);
  await f.ctx.absorbSnapshot(snapshot([],[item]));assert.equal((await f.check()).ok,false);
});

test('partial confirmed response preserves unsent IDs for a later idle batch',async()=>{
  const other={id:'33333333-3333-3333-3333-333333333333',to:role};
  const f=await fixture({responses:[{status:'sent',ids:[id]}]});await f.ctx.absorbSnapshot(snapshot([item,other]));
  assert.ok(f.storage.submitted[id]);assert.ok(f.storage.pending[other.id]);assert.equal(f.storage.submitted[other.id],undefined);
});

test('extension update restores existing Web scripts without sending any prompt',async()=>{
  const f=await fixture({statuses:[new Error('missing'),{status:'busy',version:'0.1.8'}]});
  await f.installed();assert.equal(f.injections(),1);assert.equal(f.count(),0);
});
