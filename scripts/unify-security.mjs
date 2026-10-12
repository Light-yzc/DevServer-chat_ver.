#!/usr/bin/env node
/** One-time, non-destructive migration of existing OAuth/Tips secrets into
 * private security.json. NEVER prints any credentials to stdout. */
import {existsSync,mkdirSync,readFileSync,writeFileSync,chmodSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {randomBytes} from 'node:crypto';
import {CONFIG_DIR as DEFAULT_CONFIG_DIR,STATE_DIR as DEFAULT_STATE_DIR} from './runtime.mjs';

// Production migration can target an existing DevSpace install without
// copying private data into this Git repository's development config.
const CONFIG_DIR=resolve(process.env.DEVSPACE_CONFIG_DIR??DEFAULT_CONFIG_DIR);
const STATE_DIR=resolve(process.env.DEVSPACE_STATE_DIR??DEFAULT_STATE_DIR);

const path=join(CONFIG_DIR,'security.json');
if(existsSync(path)){
  chmodSync(path,0o600);
  console.log('Existing security.json kept unchanged (0600).');
  process.exit(0);
}
const configAuth=join(CONFIG_DIR,'auth.json');
const oldTips=join(STATE_DIR,'tips','credentials.json');
mkdirSync(CONFIG_DIR,{recursive:true,mode:0o700});chmodSync(CONFIG_DIR,0o700);
const auth=existsSync(configAuth)?JSON.parse(readFileSync(configAuth,'utf8')):{};
const tips=existsSync(oldTips)?JSON.parse(readFileSync(oldTips,'utf8')):{};
if(!auth.ownerToken)throw Error('OAuth owner token missing; first run npm run setup');
const random=n=>randomBytes(n).toString('hex');
const secret={version:1,oauthOwnerToken:auth.ownerToken,tips:{
  viewToken:tips.viewToken??random(24),writeToken:tips.writeToken??random(32),
  dispatchToken:tips.dispatchToken??random(32)},
  webAdminKey:random(32)};
// x prevents silent overwrite under concurrent setup runs.
writeFileSync(path,JSON.stringify(secret,null,2)+'\n',{flag:'wx',mode:0o600});
chmodSync(path,0o600);
console.log('Created private security.json (0600). Existing OAuth/Tips credentials preserved.');
console.log('No secrets printed. Configure your own admin key using npm run admin:key (stdin).');
