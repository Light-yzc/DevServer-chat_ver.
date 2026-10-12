#!/usr/bin/env node
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { CONFIG_DIR,STATE_DIR,PROJECT_ROOT } from './runtime.mjs';

const args=process.argv.slice(2);
const opts={};
for(let i=0;i<args.length;i++){
  const k=args[i];
  if(!['--allowed-root','--public-url','--host','--port'].includes(k)||!args[i+1]){
    throw Error(`Invalid argument ${k}; expected --allowed-root PATH [--public-url URL] [--host HOST] [--port N]`);
  }
  opts[k]=args[++i];
}
const configPath=join(CONFIG_DIR,'config.json');
const authPath=join(CONFIG_DIR,'auth.json');
const prior=existsSync(configPath)?JSON.parse(readFileSync(configPath,'utf8')):{};
const root=opts['--allowed-root']?resolve(opts['--allowed-root']):prior.allowedRoots?.[0]??PROJECT_ROOT;
if(!existsSync(root))throw Error(`Allowed workspace root does not exist: ${root}`);
const port=Number(opts['--port']??prior.port??7676);
if(!Number.isInteger(port)||port<=0||port>65535)throw Error('Invalid port');
const host=opts['--host']??prior.host??'127.0.0.1';
const publicBaseUrl=opts['--public-url']??prior.publicBaseUrl??`http://127.0.0.1:${port}`;
const url=new URL(publicBaseUrl);
if(!['http:','https:'].includes(url.protocol))throw Error('Public URL must be http(s)');
if(url.protocol==='http:'&&!['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw Error('Use HTTPS for nonlocal public URLs');
mkdirSync(CONFIG_DIR,{recursive:true,mode:0o700});chmodSync(CONFIG_DIR,0o700);
mkdirSync(STATE_DIR,{recursive:true,mode:0o700});chmodSync(STATE_DIR,0o700);
const config={...prior,host,port,allowedRoots:[root],publicBaseUrl:url.href.replace(/\/$/,''),stateDir:STATE_DIR,
  subagents:prior.subagents??{enabled:true,providers:[{id:'codex',enabled:true}]}};
writeFileSync(configPath,JSON.stringify(config,null,2)+'\n',{mode:0o600});chmodSync(configPath,0o600);
if(!existsSync(authPath)){
  writeFileSync(authPath,JSON.stringify({ownerToken:randomBytes(32).toString('hex')},null,2)+'\n',{mode:0o600});
}
chmodSync(authPath,0o600);
console.log('DevSpace + Tips configuration is ready.');
console.log('Workspace:',root,'\nMCP URL:',config.publicBaseUrl+'/mcp','\nTips:',config.publicBaseUrl+'/tips');
console.log('Private config:',CONFIG_DIR,'\nPrivate state:',STATE_DIR);
console.log('OAuth owner token is stored in var/config/auth.json (mode 0600), not printed or committed.');
console.log('Next: npm run doctor && npm start');
