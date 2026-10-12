#!/usr/bin/env node
/** Optional private-state import. Does NOT start or stop the existing instance. */
import { existsSync,mkdirSync,readFileSync,cpSync,chmodSync,statSync } from 'node:fs';
import { resolve,join } from 'node:path';
import { CONFIG_DIR,STATE_DIR } from './runtime.mjs';
const args=process.argv.slice(2);const opts={};
for(let i=0;i<args.length;i+=2){
  if(!['--from-config','--from-state'].includes(args[i])||!args[i+1])throw Error('Usage: node scripts/migrate-state.mjs --from-config PATH --from-state PATH');
  opts[args[i]]=resolve(args[i+1]);
}
if(!opts['--from-config']||!opts['--from-state'])throw Error('Specify both --from-config and --from-state');
if(!existsSync(opts['--from-config'])||!existsSync(opts['--from-state']))throw Error('Source path missing');
if(opts['--from-config']===CONFIG_DIR||opts['--from-state']===STATE_DIR)throw Error('Source and destination must be distinct');
mkdirSync(CONFIG_DIR,{recursive:true,mode:0o700});
mkdirSync(STATE_DIR,{recursive:true,mode:0o700});
for(const name of ['config.json','auth.json']){
  const src=join(opts['--from-config'],name),dst=join(CONFIG_DIR,name);
  if(!existsSync(src))throw Error(`Source ${src} not found`);
  if(existsSync(dst))throw Error(`Refusing to overwrite ${dst}; back up and clear target before migration`);
}
// Do not clobber private runtime state or active leases of another installation.
if(existsSync(join(STATE_DIR,'tips')))throw Error('Destination already contains Tips state; refusing to overwrite');
for(const name of ['config.json','auth.json']){
  cpSync(join(opts['--from-config'],name),join(CONFIG_DIR,name),{errorOnExist:true,force:false});
  chmodSync(join(CONFIG_DIR,name),0o600);
}
for(const item of ['tips']){
  const src=join(opts['--from-state'],item);
  if(existsSync(src))cpSync(src,join(STATE_DIR,item),{recursive:true,errorOnExist:true,force:false});
}
const configPath=join(CONFIG_DIR,'config.json');
const cfg=JSON.parse(readFileSync(configPath,'utf8'));
cfg.stateDir=STATE_DIR;
// Avoid automatically carrying live port bindings into a running old server.
// Change port/host explicitly with `npm run setup -- --port ...` before startup.
const {writeFileSync}=await import('node:fs');
writeFileSync(configPath,JSON.stringify(cfg,null,2)+'\n',{mode:0o600});
console.log('Copied config/auth and Tips private state. Existing service was NOT changed.');
console.log('Review config at '+configPath+' and verify workspace roots and port before starting.');
process.env.DEVSPACE_CONFIG_DIR=CONFIG_DIR;
process.env.DEVSPACE_STATE_DIR=STATE_DIR;
await import('./unify-security.mjs');
