import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod/v4';
import { createWebIdentityStore } from '../vendor/devspace/dist/web-identity-store.js';
import { createTipsV2 } from '../vendor/devspace/dist/tips-core.js';
import { registerWebIdentityTools } from '../vendor/devspace/dist/web-identity-tool.js';
import { registerTipsTool } from '../vendor/devspace/dist/tips.js';

function harness(){
  const path=mkdtempSync(join(tmpdir(),'web-mcp-end2end-'));
  const tools={};
  const server={registerTool:(name,definition,handler)=>{tools[name]=handler}};
  registerWebIdentityTools(server,{stateDir:path},z);
  registerTipsTool(server,{stateDir:path},z);
  const call=async(name,args,session)=>{
    const out=await tools[name](args,session?{_meta:{'openai/session':session}}:{_meta:{}});
    return {error:!!out.isError,data:out.content?.[0]?.text?parse(out.content[0].text):null};
  };
  const parse=text=>{try{return JSON.parse(text)}catch{return text}};
  return {call,tips:createTipsV2({stateDir:path}),store:createWebIdentityStore({stateDir:path}),cleanup:()=>rmSync(path,{recursive:true,force:true})};
}

test('multiple web chats claim separately and recognize by conversation metadata',async()=>{
  const h=harness();try{
    const p1=await h.call('web_identity',{action:'prepare',id:'web-main',label:'Main Web'},'main-chat');
    const p2=await h.call('web_identity',{action:'prepare',id:'web-reviewer',label:'Reviewer Web'},'main-chat');
    assert.equal(p1.error,false);assert.equal(p2.error,false);
    const main=await h.call('web_identity',{action:'claim',id:'web-main',invite:p1.data.invite},'main-chat');
    const reviewer=await h.call('web_identity',{action:'claim',id:'web-reviewer',invite:p2.data.invite},'other-chat');
    assert.equal(main.data.identity.id,'web-main');assert.equal(reviewer.data.identity.id,'web-reviewer');
    const identified=await h.call('web_identity',{action:'whoami'},'other-chat');
    assert.equal(identified.data.identity.id,'web-reviewer');
    assert.equal(identified.data.by,'conversation_scope');
    assert.equal((await h.call('web_identity',{action:'whoami'},'unknown')).data.recognized,false);
    assert.equal((await h.call('web_identity',{action:'claim',id:'web-main',invite:p1.data.invite},'unknown')).error,true);
  }finally{h.cleanup()}
});

test('web-main -> web-reviewer ACK, reply and acceptance, third chat cannot spoof',async()=>{
  const h=harness();try{
    const slotA=(await h.call('web_identity',{action:'prepare',id:'web-main',label:'Main'})).data;
    const slotB=(await h.call('web_identity',{action:'prepare',id:'web-reviewer',label:'Reviewer'})).data;
    await h.call('web_identity',{action:'claim',id:'web-main',invite:slotA.invite},'main');
    await h.call('web_identity',{action:'claim',id:'web-reviewer',invite:slotB.invite},'reviewer');
    const first=await h.call('web_mail',{action:'send',to:'web-reviewer',subject:'Please check',body:'Read design',tracked:true},'main');
    assert.equal(first.error,false);
    assert.equal(first.data.message.from,'web-main');
    assert.equal(first.data.message.to,'web-reviewer');
    const id=first.data.message.id;
    const inbox=await h.call('web_mail',{action:'inbox'},'reviewer');
    assert.equal(inbox.data.messages[0].id,id);
    assert.equal((await h.call('web_mail',{action:'get',id},'unknown')).error,true);
    assert.equal((await h.call('web_mail',{action:'ack',id},'main')).error,true);
    const ack=await h.call('web_mail',{action:'ack',id},'reviewer');
    assert.equal(ack.data.ackBy,'web-reviewer');
    const reply=await h.call('web_mail',{action:'reply',id,body:'I reviewed it'},'reviewer');
    assert.equal(reply.data.from,'web-reviewer');assert.equal(reply.data.to,'web-main');
    const approval=await h.call('web_mail',{action:'verify',id,verdict:'accepted',note:'Ready to use'},'reviewer');
    assert.equal(approval.data.verification.by,'web-reviewer');
    assert.equal(approval.data.verification.verdict,'accepted');
    const sent=await h.call('web_mail',{action:'sent'},'main');
    assert.ok(sent.data.messages.some(m=>m.id===id));
    const mainInbox=await h.call('web_mail',{action:'inbox'},'main');
    assert.ok(mainInbox.data.messages.some(m=>m.id===reply.data.id));
    const ordinary=await h.call('tips_messages',{action:'post',from:'web-main',to:'web-reviewer',body:'spoof'},'unknown');
    assert.equal(ordinary.error,true);
    const unauthorized=await h.call('web_mail',{action:'send',to:'web-main',body:'spoof'},'unknown');
    assert.equal(unauthorized.error,true);
    const other=await h.call('web_mail',{action:'ack',id},'unknown');
    assert.equal(other.error,true);
    assert.equal(h.tips.messages({action:'get',id}).status,'resolved');
  }finally{h.cleanup()}
});

test('claimKey fallback for environments without OpenAI conversation metadata',async()=>{
  const h=harness();try{
    const slot=(await h.call('web_identity',{action:'prepare',id:'web-fallback',label:'Fallback'})).data;
    const claim=await h.call('web_identity',{action:'claim',id:'web-fallback',invite:slot.invite});
    assert.equal(claim.data.scopeBound,false);
    assert.equal((await h.call('web_mail',{action:'inbox'})).error,true);
    assert.equal((await h.call('web_identity',{action:'whoami',claimKey:claim.data.claimKey})).data.identity.id,'web-fallback');
    const send=await h.call('web_mail',{action:'send',claimKey:claim.data.claimKey,to:'controller',body:'Test fallback identity'});
    assert.equal(send.data.message.from,'web-fallback');
  }finally{h.cleanup()}
});
