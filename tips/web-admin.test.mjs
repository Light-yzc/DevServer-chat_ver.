import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {z} from 'zod/v4';
import {createWebIdentityStore} from '../vendor/devspace/dist/web-identity-store.js';
import {registerWebIdentityTools} from '../vendor/devspace/dist/web-identity-tool.js';

const key='private-admin-key-for-tests-only-123456789';
function fixture(){
  const dir=mkdtempSync(join(tmpdir(),'tips-admin-test-'));
  const config={stateDir:dir,security:{webAdminKey:key}};
  const store=createWebIdentityStore(config);
  const slot=store.prepare({id:'web-abandoned-01',label:'Abandoned chat'});
  const claim=store.claim({id:slot.identity.id,invite:slot.invite,scope:'old-chat'});
  const tools={};
  registerWebIdentityTools({registerTool:(id,schema,handler)=>tools[id]=handler},config,z);
  const call=async args=>{
    const r=await tools.web_identity(args,{_meta:{}});
    const text=r.content[0].text;
    let data;try{data=JSON.parse(text)}catch{data=text}
    return {error:Boolean(r.isError),data};
  };
  return {store,dir,claim,call,cleanup:()=>rmSync(dir,{recursive:true,force:true})};
}
test('one direct revoke with provided admin key cancels another Web chat identity',async()=>{
  const x=fixture();try{
    assert.equal((await x.call({action:'revoke',id:'web-abandoned-01'})).error,true);
    assert.equal((await x.call({action:'revoke',id:'web-abandoned-01',adminKey:'not-the-key'})).error,true);
    assert.equal(x.store.whoami({scope:'old-chat'}).recognized,true);
    const revoked=await x.call({action:'revoke',id:'web-abandoned-01',adminKey:key,reason:'No longer used'});
    assert.equal(revoked.error,false);
    assert.equal(revoked.data.revoked,true);
    assert.equal(revoked.data.identity.status,'revoked');
    assert.equal(x.store.whoami({scope:'old-chat'}).recognized,false);
    assert.equal(x.store.whoami({claimKey:x.claim.claimKey}).recognized,false);
    assert.equal(x.store.list()[0].id,'web-abandoned-01');
    assert.equal(x.store.list()[0].status,'revoked');
    const newInvite=x.store.prepare({id:'web-abandoned-01',label:'Reclaimed later'});
    assert.equal(newInvite.identity.status,'available');
    const audit=JSON.parse(readFileSync(join(x.dir,'tips/web-identities.json'),'utf8')).adminEvents;
    assert.equal(audit[0].target,'web-abandoned-01');
    assert.equal(audit[0].reason,'No longer used');
    assert.ok(!JSON.stringify(audit).includes(key));
  }finally{x.cleanup()}
});
test('revoke is permitted without claiming a Web role but requires key every time',async()=>{
  const x=fixture();try{
    const result=await x.call({action:'revoke',id:'web-abandoned-01',adminKey:key});
    assert.equal(result.error,false);
    const result2=await x.call({action:'revoke',id:'web-abandoned-01'});
    assert.equal(result2.error,true);
  }finally{x.cleanup()}
});
