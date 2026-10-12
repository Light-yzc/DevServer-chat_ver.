import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { allowSocketOrigin, collectWakeEvents, createWakeToken, verifyWakeToken } from './relay-core.mjs';

test('pairing token is independent, private and not overwritten',()=>{
  const dir=mkdtempSync(join(tmpdir(),'wake-test-'));
  try{
    const t=createWakeToken(dir);
    assert.equal(verifyWakeToken(dir,t),true);
    assert.equal(verifyWakeToken(dir,'fake'),false);
    assert.throws(()=>createWakeToken(dir),/already exists/);
  }finally{rmSync(dir,{recursive:true,force:true})}
});
test('unified security.json accepts user-set short/nonstandard Web Wake tokens and overrides the legacy hash',()=>{
  const dir=mkdtempSync(join(tmpdir(),'wake-unified-test-'));
  const conf=join(dir,'config');mkdirSync(conf);
  try{
    const old=createWakeToken(dir);
    assert.equal(verifyWakeToken(dir,old,{configDir:conf}),true,'legacy fallback before migration');
    const key='short key with whitespace ☺';
    writeFileSync(join(conf,'security.json'),JSON.stringify({version:1,webWakeToken:key}));
    assert.equal(verifyWakeToken(dir,key,{configDir:conf}),true);
    assert.equal(verifyWakeToken(dir,old,{configDir:conf}),false,'migrated config disallows previous key');
    assert.equal(verifyWakeToken(dir,'',{configDir:conf}),false);
    writeFileSync(join(conf,'security.json'),JSON.stringify({version:1,webWakeToken:'x'}));
    assert.equal(verifyWakeToken(dir,'x',{configDir:conf}),true,'single-char token accepted');
    assert.equal(verifyWakeToken(dir,key,{configDir:conf}),false,'rotation effective');
  }finally{rmSync(dir,{recursive:true,force:true})}
});
test('only claimed and unacknowledged recent messages are routed, without bodies',()=>{
  const now=Date.parse('2026-10-12T08:20:00Z');
  const roles=[{id:'web-reviewer',status:'claimed',leaseExpiresAt:new Date(now+30000).toISOString()},
    {id:'web-old',status:'claimed',leaseExpiresAt:new Date(now-1000).toISOString()},
    {id:'web-unclaimed',status:'available'}];
  const message=(id,to,at=new Date(now-1000).toISOString(),status='unread')=>({id,to,at,status,body:'TOP SECRET'});
  const messages=[message('11111111-1111-1111-1111-111111111111','web-reviewer'),
    message('11111111-1111-1111-1111-111111111111','web-reviewer'),
    message('22222222-2222-2222-2222-222222222222','web-old'),
    message('33333333-3333-3333-3333-333333333333','web-unclaimed'),
    message('44444444-4444-4444-4444-444444444444','web-reviewer',undefined,'acknowledged'),
    message('55555555-5555-5555-5555-555555555555','web-reviewer',new Date(now-9*60*60*1000).toISOString()),
    message('66666666-6666-6666-6666-666666666666','web-reviewer',new Date(now-40*24*60*60*1000).toISOString())];
  assert.deepEqual(collectWakeEvents({roles,messages,now}),[
    {id:'11111111-1111-1111-1111-111111111111',to:'web-reviewer'},
    {id:'55555555-5555-5555-5555-555555555555',to:'web-reviewer'},
  ]);
});
test('reject web pages as websocket clients',()=>{
  assert.equal(allowSocketOrigin('https://chatgpt.com'),false);
  assert.equal(allowSocketOrigin('chrome-extension://abcdefghijklmnopabcdefghijklmnop'),true);
  assert.equal(allowSocketOrigin(undefined),false);
});
