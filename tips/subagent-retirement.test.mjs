import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createTipsV2} from '../vendor/devspace/dist/tips-core.js';
import {subagentRegistry} from './subagents.mjs';
import {inspectRetirement,retirementCandidates,retireSubagent} from './subagent-retirement.mjs';

const DAY=86_400_000;
function fixture(){
  const dir=mkdtempSync(join(tmpdir(),'retirement-'));
  const work=join(dir,'workspace');mkdirSync(work);
  const config={stateDir:dir,allowedRoots:[work]};const tips=createTipsV2(config);
  const registry=subagentRegistry(config,tips);
  const name='sub-retirement-qa';const agent=registry.start({name,goal:'Local CPU-only note',cwd:work});
  registry.stop(name);
  registry.update(name,agent.jobId,{status:'completed',pid:null});
  tips.mutate({action:'update',id:name,status:'completed',message:'Finished source review'});
  return {dir,config,tips,registry,name,cleanup:()=>rmSync(dir,{recursive:true,force:true})};
}
// Simulate the passing of time; the production registry writes real wall clock.
const now=Date.now()+20*DAY;
test('candidate lists remain read-only and exclude recent and active Subagents',()=>{
  const x=fixture();try{
    assert.equal(retirementCandidates(x.config,x.tips,{now}).find(a=>a.name===x.name).eligible,true);
    assert.equal(inspectRetirement(x.tips,x.registry.status(x.name),{now:now-40*DAY}).eligible,false);
    const newer=x.registry.start({name:'sub-running',goal:'Still working',cwd:join(x.dir,'workspace')});
    assert.equal(inspectRetirement(x.tips,newer,{now}).eligible,false);
    assert.equal(x.registry.status(x.name).status,'completed');
  }finally{x.cleanup()}
});
test('unread mail, open ownership, blocked cards and failure circuit prevent retirement',()=>{
  const x=fixture();try{
    x.tips.messages({action:'post',from:'main',to:x.name,subject:'Followup',body:'Not handled'});
    assert.ok(inspectRetirement(x.tips,x.registry.status(x.name),{now}).reasons.includes('unread_mail'));
    assert.throws(()=>retireSubagent(x.config,x.tips,{name:x.name,confirmation:x.name,reason:'Owner reviewed archived old worker',now}),/unread_mail/);
  }finally{x.cleanup()}
  const y=fixture();try{
    y.tips.mutate({action:'update',id:'air-pending-qa',status:'running',owner:y.name});
    assert.ok(inspectRetirement(y.tips,y.registry.status(y.name),{now}).reasons.includes('referenced_by_open_task'));
    y.tips.mutate({action:'update',id:y.name,status:'blocked'});
    assert.ok(inspectRetirement(y.tips,y.registry.status(y.name),{now}).reasons.includes('task_not_terminal_or_missing'));
  }finally{y.cleanup()}
});
test('retirement requires exact name confirmation and keeps an audited history',()=>{
  const x=fixture();try{
    const a={name:x.name,reason:'Reviewed stale worker and archived all outputs',now};
    assert.throws(()=>retireSubagent(x.config,x.tips,a),/confirm/);
    const r=retireSubagent(x.config,x.tips,{...a,confirmation:x.name});
    assert.equal(r.retired,true);
    assert.equal(x.registry.status(x.name),null);
    const audit=readFileSync(join(x.tips.dir,'admin-audit.json'),'utf8');
    assert.ok(audit.includes('remove_sub'));
    assert.ok(audit.includes(x.name));
    assert.equal(audit.includes(x.tips.credentials.viewToken),false);
    assert.equal(x.tips.mutate({action:'get',id:x.name}).status,'completed');
  }finally{x.cleanup()}
});
