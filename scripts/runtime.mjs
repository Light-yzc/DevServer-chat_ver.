import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROJECT_ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export const CONFIG_DIR=join(PROJECT_ROOT,'var/config');
export const STATE_DIR=join(PROJECT_ROOT,'var/state');

export function runtimeEnv() {
  const env={...process.env};
  const path=join(CONFIG_DIR,'runtime.env');
  if(existsSync(path)){
    for(const line of readFileSync(path,'utf8').split(/\r?\n/)){
      const matched=line.match(/^\s*([A-Za-z_][A-Za-z_0-9]*)\s*=\s*(.*?)\s*$/);
      if(!matched)continue;
      if(env[matched[1]]!==undefined)continue;
      let value=matched[2];
      if((value.startsWith('"')&&value.endsWith('"'))||(value.startsWith("'")&&value.endsWith("'")))value=value.slice(1,-1);
      env[matched[1]]=value;
    }
  }
  // Important: a shell started from the existing DevSpace MCP can inherit
  // the production DEVSPACE_CONFIG_DIR. Never reuse the old server's auth,
  // roots, port or Tips state when launching this standalone instance.
  env.DEVSPACE_CONFIG_DIR=CONFIG_DIR;
  env.DEVSPACE_STATE_DIR=STATE_DIR;
  env.DEVSPACE_TOOL_MODE??='codex';
  env.DEVSPACE_WIDGETS??='changes';
  env.DEVSPACE_ARTIFACTS??='true';
  env.DEVSPACE_BASH_COMPAT??='true';
  env.TIPS_SUBAGENT_MAX??='2';
  return env;
}

export function assertSetup(){
  if(!existsSync(join(CONFIG_DIR,'config.json'))||!existsSync(join(CONFIG_DIR,'auth.json'))){
    throw Error('Not configured. Run npm run setup -- --allowed-root /your/workspace --public-url https://your-domain.example');
  }
}
