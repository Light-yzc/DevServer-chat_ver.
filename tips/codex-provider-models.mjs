/** Select a provider already configured in Codex's user-level config.toml.
 * We do not implement another inference client or edit Codex credentials.
 */
import {existsSync,readFileSync,lstatSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';

export const NATIVE_CODEX_MODELS=['gpt-6-luna','gpt-6.1-sol'];
// Preserve the Grok shorthand already exposed by the prior production tool.
// All NEW custom models can use the explicit provider parameter instead.
const LEGACY_MODEL_PROVIDERS=new Map([['grok-4.7','runanytime_grok']]);
const PROVIDER=/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;
const MODEL=/^[a-zA-Z0-9][a-zA-Z0-9._:/+-]{0,119}$/;
const ENV_KEY=/^[A-Z_][A-Z0-9_]{0,99}$/;

export function codexConfigPath(env=process.env){
  return join(env.CODEX_HOME||join(homedir(),'.codex'),'config.toml');
}

/** Only inspect TOML provider names and env_key names. Never parse/log values
 * that could be API credentials. Provider config remains Codex's source of truth.
 */
export function codexProviderInfo(provider,{configPath=codexConfigPath()}={}){
  if(!PROVIDER.test(provider))throw Error('Invalid Codex provider ID');
  if(!existsSync(configPath))throw Error('Codex user config.toml not found');
  const lines=readFileSync(configPath,'utf8').split(/\r?\n/);
  let inside=false,found=false,envKey=null,wireApi=null;
  for(const raw of lines){
    const line=raw.trim();
    const header=line.match(/^\[([^\]]+)\](?:\s*#.*)?$/);
    if(header){
      inside=header[1]===`model_providers.${provider}`;
      if(inside)found=true;
      continue;
    }
    if(!inside)continue;
    const env=line.match(/^env_key\s*=\s*["']([A-Za-z_][A-Za-z0-9_]*)["']\s*(?:#.*)?$/);
    if(env)envKey=env[1];
    const wire=line.match(/^wire_api\s*=\s*["']([^"']+)["']\s*(?:#.*)?$/);
    if(wire)wireApi=wire[1];
  }
  if(!found)throw Error(`Codex provider '${provider}' is not configured in user config.toml`);
  if(wireApi&&wireApi!=='responses')throw Error(`Codex provider '${provider}' requires wire_api = "responses"`);
  if(envKey&&!ENV_KEY.test(envKey))throw Error('Invalid Codex provider env_key name');
  return {provider,envKey,wireApi:wireApi??'responses'};
}

/** Provider is always explicit for third-party models; this avoids silently
 * sending an unknown model name to the global default (Luna/Sol) endpoint.
 */
export function resolveCodexSelection({model='gpt-6-luna',provider=null,
  configPath=codexConfigPath()}={}){
  if(typeof model!=='string'||!MODEL.test(model))throw Error('Invalid Codex model ID');
  if(provider===null||provider===undefined||provider===''){
    if(NATIVE_CODEX_MODELS.includes(model))return {model,provider:null};
    const legacyProvider=LEGACY_MODEL_PROVIDERS.get(model);
    if(legacyProvider){codexProviderInfo(legacyProvider,{configPath});return {model,provider:legacyProvider}}
    throw Error('Custom Codex model requires a configured provider (e.g. provider="runanytime_grok")');
  }
  const info=codexProviderInfo(provider,{configPath});
  return {model,provider:info.provider};
}

/** Optional user-secret file supported for the already configured RunAnytime
 * env_key. The file is never written, copied to reports or logged.
 * Other providers use Codex's normal env_key environment-variable mechanism.
 */
export function codexProviderEnvironment(provider,{configPath=codexConfigPath(),
  env=process.env,home=homedir(),userId=process.getuid?.()}={}){
  if(!provider)return {...env};
  const info=codexProviderInfo(provider,{configPath});
  const output={...env};
  if(info.envKey&&!output[info.envKey]&&provider==='runanytime_grok'&&info.envKey==='RUNANYTIME_API_KEY'){
    const file=join(home,'.config','runanytime','grok.key');
    if(existsSync(file)){
      const stat=lstatSync(file);
      if(!stat.isFile()||(stat.mode&0o077)!==0||(userId!==undefined&&stat.uid!==userId))
        throw Error('RunAnytime key file must be owned by this user and mode 600 or stricter');
      const key=readFileSync(file,'utf8').trim();
      if(key)output[info.envKey]=key;
    }
  }
  if(info.envKey&&!output[info.envKey])
    throw Error(`Codex provider '${provider}' requires ${info.envKey}; configure its environment or private key file before execution`);
  return output;
}

export function codexAppServerArgs({provider=null}={}){
  return provider?['-c',`model_provider=${JSON.stringify(provider)}`,'app-server','--stdio']:
    ['app-server','--stdio'];
}
