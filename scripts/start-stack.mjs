#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { PROJECT_ROOT,runtimeEnv,assertSetup } from './runtime.mjs';

assertSetup();
const env=runtimeEnv();
const components=[
  ['devspace',join(PROJECT_ROOT,'vendor/devspace/dist/cli.js'),['serve']],
  ['main-sol',join(PROJECT_ROOT,'tips/server-controller.mjs'),[]],
  ['subagents',join(PROJECT_ROOT,'tips/subagent-manager.mjs'),[]],
];
const processes=[];let shuttingDown=false;
const stop=code=>{
  if(shuttingDown)return;
  shuttingDown=true;
  for(const {child} of processes){if(child.exitCode===null)child.kill('SIGTERM');}
  setTimeout(()=>{
    for(const {child} of processes)if(child.exitCode===null)child.kill('SIGKILL');
  },10_000).unref();
  process.exitCode=code;
};
for(const [name,entry,args] of components){
  const child=spawn(process.execPath,[entry,...args],{cwd:PROJECT_ROOT,env,stdio:['ignore','pipe','pipe']});
  const prefix=chunk=>String(chunk).split('\n').filter(Boolean).forEach(line=>console.log(`[${name}] ${line}`));
  child.stdout?.on('data',prefix);child.stderr?.on('data',prefix);
  child.on('error',error=>{console.error(`[${name}] spawn failed`,error.message);stop(1)});
  child.on('exit',(code,signal)=>{
    if(!shuttingDown){console.error(`[${name}] exited unexpectedly: ${code??signal}`);stop(1)}
  });
  processes.push({name,child});
}
process.on('SIGTERM',()=>stop(0));
process.on('SIGINT',()=>stop(0));
console.log('DevSpace + Tips stack launched with isolated private config/state.');
