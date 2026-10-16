#!/usr/bin/env node
/** Background shell/script run from a trusted Web Chat DevSpace terminal.
 * Completion or failure posts a durable Tips message to its explicit Web role.
 * No browser code, Subagent, MCP call or model is executed by this CLI.
 */
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';
import {loadConfig} from '../vendor/devspace/dist/config.js';
import {createTipsV2} from '../vendor/devspace/dist/tips-core.js';
import {createWebIdentityStore} from '../vendor/devspace/dist/web-identity-store.js';
import {startWebJob,runBackgroundJob,deliverJob,reconcileJobs,jobStatus} from './web-job-trigger.mjs';

const file=fileURLToPath(import.meta.url),repo=resolve(dirname(file),'..');
process.env.DEVSPACE_CONFIG_DIR??=repo+'/var/config';
const config=loadConfig(),tips=createTipsV2(config),identities=createWebIdentityStore(config);
const [action='help',...argv]=process.argv.slice(2);
const usage='Usage:\n'
 +'  node tips/web-job-cli.mjs start --to web-air-main --id webjob-example --title "Task" --cwd /absolute/workdir [--timeout-sec 3600] -- executable arg1 ...\n'
 +'  node tips/web-job-cli.mjs status webjob-example\n'
 +'  node tips/web-job-cli.mjs reconcile   # safe to run repeatedly from a systemd timer\n';
function parseStart(args){
  const split=args.indexOf('--');
  if(split<0||split===args.length-1)throw Error('Expected -- followed by executable and arguments');
  const opts={};
  const flags=args.slice(0,split);
  if(flags.length%2)throw Error('Options require values');
  for(let i=0;i<flags.length;i+=2){
    const key=flags[i];if(!['--to','--id','--title','--cwd','--timeout-sec'].includes(key)||Object.hasOwn(opts,key))throw Error('Invalid/duplicate option '+key);
    opts[key]=flags[i+1];
  }
  const [command,...commandArgs]=args.slice(split+1);
  if(!opts['--to']||!opts['--title']||!opts['--cwd'])throw Error('Required: --to --title --cwd');
  return {to:opts['--to'],id:opts['--id'],title:opts['--title'],cwd:opts['--cwd'],
    timeoutSec:opts['--timeout-sec']===undefined?0:Number(opts['--timeout-sec']),
    command,args:commandArgs};
}
try{
  if(action==='start'){
    const input=parseStart(argv);
    const output=startWebJob({stateDir:config.stateDir,allowedRoots:config.allowedRoots,identities,...input,
      runWorker:id=>{
        const p=spawn(process.execPath,[file,'worker',id],{
          cwd:repo,detached:true,stdio:'ignore',env:process.env});p.unref();return p;
      }});
    // A spawn failure is a terminal failure too, even when the child cannot run.
    if(output.launchError)try{deliverJob({stateDir:config.stateDir,id:output.id,tips})}catch{}
    console.log(JSON.stringify(output,null,2));
  }else if(action==='worker'){
    if(argv.length!==1)throw Error('worker requires exactly one ID');
    await runBackgroundJob({stateDir:config.stateDir,id:argv[0]});
    try{deliverJob({stateDir:config.stateDir,id:argv[0],tips})}
    catch(e){process.stderr.write('Delivery deferred to reconcile: '+String(e.message).slice(0,100)+'\n')}
  }else if(action==='status'){
    if(argv.length!==1)throw Error('status requires exactly one ID');
    const output=jobStatus(config.stateDir,argv[0]);if(!output)throw Error('Unknown Job');
    console.log(JSON.stringify(output,null,2));
  }else if(action==='reconcile'){
    if(argv.length)throw Error('reconcile accepts no extra options');
    const output=reconcileJobs({stateDir:config.stateDir,tips});
    console.log(JSON.stringify(output,null,2));
    if(output.errors.length)process.exitCode=1;
  }else{
    process.stdout.write(usage);if(action!=='help')process.exitCode=2;
  }
}catch(e){console.error('web-job:',String(e.message).slice(0,250));process.exitCode=1}
