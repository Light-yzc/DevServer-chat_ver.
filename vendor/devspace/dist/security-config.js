/** Private Tips view/write/dispatch and Web Wake credentials. OAuth is separate.
 * security.json MUST be kept outside Git and permissioned 0600. */
import {existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {devspaceConfigDir} from './user-config.js';

export const securityFile=(dir)=>join(dir,'security.json');
export function loadSecurityConfig(dir=devspaceConfigDir()){
  const path=securityFile(dir);
  if(!existsSync(path))return null;
  const config=JSON.parse(readFileSync(path,'utf8'));
  if(config.version!==1 || !config.tips ||
    !['viewToken','writeToken','dispatchToken'].every(k=>typeof config.tips[k]==='string' && config.tips[k].length>0) ||
    (config.webWakeToken!==undefined && (typeof config.webWakeToken!=='string'||!config.webWakeToken.length))){
    throw Error('Invalid security.json: expected nonempty Tips and Web-Wake credentials');
  }
  return config;
}
