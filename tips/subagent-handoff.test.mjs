import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createTipsV2,mainWakeEligible,MAIN_WAKE_BATCH_DELAY_MS} from '../vendor/devspace/dist/tips-core.js';
import {emitResearchMilestone} from './subagent-handoff.mjs';

test('unowned AIR Luna completion is passive Local evidence, never a Sol wake',()=>{
  const dir=mkdtempSync(join(tmpdir(),'tips-handoff-'));
  try{
    const tips=createTipsV2({stateDir:dir});
    const args={name:'sub-air-qa',jobId:'job-a',group:'AIR-Research',
      startedAt:'2026-10-13T08:00:00Z',resultPath:'/research/qa/result.txt'};
    const first=emitResearchMilestone(tips,args);
    assert.equal(first.to,'server-controller');
    assert.equal(first.priority,'normal');
    assert.equal(first.wakeAuthorized,false);
    assert.match(first.body,/不等于科研成果通过验收/);
    assert.equal(mainWakeEligible(first,Date.parse(first.at)+MAIN_WAKE_BATCH_DELAY_MS-1),false);
    assert.equal(emitResearchMilestone(tips,args).id,first.id,'Same result is idempotent');
    const newer=emitResearchMilestone(tips,{...args,jobId:'job-b',resultExcerpt:'Additional evidence is now ready'});
    assert.equal(newer.wakeAuthorized,false,'New completion is recorded without another Sol wake');
    assert.match(newer.body,/Additional evidence is now ready/);
    assert.equal(emitResearchMilestone(tips,{...args,name:'sub-tips-ui',group:'Infrastructure'}),null,'Unrelated infrastructure does not wake research Main');
    assert.equal(tips.messages({action:'list',to:'server-controller'}).length,2);
  }finally{rmSync(dir,{recursive:true,force:true})}
});

test('Sub interim message does not suppress final evidence from that Turn, without waking Sol',()=>{
  const dir=mkdtempSync(join(tmpdir(),'tips-handoff-existing-'));
  try{
    const tips=createTipsV2({stateDir:dir}),name='sub-air-review';
    tips.messages({action:'post',from:name,to:'server-controller',
      subject:'QA verdict',body:'Verified paths, decision needed',wake:true},{trustedWake:true});
    const result=emitResearchMilestone(tips,{name,jobId:'job-c',group:'AIR-Research',
      startedAt:'2026-10-12T00:00:00Z',resultPath:'/research/qa/result.txt'});
    assert.ok(result);
    assert.match(result.subject,/job-c/);
    assert.equal(result.wakeAuthorized,false);
    assert.equal(tips.messages({action:'list',to:'server-controller'}).length,2);
  }finally{rmSync(dir,{recursive:true,force:true})}
});

test('Web-delegated Job reports ONLY to Web Owner and dedupes retries',()=>{
  const dir=mkdtempSync(join(tmpdir(),'tips-owner-handoff-'));
  try{
    const tips=createTipsV2({stateDir:dir});
    const args={name:'sub-air-owner-qa',jobId:'job-123',group:'AIR-Research',
      startedAt:'2026-10-14T00:00:00Z',resultPath:'/research/qa/result.txt',
      owner:'web-air-main',reportPath:'/private/handoff.json',status:'completed'};
    emitResearchMilestone(tips,args);
    assert.equal(tips.messages({action:'list',to:'server-controller'}).length,0);
    const ownerMail=tips.messages({action:'list',to:'web-air-main'});
    assert.equal(ownerMail.length,1);
    assert.match(ownerMail[0].body,/job-123/);
    emitResearchMilestone(tips,args);
    assert.equal(tips.messages({action:'list',to:'server-controller'}).length,0);
    assert.equal(tips.messages({action:'list',to:'web-air-main'}).length,1);
  }finally{rmSync(dir,{recursive:true,force:true})}
});

test('trusted message idempotency key prevents duplicate events after dispatcher retries',()=>{
  const dir=mkdtempSync(join(tmpdir(),'tips-idempotency-'));
  try{
    const tips=createTipsV2({stateDir:dir});
    const args={action:'post',from:'sub-air-qa',to:'server-controller',
      subject:'Final report',body:'Verified file evidence',dedupeKey:'handoff:sub-air-qa:job-uuid:server-controller'};
    assert.throws(()=>tips.messages(args),/idempotency key|trusted/i);
    const first=tips.messages(args,{trustedWake:true});
    const second=tips.messages({...args,body:'do not replace original'},{trustedWake:true});
    assert.equal(first.id,second.id);
    assert.equal(second.body,first.body);
    assert.equal(tips.messages({action:'list',to:args.to}).length,1);
    const other=tips.messages({...args,to:'web-air-main',dedupeKey:args.dedupeKey.replace('server-controller','web-air-main')},{trustedWake:true});
    assert.notEqual(other.id,first.id);
  }finally{rmSync(dir,{recursive:true,force:true})}
});
test('infrastructure Sub reports to its authenticated Web requester without waking scientific Local Sol',()=>{
  const dir=mkdtempSync(join(tmpdir(),'tips-infra-web-handoff-'));
  try{
    const tips=createTipsV2({stateDir:dir});
    emitResearchMilestone(tips,{name:'sub-tips-qa',jobId:'job-infra-web',group:'Infrastructure',
      resultPath:'/tmp/qa-result',owner:'web-air-main'});
    assert.equal(tips.messages({action:'list',to:'server-controller'}).length,0);
    assert.equal(tips.messages({action:'list',to:'web-air-main'}).length,1);
  }finally{rmSync(dir,{recursive:true,force:true})}
});
