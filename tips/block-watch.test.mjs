import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBlockWatch, updatedWithinSixHours, eligibleBlock, rejectQueuedAutoBlock, blockerFingerprint, blockEvidenceDigest } from './block-watch.mjs';

const HOUR=60*60*1000;
const T0=Date.parse('2026-10-12T08:00:00Z');
const make=(id,now=T0,fields={})=>{
  const t={id,title:'AIR technical gate',message:'CPU schema static guard failed',status:'blocked',
    updatedAt:new Date(now).toISOString(),...fields};
  t.blockAttestation=t.status==='blocked'?blockEvidenceDigest(t):null;
  return t;
};

test('strict six-hour boundary and future/invalid clock are rejected',()=>{
  assert.equal(updatedWithinSixHours(make('air-fresh',T0-6*HOUR+1),T0),true);
  assert.equal(updatedWithinSixHours(make('air-boundary',T0-6*HOUR),T0),false);
  assert.equal(updatedWithinSixHours(make('air-stale',T0-6*HOUR-1),T0),false);
  assert.equal(updatedWithinSixHours(make('air-future',T0+1),T0),false);
  assert.equal(updatedWithinSixHours({...make('air-no-time'),updatedAt:null},T0),false);
  assert.equal(updatedWithinSixHours({...make('air-invalid'),updatedAt:'not-a-time'},T0),false);
});

test('user stop, disabled and nontechnical status cannot automatically wake',()=>{
  assert.equal(eligibleBlock(make('air-stop',T0,{message:'用户已经暂停，不要重新启动'}),T0),false);
  assert.equal(eligibleBlock(make('air-old',T0,{details:'No automatic retry or Sol invocation'}),T0),false);
  assert.equal(eligibleBlock(make('air-done',T0,{status:'completed'}),T0),false);
  assert.equal(eligibleBlock(make('air-optout',T0,{autoWakeBlocked:false}),T0),false);
  assert.equal(eligibleBlock(make('air-valid',T0),T0),true);
  assert.equal(eligibleBlock(make('air-life-causal-corrected-20261012',T0),T0),false);
  assert.equal(eligibleBlock({...make('air-untrusted'),blockAttestation:null},T0),false);
});

function harness(){
  const dir=mkdtempSync(join(tmpdir(),'tips-block-watch-test-'));
  let now=T0;
  let tasks=[];
  const messages=[];
  const tips={dir,
    snapshot:()=>({tasks:tasks.map(t=>({...t}))}),
    mutate:({id})=>tasks.find(t=>t.id===id)?{...tasks.find(t=>t.id===id)}:null,
    messages:(msg,{trustedWake})=>{
      assert.equal(trustedWake,true);
      messages.push(msg);
      return {id:`mail-${messages.length}`};
    },
  };
  const watch=createBlockWatch(tips,{time:()=>now,file:join(dir,'state.json')});
  return {watch,messages,setTasks:v=>{tasks=v},clock:v=>{now=v},cleanup:()=>rmSync(dir,{recursive:true,force:true})};
}

test('historical blockers are baselined; new blocker enqueues once after quiet period',()=>{
  const h=harness();
  try{
    h.setTasks([make('air-history',T0),make('air-go',T0,{status:'running'})]);
    assert.equal(h.watch.scan().initialized,true);
    assert.equal(h.messages.length,0);
    h.setTasks([make('air-history',T0),make('air-go',T0+500,{status:'blocked'})]);
    h.clock(T0+500);
    assert.equal(h.watch.scan().queued.length,0);
    h.clock(T0+90_501);
    assert.equal(h.watch.scan().queued.length,1);
    assert.equal(h.messages[0].taskId,'air-go');
    assert.equal(h.messages[0].wake,true);
    assert.equal(h.watch.scan().queued.length,0);
    assert.equal(h.messages.length,1);
  }finally{h.cleanup()}
});

test('queued blocker must remain younger than six hours, even after quiet time',()=>{
  const h=harness();
  try{
    h.setTasks([make('air-gate',T0-6*HOUR+120_000,{status:'running'})]);
    h.watch.scan();
    h.setTasks([make('air-gate',T0-6*HOUR+120_000)]);
    h.watch.scan();
    h.clock(T0+121_000);
    assert.equal(h.watch.scan().queued.length,0);
  }finally{h.cleanup()}
});

test('freshly observed tasks after bootstrap are eligible; intentional STOP is excluded',()=>{
  const h=harness();
  try{
    h.setTasks([]);h.watch.scan();
    h.setTasks([make('air-new'),make('air-stop',T0,{message:'用户明确停止任务'})]);
    assert.equal(h.watch.scan().queued.length,0);
    h.clock(T0+90_001);
    assert.deepEqual(h.watch.scan().queued.map(v=>v.id),['air-new']);
  }finally{h.cleanup()}
});

test('global automatic wake quota allows at most two daily',()=>{
  const h=harness();
  try{
    h.setTasks([]);h.watch.scan();
    h.setTasks(['air-a','air-b','air-c'].map(id=>make(id)));
    h.watch.scan();
    h.clock(T0+100_000);
    assert.equal(h.watch.scan().queued.length,2);
    assert.equal(h.watch.scan().queued.length,0);
  }finally{h.cleanup()}
});

test('automatic messages are revalidated immediately before Sol spawn',()=>{
  const h=harness();
  try{
    const item=make('air-pending',T0);
    h.setTasks([item]);
    const mail={autoBlock:{taskId:item.id,updatedAt:item.updatedAt,hash:blockerFingerprint(item)}};
    // An unchanged fresh blocker can be processed; a manual request has no freshness restriction.
    assert.equal(rejectQueuedAutoBlock({snapshot:()=>({tasks:[item]}),mutate:()=>item},mail,T0+1),null);
    assert.equal(rejectQueuedAutoBlock({snapshot:()=>({tasks:[]}),mutate:()=>item},mail,T0+6*HOUR), 'Task no longer qualifies (status, user stop or 6h freshness gate)');
    assert.equal(rejectQueuedAutoBlock({snapshot:()=>({tasks:[]}),mutate:()=>({...item,status:'running'})},mail,T0+2),'Task no longer qualifies (status, user stop or 6h freshness gate)');
    // A changed message without a fresh trusted attestation is ineligible.
    assert.equal(rejectQueuedAutoBlock({snapshot:()=>({tasks:[]}),mutate:()=>({...item,message:'another blocker'})},mail,T0+2),'Task no longer qualifies (status, user stop or 6h freshness gate)');
    // If the new message was trusted, the old mailbox request still must not run.
    const newer={...item,message:'another blocker'};newer.blockAttestation=blockEvidenceDigest(newer);
    assert.equal(rejectQueuedAutoBlock({snapshot:()=>({tasks:[]}),mutate:()=>newer},mail,T0+2),'Task changed since automatic wake was queued');
    assert.equal(rejectQueuedAutoBlock({snapshot:()=>({tasks:[{id:'air-pending-v2',status:'running'}]}),mutate:()=>item},mail,T0+2),'Active successor air-pending-v2 already running');
    assert.equal(rejectQueuedAutoBlock({}, {}, T0+10*HOUR),null);
  }finally{h.cleanup()}
});
