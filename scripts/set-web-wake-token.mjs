#!/usr/bin/env node
/** Reads a user-selected Web Wake plaintext token from stdin, not argv/history.
 * No fixed token length/charset requirement, except that it cannot be empty. */
import {readFileSync,writeFileSync,chmodSync,renameSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {CONFIG_DIR as DEFAULT_CONFIG_DIR} from './runtime.mjs';
const configDir=resolve(process.env.DEVSPACE_CONFIG_DIR??DEFAULT_CONFIG_DIR);
const path=join(configDir,'security.json');
if(process.stdin.isTTY)throw Error('Pipe the desired Web Wake token over stdin (never shell argv/history).');
const token=readFileSync(0,'utf8').replace(/[\r\n]+$/,'');
if(!token)throw Error('Web Wake token must be nonempty');
const config=JSON.parse(readFileSync(path,'utf8'));
config.webWakeToken=token;
const temp=path+'.'+process.pid+'.tmp';
try{
  writeFileSync(temp,JSON.stringify(config,null,2)+'\n',{mode:0o600,flag:'wx'});
  renameSync(temp,path);
}finally{rmSync(temp,{force:true})}
chmodSync(path,0o600);
console.log('Updated webWakeToken in private security.json. Reload/reconnect the Web Wake browser extension with this value.');
