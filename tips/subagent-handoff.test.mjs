import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createTipsV2,mainWakeEligible,MAIN_WAKE_BATCH_DELAY_MS} from '../vendor/devspace/dist/tips-core.js';
import {emitResearchMilestone} from './subagent-handoff.mjs';

test('Luna completion fallback sends one deferred scientific-verification handoff, never another model turn',()=>{
  const dir=mkdtempSync(join(tmpdir(),'tips-handoff-'));
  try{
    const tips=createTipsV2({stateDir:dir});
    const args={name:'sub-air-qa',jobId:'job-a',group:'AIR-Research',
      startedAt:'2026-10-13T08:00:00Z',resultPath:'/research/qa/result.txt'};
    const first=emitResearchMilestone(tips,args);
    assert.equal(first.to,'server-controller');
    assert.equal(first.priority,'normal');
    assert.equal(first.wakeAuthorized,true);
    assert.match(first.body,/不等于科研成果通过验收/);
    assert.equal(mainWakeEligible(first,Date.parse(first.at)+MAIN_WAKE_BATCH_DELAY_MS-1),false);
    assert.equal(emitResearchMilestone(tips,args),null,'Same result never resubmitted');
    assert.equal(emitResearchMilestone(tips,{...args,jobId:'job-b'}),null,'Existing unreviewed milestone prevents spam');
    assert.equal(emitResearchMilestone(tips,{...args,name:'sub-tips-ui',group:'Infrastructure'}),null,'Unrelated infrastructure does not wake research Main');
    assert.equal(tips.messages({action:'list',to:'server-controller'}).length,1);
  }finally{rmSync(dir,{recursive:true,force:true})}
});

test('Sub own verified message within the current Turn suppresses redundant manager handoff',()=>{
  const dir=mkdtempSync(join(tmpdir(),'tips-handoff-existing-'));
  try{
    const tips=createTipsV2({stateDir:dir}),name='sub-air-review';
    tips.messages({action:'post',from:name,to:'server-controller',
      subject:'QA verdict',body:'Verified paths, decision needed',wake:true},{trustedWake:true});
    const result=emitResearchMilestone(tips,{name,jobId:'job-c',group:'AIR-Research',
      startedAt:'2026-10-12T00:00:00Z',resultPath:'/research/qa/result.txt'});
    assert.equal(result,null);
    assert.equal(tips.messages({action:'list',to:'server-controller'}).length,1);
  }finally{rmSync(dir,{recursive:true,force:true})}
});
