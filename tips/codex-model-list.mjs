/** Read-only Codex model discovery for DevSpace's subagent(models) action.
 * Codex App Server model/list describes the CURRENT default provider's catalog;
 * third-party [model_providers.*] in config.toml are a separate inventory.
 * A catalog entry, a provider declaration and actual inference entitlement are
 * three different states. No model Turn or test request is made here.
 */
import {spawn} from 'node:child_process';
import {existsSync,readFileSync,lstatSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {NATIVE_CODEX_MODELS,codexConfigPath} from './codex-provider-models.mjs';
import {resolveCodexBin} from './codex-bin.mjs';

const PROVIDER=/^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const SAFE_ENV=/^[A-Z_][A-Z0-9_]{0,99}$/;

export function listConfiguredCodexProviders({configPath=codexConfigPath(),
  env=process.env,home=homedir(),uid=process.getuid?.()}={}){
  if(!existsSync(configPath))return {defaultProvider:null,providers:[],configured:false};
  const lines=readFileSync(configPath,'utf8').split(/\r?\n/);
  let section='',defaultProvider=null;
  const providers=new Map();
  for(const raw of lines){
    const line=raw.trim();
    const header=line.match(/^\[([^\]]+)\](?:\s*#.*)?$/);
    if(header){section=header[1];const id=section.startsWith('model_providers.')?section.slice('model_providers.'.length):null;
      if(id&&PROVIDER.test(id)&&!providers.has(id))providers.set(id,{provider:id,wireApi:null,envKey:null});
      continue;
    }
    if(!line||line.startsWith('#'))continue;
    const field=line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*["']([^"']*)["']\s*(?:#.*)?$/);
    if(!field)continue;
    const [,key,value]=field;
    if(section===''&&key==='model_provider'&&PROVIDER.test(value))defaultProvider=value;
    if(!section.startsWith('model_providers.'))continue;
    const entry=providers.get(section.slice('model_providers.'.length));
    if(!entry)continue;
    if(key==='wire_api')entry.wireApi=value;
    if(key==='env_key'&&SAFE_ENV.test(value))entry.envKey=value;
  }
  const entries=[...providers.values()].map(entry=>{
    let credentialStatus='managed_by_codex';
    if(entry.envKey){
      credentialStatus=env[entry.envKey]?'present_unverified':'missing';
      if(credentialStatus==='missing'&&entry.provider==='runanytime_grok'&&entry.envKey==='RUNANYTIME_API_KEY'){
        const path=join(home,'.config','runanytime','grok.key');
        if(existsSync(path)){
          const st=lstatSync(path);
          credentialStatus=st.isFile()&&(st.mode&0o077)===0&&(uid===undefined||st.uid===uid)?
            'present_unverified':'insecure_file_permissions';
        }
      }
    }
    return {...entry,default:entry.provider===defaultProvider,credentialStatus,
      knownModelHints:entry.provider==='runanytime_grok'?['grok-4.7']:[],
      note:'Configured Codex provider; model hints and credentials do not prove API compatibility or inference access.'};
  });
  return {defaultProvider,providers:entries,configured:true};
}

export function queryCodexAppServerModels({binary=resolveCodexBin(),
  spawnProcess=spawn,env=process.env,cwd=process.cwd(),includeHidden=false,timeoutMs=6500}={}){
  return new Promise(resolve=>{
    let child,buffer='',done=false;
    const finish=value=>{
      if(done)return;done=true;clearTimeout(timer);
      try{child?.kill('SIGTERM')}catch{}
      resolve(value);
    };
    const timer=setTimeout(()=>finish({available:false,reason:'timeout'}),timeoutMs);
    try{
      child=spawnProcess(binary,['app-server','--stdio'],{cwd,env,stdio:['pipe','pipe','pipe']});
      child.once('error',()=>finish({available:false,reason:'codex_process_error'}));
      child.once('close',()=>finish({available:false,reason:'codex_process_exited'}));
      // Never echo Codex stderr: provider error lines may contain URLs/tokens.
      child.stderr?.resume();
      child.stdout.on('data',chunk=>{
        buffer+=chunk.toString('utf8');
        if(buffer.length>1_000_000)return finish({available:false,reason:'catalog_too_large'});
        let n;
        while((n=buffer.indexOf('\n'))!==-1){
          const line=buffer.slice(0,n);buffer=buffer.slice(n+1);
          let msg;try{msg=JSON.parse(line)}catch{continue}
          if(msg.id===1){
            if(msg.error)return finish({available:false,reason:'initialization_failed'});
            child.stdin.write(JSON.stringify({method:'initialized',params:{}})+'\n');
            child.stdin.write(JSON.stringify({id:2,method:'model/list',params:{limit:100,
              includeHidden:Boolean(includeHidden)}})+'\n');
          }
          if(msg.id===2){
            if(msg.error||!Array.isArray(msg.result?.data))
              return finish({available:false,reason:'model_list_unavailable'});
            const models=msg.result.data.slice(0,100).filter(x=>x&&typeof x.model==='string')
              .map(x=>({model:x.model,id:typeof x.id==='string'?x.id:x.model,
                displayName:typeof x.displayName==='string'?x.displayName:x.model,
                hidden:x.hidden===true,isDefault:x.isDefault===true,
                supportedReasoningEfforts:Array.isArray(x.supportedReasoningEfforts)?
                  x.supportedReasoningEfforts.map(v=>v.reasoningEffort).filter(v=>typeof v==='string'):[]}));
            return finish({available:true,models,nextCursor:msg.result.nextCursor??null});
          }
        }
      });
      child.stdin.write(JSON.stringify({id:1,method:'initialize',
        params:{clientInfo:{name:'devspace_models',title:'DevSpace models',version:'1.0'}}})+'\n');
    }catch{finish({available:false,reason:'codex_spawn_failed'})}
  });
}

export async function listSubagentModelChoices({configPath=codexConfigPath(),
  env=process.env,home=homedir(),includeHidden=false,
  getCatalog=queryCodexAppServerModels}={}){
  const providers=listConfiguredCodexProviders({configPath,env,home});
  let catalog;
  try{catalog=await getCatalog({env,includeHidden})}catch{catalog={available:false,reason:'model_list_unavailable'}}
  return {source:'Codex config.toml + App Server model/list',
    managedDefaults:NATIVE_CODEX_MODELS.map(model=>({model,provider:null,route:'existing_default'})),
    configuredProviders:providers.providers,
    defaultProvider:providers.defaultProvider,
    codexCatalog:catalog,
    notes:[
      'model/list is scoped to Codex\'s default provider; it cannot enumerate arbitrary third-party provider catalogs.',
      'To start a custom model supply model and provider from config.toml; grok-4.7 also accepts the legacy model-only shorthand.',
      'Configured models and catalog entries do NOT certify access, Responses API support or working Tool Calling; no inference was invoked.',
    ]};
}
