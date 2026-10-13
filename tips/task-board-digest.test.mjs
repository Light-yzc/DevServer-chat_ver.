import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {taskBoardDigest} from './task-board-digest.mjs';
const root=dirname(fileURLToPath(import.meta.url));
const sample=[
  {id:'air-life-causal',group:'AIR-LIFE',status:'blocked',message:'Causal experiment has not passed independent gate',updatedAt:'2026-10-12T10:00:00Z'},
  {id:'air-paper-review',group:'AIR / Paper',status:'pending',message:'Paper audit outstanding',updatedAt:'2026-10-13T01:00:00Z'},
  {id:'air-research-qa',group:'AIR-Research',status:'running',message:'Independently verifying synthetic control data',updatedAt:'2026-10-13T02:00:00Z',health:'stale'},
  {id:'sub-air-research-qa',group:'Subagents',status:'running',message:'Working on CPU-only QA',updatedAt:'2026-10-13T03:00:00Z',progress:0,progressMeasured:false,dependsOn:['air-life-causal']},
  {id:'air-old-completed',group:'AIR-LIFE',status:'completed',message:'Ignore old result',updatedAt:'2026-10-13T04:00:00Z'},
  {id:'tips-demo-progress',group:'Tips',status:'pending',message:'Ignore dashboard demo',updatedAt:'2026-10-13T05:00:00Z'},
];

test('Main sees bounded, diverse, active research tasks from all groups, not only AIR-LIFE',()=>{
  const digest=taskBoardDigest({tasks:sample},{limit:7});
  for(const id of ['air-life-causal','air-paper-review','air-research-qa','sub-air-research-qa'])
    assert.ok(digest.includes(id),`Missing ${id}`);
  assert.doesNotMatch(digest,/air-old-completed|tips-demo-progress/);
  assert.match(digest,/STALE/);
  assert.match(digest,/NO-GO until gate checked/);
  assert.match(digest,/Before dispatch, inspect full task/);
  assert.match(digest,/running=2, blocked=1, failed=0, pending=1/);
  assert.doesNotMatch(digest,/0%/,'A non-measurable state is not a percent');
});

test('Sub sees own Tips card and linked dependencies but not the whole research backlog',()=>{
  const digest=taskBoardDigest({tasks:sample},{role:'sub',agentId:'sub-air-research-qa',limit:4});
  assert.match(digest,/sub-air-research-qa/);
  assert.match(digest,/air-life-causal/);
  assert.doesNotMatch(digest,/(?:^- air-paper-review |^- air-research-qa )/m);
  assert.match(digest,/Update your OWN task card/);
});

test('Main injection uses actual digest and Sub always gets local card on each new Turn',()=>{
  const main=readFileSync(join(root,'server-controller.mjs'),'utf8');
  const sub=readFileSync(join(root,'app-agent.mjs'),'utf8');
  assert.match(main,/taskBoardDigest\(tips\.snapshot\(\),\{role:'main',limit:12\}\)/);
  assert.match(sub,/taskBoardDigest\(tips\.snapshot\(\),\{role:'sub',agentId:params\.name,limit:4\}\)/);
});

test('Task digest remains compact even when task board contains many open tasks',()=>{
  const huge=Array.from({length:110},(_,i)=>({id:`air-job-${String(i).padStart(3,'0')}`,
    group:`AIR-${i%10}`,status:i%4===0?'blocked':'running',updatedAt:'2026-10-13T03:00:00Z',message:'long research notes '.repeat(150)}));
  const digest=taskBoardDigest({tasks:huge},{limit:12});
  assert.equal((digest.match(/^- air-job-/gm)??[]).length,12);
  assert.ok(digest.length<3100,'Task board must not blow out Sol context');
  assert.match(digest,/12\/110 shown/);
});
