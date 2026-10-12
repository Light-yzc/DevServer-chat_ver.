#!/usr/bin/env node
import { mkdirSync,writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { PROJECT_ROOT, assertSetup } from './runtime.mjs';
assertSetup();
const enable=process.argv.includes('--enable');
if(process.argv.slice(2).some(a=>a!=='--enable'))throw Error('Only --enable is supported');
const userDir=join(homedir(),'.config/systemd/user');
mkdirSync(userDir,{recursive:true,mode:0o700});
const name='devspace-tips-mcp.service';
const unit=`[Unit]\nDescription=DevSpace MCP + Tips + Codex App Server Research Agents\nAfter=network.target\n\n[Service]\nType=simple\nWorkingDirectory=${PROJECT_ROOT}\nExecStart=${process.execPath} ${join(PROJECT_ROOT,'scripts/start-stack.mjs')}\nRestart=on-failure\nRestartSec=10\nKillMode=control-group\nTimeoutStopSec=15\n\n[Install]\nWantedBy=default.target\n`;
const path=join(userDir,name);
writeFileSync(path,unit,{mode:0o600});
console.log('User service unit saved:',path);
const reload=spawnSync('systemctl',['--user','daemon-reload'],{stdio:'inherit'});
if(reload.status!==0)throw Error('Failed to reload systemd user units');
if(enable){
  const result=spawnSync('systemctl',['--user','enable','--now',name],{stdio:'inherit'});
  if(result.status!==0)throw Error('Could not enable service');
  console.log('Enabled and started:',name);
}else console.log('Not started. Review the unit then: systemctl --user enable --now '+name);
