#!/usr/bin/env node
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { CONFIG_DIR,PROJECT_ROOT,STATE_DIR,runtimeEnv } from './runtime.mjs';
import {resolveCodexBin} from '../tips/codex-bin.mjs';
const env=runtimeEnv();let errors=0;
const check=(pass,message)=>{console.log(`${pass?'PASS':'FAIL'} ${message}`);if(!pass)errors++};
const version=process.versions.node.split('.').map(Number);
check(version[0]>22&&version[0]<27||version[0]===22&&version[1]>=19,'Node.js >=22.19 <27');
check(existsSync(join(PROJECT_ROOT,'vendor/devspace/dist/cli.js')),'Vendored DevSpace CLI');
check(existsSync(join(PROJECT_ROOT,'vendor/devspace/dist/tips.js')),'Tips MCP HTTP integration');
check(existsSync(join(PROJECT_ROOT,'vendor/devspace/dist/subagent-tool.js')),'Subagent MCP integration');
check(existsSync(join(PROJECT_ROOT,'node_modules/zod')),'Node dependencies installed (npm install)');
check(existsSync(join(CONFIG_DIR,'config.json'))&&existsSync(join(CONFIG_DIR,'auth.json')),'Private configuration exists');
check(existsSync(join(CONFIG_DIR,'security.json')),'Unified private security.json exists');
if(existsSync(join(CONFIG_DIR,'auth.json'))){
  const auth=JSON.parse(readFileSync(join(CONFIG_DIR,'auth.json'),'utf8'));
  check(typeof auth.ownerToken==='string'&&auth.ownerToken.length>=16,'OAuth owner token configured');
  check((statSync(join(CONFIG_DIR,'auth.json')).mode&0o077)===0,'OAuth token permissions 0600');
}
if(existsSync(join(CONFIG_DIR,'security.json'))){
  const sec=JSON.parse(readFileSync(join(CONFIG_DIR,'security.json'),'utf8'));
  check(sec.version===1&&
    ['viewToken','writeToken','dispatchToken'].every(k=>typeof sec.tips?.[k]==='string'&&sec.tips[k].length>0)&&
    typeof sec.webWakeToken==='string'&&sec.webWakeToken.length>0,
    'Tips (view=management), Web-Wake keys configured (contents not shown)');
  check((statSync(join(CONFIG_DIR,'security.json')).mode&0o077)===0,'Unified security file permissions 0600');
  const oldPath=join(STATE_DIR,'tips','credentials.json');
  if(existsSync(oldPath)){
    const legacy=JSON.parse(readFileSync(oldPath,'utf8'));
    check(['viewToken','writeToken','dispatchToken'].every(k=>!legacy[k]||sec.tips[k]===legacy[k]),
      'Existing Tips API tokens preserved');
  }
}
if(existsSync(join(CONFIG_DIR,'config.json'))){
  const config=JSON.parse(readFileSync(join(CONFIG_DIR,'config.json'),'utf8'));
  check(config.allowedRoots?.every(root=>existsSync(root)),'Allowed workspaces exist');
  check(config.stateDir===STATE_DIR,'Isolated private state directory');
  console.log('Configured MCP URL:',`${config.publicBaseUrl}/mcp`);
}
check(existsSync(STATE_DIR),'Private state directory exists');
try{
  const codex=resolveCodexBin(env);
  console.log('Codex executable resolved:',codex);
  check(true,'Local Main and Sub can locate Codex without an interactive shell PATH');
}catch(error){check(false,'Codex resolution: '+error.message)}
if(errors){console.error(`${errors} checks failed`);process.exitCode=1}else console.log('Deployment preflight passed.');
