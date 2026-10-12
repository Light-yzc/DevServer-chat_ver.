import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { createTipsV2 } from '../vendor/devspace/dist/tips-core.js';
import { createWakeToken } from './relay-core.mjs';
import { startWakeRelay } from './relay.mjs';

test('end-to-end: extension authenticates and receives only wake routing data',async()=>{
  const stateDir=mkdtempSync(join(tmpdir(),'wake-relay-'));
  const tips=createTipsV2({stateDir});
  const role='web-test-a';
  mkdirSync(join(stateDir,'tips'),{recursive:true});
  writeFileSync(join(stateDir,'tips','web-identities.json'),JSON.stringify({
    version:1,roles:{[role]:{id:role,status:'claimed',leaseExpiresAt:new Date(Date.now()+60_000).toISOString()}}
  }));
  const sent=tips.messages({action:'post',from:'server-controller',to:role,
    subject:'Sensitive job',body:'DO_NOT_TRANSMIT_THE_BODY',priority:'high'});
  const token=createWakeToken(stateDir);
  const relay=startWakeRelay({stateDir,port:0,intervalMs:60000});
  let ws;
  try {
    await once(relay.server,'listening');
    const port=relay.server.address().port;
    ws=new WebSocket(`ws://127.0.0.1:${port}/ws`,{headers:{Origin:'chrome-extension://abcdefghijklmnopabcdefghijklmnop'}});
    const packets=[];
    ws.on('message',data=>packets.push(JSON.parse(String(data))));
    await once(ws,'open');
    ws.send(JSON.stringify({type:'auth',token}));
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error('No wake snapshot received')),3000);
      const wait=setInterval(()=>{
        if(packets.some(p=>p.type==='snapshot')){clearTimeout(timer);clearInterval(wait);resolve();}
      },10);
    });
    const snapshot=packets.find(p=>p.type==='snapshot');
    assert.deepEqual(snapshot.roles,[role]);
    assert.deepEqual(snapshot.events,[{id:sent.id,to:role}]);
    assert.equal(JSON.stringify(packets).includes('DO_NOT_TRANSMIT_THE_BODY'),false);
    assert.equal(tips.messages({action:'get',id:sent.id}).status,'unread');
  }finally{
    if(ws)ws.terminate();
    await relay.close();
    rmSync(stateDir,{recursive:true,force:true});
  }
});
