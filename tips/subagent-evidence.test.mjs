import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,symlinkSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import express from 'express';
import {createTipsV2} from '../vendor/devspace/dist/tips-core.js';
import {subagentRegistry} from './subagents.mjs';
import {mountTipsRoutes} from '../vendor/devspace/dist/tips.js';
import {beginGitEvidence,finishGitEvidence,readSubEvidence,listSubJobEvidence,writeSubHandoff,
  extractSubReport,redactEvidence} from './subagent-evidence.mjs';

function fixture(){const root=mkdtempSync(join(tmpdir(),'sub-evidence-'));
  const repo=join(root,'work'),dir=join(root,'evidence');mkdirSync(repo);mkdirSync(dir);
  const run=(...args)=>execFileSync('git',['-C',repo,...args],{encoding:'utf8'});
  run('init','-q');run('config','user.email','unit@example.invalid');run('config','user.name','Test');
  writeFileSync(join(repo,'file.txt'),'baseline\n');run('add','file.txt');run('commit','-qm','base');
  return {root,repo,dir,run,name:'sub-air-local-qa',jobId:randomUUID(),cleanup:()=>rmSync(root,{recursive:true,force:true})};
}

test('each job preserves start and end Git snapshots and a bounded patch without claiming authorship',()=>{
  const x=fixture();try{
    writeFileSync(join(x.repo,'file.txt'),'dirty-before-start\n');
    const start=beginGitEvidence({...x,cwd:x.repo});assert.equal(start.available,true);
    writeFileSync(join(x.repo,'file.txt'),'dirty-after-sub-turn\n');
    const end=finishGitEvidence({...x,cwd:x.repo});
    assert.equal(end.baselineDirty,true);
    assert.equal(end.workingDiffChanged,true);
    assert.equal(end.headChanged,false);
    assert.equal(end.provenance,'shared_workspace_unattributed');
    const patch=readSubEvidence({dir:x.dir,name:x.name,jobId:x.jobId,kind:'diff'});
    assert.equal(patch.available,true);
    assert.match(patch.excerpt,/dirty-after-sub-turn/);
    assert.match(patch.note,/not an Agent-attributed patch/);
    assert.equal(readSubEvidence({dir:x.dir,name:x.name,jobId:x.jobId,kind:'manifest'}).available,true);
  }finally{x.cleanup()}
});

test('a commit made during a Turn remains visible in the baseline-to-final Git diff without extra checksums',()=>{
  const x=fixture();try{
    const start=beginGitEvidence({...x,cwd:x.repo});
    writeFileSync(join(x.repo,'file.txt'),'updated and committed\n');
    x.run('add','file.txt');x.run('commit','-qm','change');
    const end=finishGitEvidence({...x,cwd:x.repo});
    assert.equal(end.headChanged,true);
    assert.equal(end.baselineHead,start.head);
    assert.notEqual(end.head,start.head);
    assert.equal(end.patchAvailable,true);
    const patch=readSubEvidence({dir:x.dir,name:x.name,jobId:x.jobId,kind:'diff'});
    assert.match(patch.excerpt,/updated and committed/);
    assert.equal('patchSha256' in end,false);
  }finally{x.cleanup()}
});

test('structured handoff is durable, self-reported tests stay unverified, and jobs are discoverable',()=>{
  const x=fixture();try{
    beginGitEvidence({...x,cwd:x.repo});const git=finishGitEvidence({...x,cwd:x.repo});
    const result='<sub-report>'+JSON.stringify({summary:'CPU QA passed',files:['src/main.py'],
      tests:[{command:'pytest -q',outcome:'pass',evidence:'/tmp/cpu-tests.log'}],
      blockers:[],nextOwner:'web-air-main',nextAction:'Independent review'})+'</sub-report>';
    const report=writeSubHandoff({...x,status:'completed',exitCode:0,
      startedAt:'2026-10-14T00:00:00Z',finishedAt:'2026-10-14T01:00:00Z',requestedBy:'web-air-main',
      goal:'Review CPU result',result,gitEvidence:git});
    assert.equal(report.scientificAcceptance,'not_verified');
    assert.equal(report.tests[0].outcome,'pass');
    assert.equal(report.testEvidenceLevel,'sub_self_reported_unverified');
    assert.equal(report.subReport.files[0],'src/main.py');
    assert.equal(listSubJobEvidence({dir:x.dir,name:x.name})[0].jobId,x.jobId);
    const saved=readSubEvidence({dir:x.dir,name:x.name,jobId:x.jobId,kind:'handoff'});
    assert.match(saved.excerpt,/CPU QA passed/);
    assert.match(saved.excerpt,/not_verified/);
  }finally{x.cleanup()}
});

test('log excerpts are capped and sensitive lines are redacted; symlinks and path traversal are rejected',()=>{
  const x=fixture();try{
    const path=join(x.dir,`${x.name}-${x.jobId}.stdout.log`);
    writeFileSync(path,'normal line\n'+('line '+('x'.repeat(100))+'\n').repeat(1000)+'api_key=super-private\nend\n');
    const out=readSubEvidence({dir:x.dir,name:x.name,jobId:x.jobId,kind:'log',limitChars:500});
    assert.equal(out.available,true);assert.equal(out.truncated,true);
    assert.doesNotMatch(out.excerpt,/super-private/);
    assert.match(out.excerpt,/REDACTED/);
    assert.throws(()=>readSubEvidence({dir:x.dir,name:'../etc',jobId:x.jobId}),/Invalid/);
    assert.throws(()=>readSubEvidence({dir:x.dir,name:x.name,jobId:'../etc'}),/Invalid/);
    symlinkSync('/etc/passwd',join(x.dir,`${x.name}-${x.jobId}.last.txt`));
    assert.throws(()=>readSubEvidence({dir:x.dir,name:x.name,jobId:x.jobId,kind:'result'}),/regular evidence file/);
  }finally{x.cleanup()}
});

test('malformed sub-report is rejected; secret data is not forwarded in report snippets',()=>{
  assert.equal(extractSubReport('<sub-report>not json</sub-report>'),null);
  assert.equal(extractSubReport('no report'),null);
  const result=extractSubReport('<sub-report>{"summary":"github_pat_FAKE","tests":[]}</sub-report>');
  assert.match(result.summary,/REDACTED/);
  assert.doesNotMatch(result.summary,/github_pat/);
  assert.match(redactEvidence('access_token=123\nvisible'),/REDACTED/);
});

test('a Sub claiming docs updated without observed file change is flagged for Main review',()=>{
  const x=fixture();try{
    const report=writeSubHandoff({...x,status:'completed',exitCode:0,
      result:'<sub-report>'+JSON.stringify({summary:'Updated docs',documentation:{updated:['README.md']}})+'</sub-report>',
      documentation:{status:'needs_documentation_review',changedDocs:[],note:'Unchanged documentation'}});
    assert.equal(report.documentation.status,'decision_claim_requires_verification');
    assert.deepEqual(report.documentation.falseUpdateClaims,['README.md']);
    assert.equal(report.scientificAcceptance,'not_verified');
  }finally{x.cleanup()}
});

test('Tips browser evidence endpoint enforces view token and serves bounded Job evidence without mutation',async()=>{
  const x=fixture();let server;
  try{
    const config={stateDir:x.root,allowedRoots:[x.repo]};
    const tips=createTipsV2(config),agents=subagentRegistry(config,tips);
    const a=agents.start({name:x.name,goal:'CPU-only review',cwd:x.repo});
    const report=writeSubHandoff({dir:agents.dir,name:a.name,jobId:a.jobId,
      startedAt:a.startedAt,finishedAt:new Date().toISOString(),
      status:'completed',exitCode:0,result:'An evidence-backed final report'});
    assert.equal(report.jobId,a.jobId);
    const app=express();mountTipsRoutes(app,config,express);
    server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s))});
    const base='http://127.0.0.1:'+server.address().port+'/tips/evidence/api';
    const params=new URLSearchParams({name:a.name,job:a.jobId,kind:'handoff'});
    const request=(q,token)=>fetch(base+'?'+q,{headers:{Authorization:'Bearer '+token}});
    assert.equal((await request(params,'invalid')).status,401);
    const ok=await request(params,tips.credentials.viewToken);
    assert.equal(ok.status,200);assert.match((await ok.json()).excerpt,/not_verified/);
    const jobs=await request(new URLSearchParams({name:a.name,kind:'jobs'}),tips.credentials.viewToken);
    assert.equal(jobs.status,200);assert.equal((await jobs.json()).jobs[0].jobId,a.jobId);
    const bad=await request(new URLSearchParams({name:'../../etc/passwd',kind:'log'}),tips.credentials.viewToken);
    assert.equal(bad.status,400);
    assert.equal(agents.status(a.name).status,'queued','read API does not start, finish or stop a Subagent');
  }finally{if(server)await new Promise(resolve=>server.close(resolve));x.cleanup()}
});
