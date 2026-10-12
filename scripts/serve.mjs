#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { PROJECT_ROOT,runtimeEnv,assertSetup } from './runtime.mjs';
assertSetup();
const child=spawn(process.execPath,[join(PROJECT_ROOT,'vendor/devspace/dist/cli.js'),'serve'],
  {cwd:PROJECT_ROOT,env:runtimeEnv(),stdio:'inherit'});
child.on('error',error=>{console.error('DevSpace server start failed:',error.message);process.exitCode=1});
child.on('exit',(code,signal)=>{process.exitCode=code??(signal?1:0)});
process.on('SIGTERM',()=>child.kill('SIGTERM'));
process.on('SIGINT',()=>child.kill('SIGINT'));
