import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createTipsV2} from '../vendor/devspace/dist/tips-core.js';
import {createWebIdentityStore} from '../vendor/devspace/dist/web-identity-store.js';
import {startWebJob,runBackgroundJob,reconcileJobs,jobStatus,deliverJob} from './web-job-trigger.mjs';

function fixture(){
  const stateDir=mkdtempSync(join(tmpdir(),'tips-web-job-test-'));
  const cwd=join(stateDir,'work');mkdirSync(cwd);
  const identities={list:()=>[{id:'web-air-main',status:'claimed',leaseExpiresAt:new Date(Date.now()+3_600_000).toISOString()}]};
  const tips=createTipsV2({stateDir});
  const id='webjob-qa-'+Date.now();
  const start=({command=process.execPath,args=['-e','process.exit(0)'],...options}={})=>
    startWebJob({stateDir,allowedRoots:[cwd],identities,runWorker:()=>({pid:process.pid}),
      id,to:'web-air-main',title:'CPU job',cwd,command,args,...options});
  return {stateDir,cwd,identities,tips,id,start,cleanup:()=>rmSync(stateDir,{recursive:true,force:true})};
}

test('successful detached command writes evidence, one durable Web mail, and no Subagent',async()=>{
  const x=fixture();try{
    const a=x.start({args:['-e','process.stdout.write("CPU ok\\n")']});
    assert.equal(a.status,'running');
    const result=await runBackgroundJob({stateDir:x.stateDir,id:x.id});
    assert.equal(result.status,'completed');assert.equal(result.exitCode,0);
    assert.match(readFileSync(a.log,'utf8'),/CPU ok/);
    const first=deliverJob({stateDir:x.stateDir,id:x.id,tips:x.tips});
    assert.equal(first.delivered,true);
    assert.equal(deliverJob({stateDir:x.stateDir,id:x.id,tips:x.tips}).alreadyDelivered,true);
    assert.equal(reconcileJobs({stateDir:x.stateDir,tips:x.tips}).delivered,0);
    const mail=x.tips.messages({action:'list',to:'web-air-main'});
    assert.equal(mail.length,1);assert.match(mail[0].subject,/completed/);
    assert.equal(mail[0].wakeAuthorized,false,'Web extension routes unread mail without a Sol wake');
    assert.equal(jobStatus(x.stateDir,x.id).status,'completed');
    assert.equal(x.tips.snapshot().tasks.some(t=>t.id.startsWith('sub-')),false);
  }finally{x.cleanup()}
});

test('nonzero exit and missing executable both generate failed Web continuation mail',async()=>{
  for(const testCase of [{args:['-e','process.exit(27)'],exit:27},
    {command:'/no/such/executable-web-job-test',args:[],exit:null}]){
    const x=fixture();try{
      x.start(testCase);
      const result=await runBackgroundJob({stateDir:x.stateDir,id:x.id});
      assert.equal(result.status,'failed');assert.equal(result.exitCode,testCase.exit);
      const delivery=deliverJob({stateDir:x.stateDir,id:x.id,tips:x.tips});
      assert.equal(delivery.status,'failed');
      assert.match(x.tips.messages({action:'list',to:'web-air-main'})[0].subject,/failed/);
    }finally{x.cleanup()}
  }
});

test('stable job ID is idempotent and mismatched reuse or unknown Web role is rejected',()=>{
  const x=fixture();try{
    const a=x.start(),b=x.start();
    assert.equal(a.existing,false);assert.equal(b.existing,true);
    assert.throws(()=>x.start({args:['-e','process.exit(1)']}),/different parameters/);
    assert.throws(()=>x.start({to:'web-unknown',id:'webjob-new-id'}),/claimed/);
    assert.throws(()=>x.start({id:'../escape'}),/Invalid/);
    assert.throws(()=>x.start({cwd:'/etc',id:'webjob-other-dir'}),/allowedRoots/);
    assert.equal(existsSync(join(x.stateDir,'tips','web-jobs',x.id,'job.json')),true);
  }finally{x.cleanup()}
});

test('reconcile recovers undelivered result and records unknown outcome for missing supervisor',()=>{
  const x=fixture();try{
    x.start();
    const p=join(x.stateDir,'tips','web-jobs',x.id);
    writeFileSync(join(p,'result.json'),JSON.stringify({id:x.id,status:'completed',exitCode:0,finishedAt:new Date().toISOString()}));
    const recovered=reconcileJobs({stateDir:x.stateDir,tips:x.tips});
    assert.equal(recovered.delivered,1);
    assert.equal(reconcileJobs({stateDir:x.stateDir,tips:x.tips}).delivered,0);
    assert.equal(x.tips.messages({action:'list',to:'web-air-main'}).length,1);
  }finally{x.cleanup()}
  const z=fixture();try{
    z.start();
    const p=join(z.stateDir,'tips','web-jobs',z.id);
    writeFileSync(join(p,'launch.json'),JSON.stringify({pid:99999999,startedAt:new Date().toISOString()}));
    const rec=reconcileJobs({stateDir:z.stateDir,tips:z.tips});
    assert.equal(rec.lost,1);
    assert.equal(jobStatus(z.stateDir,z.id).status,'lost');
    assert.match(z.tips.messages({action:'list',to:'web-air-main'})[0].body,/actual command outcome unknown/);
  }finally{z.cleanup()}
});

test('reused PID belonging to another process is not mistaken for the background supervisor',()=>{
  const x=fixture();try{
    x.start();
    const folder=join(x.stateDir,'tips','web-jobs',x.id);
    writeFileSync(join(folder,'launch.json'),JSON.stringify({pid:process.pid,startedAt:new Date().toISOString()}));
    const report=reconcileJobs({stateDir:x.stateDir,tips:x.tips});
    assert.equal(report.lost,1);
    assert.equal(jobStatus(x.stateDir,x.id).status,'lost');
  }finally{x.cleanup()}
});

test('completion notification never copies command-line arguments or runtime output',async()=>{
  const x=fixture();try{
    x.start({args:['-e','process.stdout.write("PRIVATE_SECRET_IN_OUTPUT_123")']});
    await runBackgroundJob({stateDir:x.stateDir,id:x.id});
    deliverJob({stateDir:x.stateDir,id:x.id,tips:x.tips});
    const mail=x.tips.messages({action:'list',to:'web-air-main'})[0];
    assert.doesNotMatch(mail.body,/PRIVATE_SECRET_IN_OUTPUT_123/);
    assert.doesNotMatch(mail.body,/process.stdout.write/);
  }finally{x.cleanup()}
});

test('actual detached CLI launch survives its caller and routes exactly one Web mail in isolated test state',async()=>{
  const x=fixture(),id='webjob-detached-cli-'+Date.now();
  try{
    const roles=createWebIdentityStore({stateDir:x.stateDir});
    const invite=roles.prepare({id:'web-air-main',label:'test background owner'}).invite;
    roles.claim({id:'web-air-main',invite,scope:'local-test-chat'});
    const cli=fileURLToPath(new URL('./web-job-cli.mjs',import.meta.url));
    const configDir=fileURLToPath(new URL('../var/config/',import.meta.url));
    const env={...process.env,DEVSPACE_CONFIG_DIR:configDir,
      DEVSPACE_STATE_DIR:x.stateDir,DEVSPACE_ALLOWED_ROOTS:x.cwd};
    const stdout=execFileSync(process.execPath,[cli,'start','--to','web-air-main','--id',id,
      '--title','Detached smoke job','--cwd',x.cwd,'--',process.execPath,'-e',
      'setTimeout(()=>{process.stdout.write("finished isolated task\\n")},100)'],
      {encoding:'utf8',env,timeout:8000});
    const launch=JSON.parse(stdout);assert.equal(launch.status,'running');
    let result=null;
    for(let i=0;i<80;i++){
      await new Promise(resolve=>setTimeout(resolve,100));
      result=jobStatus(x.stateDir,id);
      if(result?.delivery?.messageId)break;
    }
    assert.equal(result?.status,'completed',JSON.stringify(result));
    assert.ok(result.delivery.messageId,'background worker should notify after caller exits');
    assert.equal(x.tips.messages({action:'list',to:'web-air-main'}).length,1);
    assert.match(readFileSync(result.log,'utf8'),/finished isolated task/);
  }finally{x.cleanup()}
});
