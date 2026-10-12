import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createTipsV2} from '../vendor/devspace/dist/tips-core.js';
import {createWebIdentityStore} from '../vendor/devspace/dist/web-identity-store.js';
import {buildAgentOverview} from '../vendor/devspace/dist/tips-agent-overview.js';

function fixture(){
  const dir=mkdtempSync(join(tmpdir(),'tips-agents-overview-'));
  const config={stateDir:dir};
  const tips=createTipsV2(config);
  return {dir,config,tips,cleanup:()=>rmSync(dir,{recursive:true,force:true})};
}
test('Agent page combines actual Main/Sub/Web/legacy sources without inventing online status',()=>{
  const x=fixture();
  try{
    const registry=createWebIdentityStore(x.config);
    const invite=registry.prepare({id:'web-reviewer',label:'Reviewer'});
    registry.claim({id:'web-reviewer',invite:invite.invite,scope:'reviewer-chat'});
    x.tips.mutate({action:'update',id:'tips-server-controller',title:'Server main',status:'pending',message:'等待新指令'});
    x.tips.mutate({action:'update',id:'sub-air',status:'running',title:'Sub AIR',message:'正在检查 CPU tests'});
    x.tips.mutate({action:'update',id:'air-goal',status:'running',title:'Research job',message:'正在跑独立实验'});
    const dir=join(x.tips.dir,'subagents');mkdirSync(dir,{recursive:true});
    writeFileSync(join(dir,'registry.json'),JSON.stringify({agents:{'sub-air':{name:'sub-air',model:'gpt-6-luna',status:'running',updatedAt:'2026-10-12T08:00:00Z',group:'AIR',goalFile:'/secret/goal.txt',claimKey:'must-not-leak'}}}));
    x.tips.messages({action:'post',from:'web-reviewer',to:'sub-air',subject:'Please review',body:'Secret conversation content'}, {trustedWake:true});
    const overview=buildAgentOverview(x.config,x.tips,{serviceStatus:unit=>unit.includes('server-controller')?'active':'active',panes:()=> 'air-life-causal-corrected-1012|bash|1234\nother-project|python|2345',now:()=>Date.parse('2026-10-12T08:00:00Z')});
    assert.equal(overview.groups.main[0].status,'listening');
    assert.equal(overview.groups.subs.length,1);
    assert.equal(overview.groups.subs[0].status,'running');
    assert.match(overview.groups.subs[0].summary,/CPU tests/);
    assert.equal(overview.groups.subs[0].mailbox.unread,1);
    assert.equal(overview.groups.subs[0].mailbox.last.subject,'Please review');
    assert.equal(overview.groups.web[0].status,'claimed');
    assert.match(overview.groups.web[0].summary,/无法从服务器判断/);
    assert.equal(overview.groups.legacy.length,1);
    assert.equal(overview.groups.tracked.length,1);
    const exposed=JSON.stringify(overview);
    assert.ok(!exposed.includes(invite.invite));
    assert.ok(!exposed.includes('Secret conversation content'));
    assert.ok(!exposed.includes('/secret/goal.txt'));
    assert.ok(!exposed.includes('must-not-leak'));
  }finally{x.cleanup()}
});

test('Registry empty and missing systemd/tmux remain honest and do not fail',()=>{
  const x=fixture();
  try{
    const s=buildAgentOverview(x.config,x.tips,{serviceStatus:()=> 'unknown',panes:()=>'',now:()=>0});
    assert.equal(s.counts.subagents,0);
    assert.equal(s.counts.web,0);
    assert.equal(s.counts.legacy,0);
    assert.equal(s.groups.main[0].status,'unknown');
    assert.ok(s.groups.main[0].summary);
  }finally{x.cleanup()}
});
