import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const source=readFileSync(new URL('./extension/background.js',import.meta.url),'utf8');
const id='11111111-1111-1111-1111-111111111111',role='web-air-main';
const chat='https://chatgpt.com/c/22222222-2222-2222-2222-222222222222';

test('Web Wake retries a submitted but unacknowledged message after backoff and stops on ACK',async()=>{
  let clock=Date.parse('2026-10-12T15:00:00Z'),submitted=0;
  const storage={enabled:false,done:{},pending:{},attempts:{},bindings:{}};
  const chrome={storage:{local:{
    async get(keys){return Object.fromEntries(keys.map(key=>[key,storage[key]]));},
    async set(change){Object.assign(storage,change);},
  }},tabs:{async query(){return [{id:1,url:chat,title:role}];},
    async sendMessage(){submitted++;return {status:'sent'};},
    onUpdated:{addListener(){}},onRemoved:{addListener(){}}},
    runtime:{onInstalled:{addListener(){}},onStartup:{addListener(){}},onMessage:{addListener(){}}},
    alarms:{onAlarm:{addListener(){}},async create(){}}};
  const FakeDate=class extends Date{static now(){return clock;}};
  const context={chrome,Date:FakeDate,URL,setTimeout(){},clearTimeout(){},setInterval(){},clearInterval(){},WebSocket:class{}};
  runInNewContext(source,context);
  await new Promise(resolve=>setImmediate(resolve));
  storage.enabled=true;
  const snapshot={roles:[role],events:[{id,to:role}]};
  await context.absorbSnapshot(snapshot);
  assert.equal(submitted,1);
  assert.equal(storage.attempts[id],1);
  assert.ok(storage.pending[id],'A submitted reminder is NOT an MCP ACK');
  await context.absorbSnapshot(snapshot);
  assert.equal(submitted,1,'No immediate duplicate prompt');
  clock+=20*60_000;
  await context.absorbSnapshot(snapshot);
  assert.equal(submitted,2,'Unacknowledged message is retried');
  assert.equal(storage.attempts[id],2);
  await context.absorbSnapshot({roles:[role],events:[]});
  assert.equal(storage.pending[id],undefined,'ACK removes pending wake');
  assert.equal(storage.done[id],undefined,'ACK removes retry clock');
  assert.equal(storage.attempts[id],undefined,'ACK removes retry count');
});
