/** Deterministic Codex executable resolution for minimal systemd PATH.
 * Unlike an interactive shell, systemd user services may not inherit nvm or
 * ~/.local/bin. Explicit TIPS_CODEX_BIN takes precedence. */
import {accessSync,constants} from 'node:fs';
import {delimiter,join,isAbsolute} from 'node:path';

function executable(path){try{accessSync(path,constants.X_OK);return true}catch{return false}}
export function resolveCodexBin(env=process.env){
  const configured=env.TIPS_CODEX_BIN;
  if(configured){
    if(isAbsolute(configured)){
      if(executable(configured))return configured;
      throw Error('Configured TIPS_CODEX_BIN does not exist or cannot execute: '+configured);
    }
    // Allow configured simple binary name when explicitly present on PATH.
    for(const dir of (env.PATH??'').split(delimiter)){
      if(dir&&executable(join(dir,configured)))return join(dir,configured);
    }
    throw Error('Configured TIPS_CODEX_BIN not found on PATH: '+configured);
  }
  const home=env.HOME;
  const candidates=[
    ...(home?[join(home,'.local','bin','codex')]:[]),
    ...((env.PATH??'').split(delimiter).filter(Boolean).map(dir=>join(dir,'codex'))),
  ];
  for(const path of candidates)if(executable(path))return path;
  throw Error('Codex executable unavailable; install Codex or set TIPS_CODEX_BIN to the absolute path in the systemd user service.');
}
