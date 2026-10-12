#!/usr/bin/env node
/** Private Tips/Web-admin config. OAuth remains native to DevSpace in auth.json.
 * This script never prints credentials. */
import {existsSync,mkdirSync,readFileSync,writeFileSync,chmodSync,renameSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {randomBytes} from 'node:crypto';
import {CONFIG_DIR as DEFAULT_CONFIG_DIR,STATE_DIR as DEFAULT_STATE_DIR} from './runtime.mjs';

// Production migration can target an existing DevSpace install without
// copying private data into this Git repository's development config.
const CONFIG_DIR=resolve(process.env.DEVSPACE_CONFIG_DIR??DEFAULT_CONFIG_DIR);
const STATE_DIR=resolve(process.env.DEVSPACE_STATE_DIR??DEFAULT_STATE_DIR);

const path=join(CONFIG_DIR,'security.json');
if(existsSync(path)){
  // Upgrade older unified files by dropping the redundant OAuth copy.
  // The original DevSpace auth.json remains untouched.
  const previous=JSON.parse(readFileSync(path,'utf8'));
  let changed=false;
  if(Object.hasOwn(previous,'oauthOwnerToken')){
    delete previous.oauthOwnerToken;
    changed=true;
  }
  if(!Object.hasOwn(previous,'webWakeToken')){
    // Legacy hash-only relay credentials cannot be decoded. Generate a new
    // plaintext key in the unified config; browsers must pair once with it.
    previous.webWakeToken=randomBytes(32).toString('base64url');
    changed=true;
  }
  if(changed){
    const tmp=path+'.'+process.pid+'.tmp';
    try{
      writeFileSync(tmp,JSON.stringify(previous,null,2)+'\n',{mode:0o600,flag:'wx'});
      renameSync(tmp,path);
    }finally{rmSync(tmp,{force:true})}
    console.log('Unified private security.json updated; OAuth untouched. If Web Wake was paired with the legacy hash-only token, re-pair browser extension with the configured webWakeToken.');
  }
  chmodSync(path,0o600);
  console.log('Existing Tips/Web-admin/Web-Wake security.json retained (0600).');
  process.exit(0);
}
const oldTips=join(STATE_DIR,'tips','credentials.json');
mkdirSync(CONFIG_DIR,{recursive:true,mode:0o700});chmodSync(CONFIG_DIR,0o700);
const tips=existsSync(oldTips)?JSON.parse(readFileSync(oldTips,'utf8')):{};
const random=n=>randomBytes(n).toString('hex');
const secret={version:1,tips:{
  viewToken:tips.viewToken??random(24),writeToken:tips.writeToken??random(32),
  dispatchToken:tips.dispatchToken??random(32)},
  webAdminKey:random(32),webWakeToken:randomBytes(32).toString('base64url')};
// x prevents silent overwrite under concurrent setup runs.
writeFileSync(path,JSON.stringify(secret,null,2)+'\n',{flag:'wx',mode:0o600});
chmodSync(path,0o600);
console.log('Created private Tips/Web-admin/Web-Wake security.json (0600). Native DevSpace OAuth is unchanged.');
console.log('No secrets printed. Configure your own admin key using npm run admin:key (stdin).');
