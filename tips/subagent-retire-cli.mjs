#!/usr/bin/env node
/** Local Main/operator retirement helper: never prints or accepts admin tokens.
 * Usage: node tips/subagent-retire-cli.mjs candidates
 *        node tips/subagent-retire-cli.mjs retire sub-NAME --confirm sub-NAME --reason "..."
 */
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadConfig} from '../vendor/devspace/dist/config.js';
import {createTipsV2} from '../vendor/devspace/dist/tips-core.js';
import {retirementCandidates,retireSubagent} from './subagent-retirement.mjs';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
process.env.DEVSPACE_CONFIG_DIR??=ROOT+'/var/config';
const config=loadConfig(),tips=createTipsV2(config);
const [action='candidates',name,...argv]=process.argv.slice(2);
if(!['candidates','retire'].includes(action))throw Error('Supported actions: candidates, retire');
if(action==='candidates'){
  if(name!==undefined)throw Error('candidates takes no arguments');
  const all=retirementCandidates(config,tips);
  console.log(JSON.stringify({total:all.length,eligible:all.filter(a=>a.eligible).length,items:all},null,2));
}else{
  const flags={};
  if(argv.length!==4)throw Error('Usage: retire sub-NAME --confirm sub-NAME --reason "Retirement rationale"');
  for(let i=0;i<argv.length;i+=2){if(!['--confirm','--reason'].includes(argv[i])||flags[argv[i]])throw Error('Unexpected option');flags[argv[i]]=argv[i+1]}
  console.log(JSON.stringify(retireSubagent(config,tips,{name,confirmation:flags['--confirm'],reason:flags['--reason']}),null,2));
}
