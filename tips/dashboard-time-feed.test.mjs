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
const helpers=runInNewContext(script.slice(start,end)+'\n({ONE_DAY_MS,newestFirst,withinDay,visibleTask,visibleMail})',{Date});

test('task feed is a single most-recent-first list without project or group headings',()=>{
  assert.doesNotMatch(html,/id="group-select"/);
  assert.doesNotMatch(html,/id="project-overview"/);
  assert.doesNotMatch(script,/cards\.push\(head\)/);
  assert.match(script,/for\(const t of \[\.\.\.visible\]\.sort\(newestFirst\)\)/);
  const t=[
    {id:'a',group:'Z',updatedAt:'2026-10-14T01:00:00Z'},
    {id:'b',group:'A',updatedAt:'2026-10-14T05:00:00Z'},
    {id:'c',group:'B',updatedAt:'2026-10-14T03:00:00Z'},
  ].sort(helpers.newestFirst);
  assert.deepEqual(t.map(x=>x.id),['b','c','a']);
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
