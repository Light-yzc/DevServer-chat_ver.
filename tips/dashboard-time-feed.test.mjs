import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const html=readFileSync(new URL('../vendor/devspace/dist/tips-dashboard.html',import.meta.url),'utf8');
const script=html.split('<script>')[1]?.split('</script>')[0];
if(!script)throw Error('Missing Tips dashboard inline script');
const start=script.indexOf(' const ONE_DAY_MS=');
const end=script.indexOf(' const adminMode=',start);
if(start<0||end<=start)throw Error('Missing dashboard time feed helpers');
const helpers=runInNewContext(script.slice(start,end)+'\n({ONE_DAY_MS,newestFirst,withinDay,visibleTask,visibleMail,projectKey,projectTimeSections})',{Date});

test('time feed groups only actual top-level projects, never AIR workstreams',()=>{
  assert.doesNotMatch(html,/id="group-select"/);
  assert.doesNotMatch(html,/id="project-overview"/);
  assert.match(script,/const sections=projectTimeSections\(visible\)/);
  assert.match(script,/if\(sections\.length>1\)/,'single project gets no section heading');
  const t=[
    {id:'air-life',group:'AIR-LIFE',updatedAt:'2026-10-14T01:00:00Z'},
    {id:'air-paper',group:'AIR / Paper',updatedAt:'2026-10-14T05:00:00Z'},
    {id:'air-research',group:'AIR-Research',updatedAt:'2026-10-14T03:00:00Z'},
    {id:'sub-air-trial',group:'Subagents',updatedAt:'2026-10-14T04:00:00Z'},
    {id:'air-main-handoff',group:'Agent handoffs',updatedAt:'2026-10-14T02:00:00Z'},
  ];
  const single=helpers.projectTimeSections(t);
  assert.equal(single.length,1);
  assert.equal(single[0].id,'air');
  assert.deepEqual(Array.from(single[0].items,x=>x.id),['air-paper','sub-air-trial','air-research','air-main-handoff','air-life']);
});

test('only distinct projects get sections; projects and their tasks sort by latest update',()=>{
  const tasks=[
    {id:'air-latest',group:'AIR-Research',updatedAt:'2026-10-14T04:00:00Z'},
    {id:'air-older',group:'AIR-LIFE',updatedAt:'2026-10-14T01:00:00Z'},
    {id:'tips-latest',group:'Tips',updatedAt:'2026-10-14T05:00:00Z'},
    {id:'tips-older',group:'Infrastructure',updatedAt:'2026-10-14T02:00:00Z'},
    {id:'custom-project',projectId:'separate-project',group:'AIR / Paper',updatedAt:'2026-10-14T03:00:00Z'},
  ];
  const sections=helpers.projectTimeSections(tasks);
  assert.deepEqual(Array.from(sections,s=>s.id),['infrastructure','air','separate-project']);
  assert.deepEqual(Array.from(sections[0].items,t=>t.id),['tips-latest','tips-older']);
  assert.deepEqual(Array.from(sections[1].items,t=>t.id),['air-latest','air-older']);
  assert.equal(helpers.projectKey(tasks[4]),'separate-project','explicit project overrides legacy group');
  assert.doesNotMatch(script,/\(a\.group\|\|'未分组'\)\.localeCompare/,'workstreams must not drive sorting');
});

test('24-hour cutoff is rolling, but running jobs stay visible despite old update timestamps',()=>{
  const now=Date.parse('2026-10-14T12:00:00Z');
  const recent={updatedAt:new Date(now-helpers.ONE_DAY_MS+1000).toISOString(),status:'completed'};
  const old={updatedAt:new Date(now-helpers.ONE_DAY_MS-1000).toISOString(),status:'completed'};
  assert.equal(helpers.withinDay(recent,now),true);
  assert.equal(helpers.withinDay(old,now),false);
  assert.equal(helpers.withinDay({},now),true,'undated records are preserved rather than lost');
  assert.equal(helpers.visibleTask({...old,status:'running'}),true);
  assert.equal(helpers.visibleTask({...old,status:'queued'}),true);
  assert.match(script,/\.filter\(t=>\(!t\.archived\|\|\(adminMode\(\)&&showArchived\)\)&&visibleTask\(t\)\)/);
  assert.match(script,/\(data\.events\?\?\[\]\)\.filter\(withinDay\)\.sort\(newestFirst\)/);
});

test('mail feed sorts chronologically; pending delivery and unverified tracked work are never hidden',()=>{
  const old='2000-01-01T00:00:00Z';
  assert.equal(helpers.visibleMail({status:'unread',at:old}),true);
  assert.equal(helpers.visibleMail({status:'processing',at:old}),true);
  assert.equal(helpers.visibleMail({status:'delivered',at:old}),true);
  assert.equal(helpers.visibleMail({status:'acknowledged',tracked:true,at:old}),true);
  assert.equal(helpers.visibleMail({status:'resolved',at:old}),false);
  assert.equal(helpers.visibleMail({status:'acknowledged',tracked:true,verification:{verdict:'accepted'},at:old}),false);
  assert.match(script,/\)\)\.sort\(newestFirst\);/);
});

test('agent cards flatten roles but preserve identity metadata and safety controls',()=>{
  assert.doesNotMatch(html,/id="agent-type"/);
  assert.match(script,/const visible=sections\.flatMap\(/);
  assert.match(script,/\.sort\(newestFirst\);/);
  assert.match(script,/adminButtons\(card,\[\['stop_sub'/);
  assert.match(script,/角色 · /);
  assert.match(html,/历史记录/);
});
