import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {loadConfig} from '../vendor/devspace/dist/config.js';
import {loadSecurityConfig} from '../vendor/devspace/dist/security-config.js';

test('DevSpace native OAuth is independent of private Tips/Web-admin config',()=>{
  const dir=mkdtempSync(join(tmpdir(),'devspace-oauth-separated-'));
  try{
    const ownerToken='native-oauth-owner-token-from-auth-json';
    writeFileSync(join(dir,'auth.json'),JSON.stringify({ownerToken}));
    writeFileSync(join(dir,'config.json'),JSON.stringify({port:17677,allowedRoots:[dir]}));
    writeFileSync(join(dir,'security.json'),JSON.stringify({
      version:1,tips:{viewToken:'v'.repeat(48),writeToken:'w'.repeat(64),dispatchToken:'d'.repeat(64)},
      // Legacy field must not override native OAuth, even before migration.
      oauthOwnerToken:'old-redundant-wrong-token',
    }));
    const config=loadConfig({...process.env,DEVSPACE_CONFIG_DIR:dir,DEVSPACE_STATE_DIR:join(dir,'state')});
    assert.equal(config.oauth.ownerToken,ownerToken);
    assert.equal(config.security.tips.viewToken,'v'.repeat(48));
    assert.equal(loadSecurityConfig(dir).tips.dispatchToken,'d'.repeat(64));
    const newDoc=JSON.parse(readFileSync(join(dir,'security.json'),'utf8'));
    delete newDoc.oauthOwnerToken;
    writeFileSync(join(dir,'security.json'),JSON.stringify(newDoc));
    assert.equal(loadConfig({...process.env,DEVSPACE_CONFIG_DIR:dir}).oauth.ownerToken,ownerToken);
  }finally{rmSync(dir,{recursive:true,force:true})}
});

test('user-owned plaintext security keys accept arbitrary nonempty values without fixed-length rules',()=>{
  const dir=mkdtempSync(join(tmpdir(),'devspace-user-security-'));
  try{
    const doc={version:1,tips:{viewToken:'v',writeToken:'w',dispatchToken:'d'},
      webWakeToken:'short key with spaces ✦'};
    writeFileSync(join(dir,'security.json'),JSON.stringify(doc));
    assert.deepEqual(loadSecurityConfig(dir),doc);
    const same={...doc,webWakeToken:'x'};
    writeFileSync(join(dir,'security.json'),JSON.stringify(same));
    assert.deepEqual(loadSecurityConfig(dir),same);
    writeFileSync(join(dir,'security.json'),JSON.stringify({...same,webWakeToken:''}));
    assert.throws(()=>loadSecurityConfig(dir),/Invalid security.json/);
  }finally{rmSync(dir,{recursive:true,force:true})}
});
