/** Unified PRIVATE credential document. Values intentionally remain plaintext.
 * security.json MUST be kept outside Git and permissioned 0600. */
import {existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {devspaceConfigDir} from './user-config.js';

export const securityFile=(dir)=>join(dir,'security.json');
export function loadSecurityConfig(dir=devspaceConfigDir()){
  const path=securityFile(dir);
  if(!existsSync(path))return null;
  const config=JSON.parse(readFileSync(path,'utf8'));
  if(config.version!==1 || typeof config.oauthOwnerToken!=='string'||config.oauthOwnerToken.length<16 ||
    !config.tips || !['viewToken','writeToken','dispatchToken'].every(k=>typeof config.tips[k]==='string' && config.tips[k].length>=32) ||
    typeof config.webAdminKey!=='string' || config.webAdminKey.length<32){
    throw Error('Invalid security.json: required OAuth, Tips, Web-admin credentials or epoch missing');
  }
  return config;
}
