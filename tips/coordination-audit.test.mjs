import test from 'node:test';
import assert from 'node:assert/strict';
import {coordinationAudit} from './coordination-audit.mjs';
const now=Date.parse('2026-10-16T14:00:00Z');

test('terminal Sub job with stale running task card is flagged, not mutated',()=>{
  const tasks=[{id:'sub-air-cpu-qa',status:'running',updatedAt:'2026-10-16T13:55:00Z'}];
  const agents=[{name:'sub-air-cpu-qa',status:'completed',jobId:'job-1'}];
  const before=JSON.stringify({tasks,agents});
  const r=coordinationAudit({tasks,agents},{now});
  assert.equal(r.counts.mismatched,1);
  assert.equal(r.mismatched[0].agentStatus,'completed');
  assert.equal(r.readOnly,true);
  assert.equal(JSON.stringify({tasks,agents}),before);
});
test('non-Sub stale running card is uncertain, not proof of a stopped process',()=>{
  const r=coordinationAudit({tasks:[
    {id:'air-external-gpu',status:'running',updatedAt:'2026-10-16T12:00:00Z'}],agents:[]},{now});
  assert.equal(r.counts.stale,1);
  assert.equal(r.counts.mismatched,0);
  assert.match(r.stale[0].next,/NOT proof/);
});
test('paused STOP signal remains visible; no restart or permission is inferred',()=>{
  const r=coordinationAudit({tasks:[
    {id:'air-stop',status:'paused',message:'用户要求停止全部实验',updatedAt:'2026-10-16T13:45:00Z'},
    {id:'air-review',status:'blocked',updatedAt:'2026-10-16T13:00:00Z'}],agents:[]},{now});
  assert.equal(r.counts.gateSignals,1);
  assert.equal(r.counts.unassigned,1);
  assert.match(r.note,/Never auto-resume/);
});
