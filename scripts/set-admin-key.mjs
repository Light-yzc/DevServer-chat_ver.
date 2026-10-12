#!/usr/bin/env node
/** Usage: read a new plaintext administrator key from stdin (not argv/history). */
import {readFileSync,writeFileSync,chmodSync,renameSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {CONFIG_DIR as DEFAULT_CONFIG_DIR} from './runtime.mjs';
const CONFIG_DIR=resolve(process.env.DEVSPACE_CONFIG_DIR??DEFAULT_CONFIG_DIR);
const path=join(CONFIG_DIR,'security.json');
if(process.stdin.isTTY)throw Error('Pipe the key via stdin, do not put it in shell arguments/history.');
const key=readFileSync(0,'utf8').replace(/[\r\n]+$/,'');
if(!key.length)throw Error('Administrator key must be nonempty');
const config=JSON.parse(readFileSync(path,'utf8'));
config.webAdminKey=key;
const tmp=path+'.'+process.pid+'.tmp';
try{
  writeFileSync(tmp,JSON.stringify(config,null,2)+'\n',{mode:0o600});
  renameSync(tmp,path);
}finally{rmSync(tmp,{force:true})}
chmodSync(path,0o600);
console.log('Updated private plaintext administrator key. Restart DevSpace MCP to activate.');
