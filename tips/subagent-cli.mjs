#!/usr/bin/env node
/** Local entry point for server Main Agent and CLI workers; same manager as MCP. */
import { readFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../vendor/devspace/dist/config.js';
import { createTipsV2 } from '../vendor/devspace/dist/tips-core.js';
import { subagentRegistry } from './subagents.mjs';
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
process.env.DEVSPACE_CONFIG_DIR??=join(ROOT,'var/config');
const config=loadConfig(),registry=subagentRegistry(config,createTipsV2(config));
const [action='list',name,...rest]=process.argv.slice(2);
const options={};
for(let i=0;i<rest.length;i+=2){
  if(!rest[i]?.startsWith('--')||rest[i+1]===undefined)throw Error('Expected --key value; received '+rest[i]);
  options[rest[i].slice(2)]=rest[i+1];
}
let out;
switch(action){
case 'list':out=registry.list();break;
case 'promote-full':{
  if(name!=='--confirm-all'||rest.length)throw Error('Usage: promote-full --confirm-all (requires all Subagents idle)');
  out=registry.promoteFullAccess();break;
}
case 'status':out=registry.status(name);break;
case 'stop':out=registry.stop(name);break;
case 'start':{
  const goal=options['goal-file']?readFileSync(options['goal-file'],'utf8'):options.goal;
  out=registry.start({name,goal,cwd:options.cwd,model:options.model||'gpt-6-luna',
    sandbox:options.sandbox||'danger-full-access',group:options.group||'Subagents'});break;
}
case 'message':out=registry.send({name,from:options.from||'server-controller',
  body:options.body,subject:options.subject||'Subagent instruction',priority:options.priority||'normal'});break;
default:
  console.error('Usage: node tips/subagent-cli.mjs start NAME --goal-file path [--cwd PATH --model gpt-6-luna]\n'
    +'       node tips/subagent-cli.mjs list | status NAME | message NAME --body TEXT | stop NAME\n'
    +'       node tips/subagent-cli.mjs promote-full --confirm-all (all Subagents must be idle)');
  process.exit(2);
}
console.log(JSON.stringify(out,null,2));
