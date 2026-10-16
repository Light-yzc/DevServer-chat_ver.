import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtempSync,writeFileSync,mkdirSync,chmodSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {listConfiguredCodexProviders,queryCodexAppServerModels,listSubagentModelChoices} from './codex-model-list.mjs';

function fixture(){
  const home=mkdtempSync(join(tmpdir(),'codex-model-list-test-'));
  const configPath=join(home,'config.toml');
  writeFileSync(configPath,`model = "gpt-6.1-sol"
model_provider = "ly_3090_proxy"
secret = "do_not_return_this_value"

[model_providers.runanytime_grok]
name = "RunAnytime Grok"
base_url = "https://runanytime.hxi.me/v1"
env_key = "RUNANYTIME_API_KEY"
wire_api = "responses"

[model_providers.ly_3090_proxy]
name = "Local"
wire_api = "responses"
`);
  return {home,configPath,cleanup:()=>rmSync(home,{recursive:true,force:true})};
}

test('model inventory reads Codex provider IDs and only safe credential readiness metadata',()=>{
  const x=fixture();try{
    const a=listConfiguredCodexProviders({configPath:x.configPath,home:x.home,env:{}});
    assert.equal(a.defaultProvider,'ly_3090_proxy');
    assert.equal(a.providers.length,2);
    const grok=a.providers.find(x=>x.provider==='runanytime_grok');
    assert.equal(grok.credentialStatus,'missing');
    assert.deepEqual(grok.knownModelHints,['grok-4.7']);
    const secretDir=join(x.home,'.config','runanytime');mkdirSync(secretDir,{recursive:true});
    const secretPath=join(secretDir,'grok.key');writeFileSync(secretPath,'private_fixture_value',{mode:0o600});
    const ready=listConfiguredCodexProviders({configPath:x.configPath,home:x.home,env:{}});
    assert.equal(ready.providers.find(x=>x.provider==='runanytime_grok').credentialStatus,'present_unverified');
    assert.doesNotMatch(JSON.stringify(ready),/private_fixture_value|do_not_return_this_value/);
    chmodSync(secretPath,0o644);
    const insecure=listConfiguredCodexProviders({configPath:x.configPath,home:x.home,env:{}});
    assert.equal(insecure.providers.find(x=>x.provider==='runanytime_grok').credentialStatus,'insecure_file_permissions');
  }finally{x.cleanup()}
});

test('model/list uses Codex App Server JSON-RPC without executing a Turn',async()=>{
  const requests=[];
  const fakeSpawn=(bin,args,options)=>{
    assert.deepEqual(args,['app-server','--stdio']);
    const child=new EventEmitter();
    child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.stderr.resume=()=>{};
    child.stdin={write(line){const r=JSON.parse(line);requests.push(r);
      if(r.id===1)queueMicrotask(()=>child.stdout.emit('data',Buffer.from(JSON.stringify({id:1,result:{userAgent:'codex'}})+'\n')));
      if(r.id===2)queueMicrotask(()=>child.stdout.emit('data',Buffer.from(JSON.stringify({id:2,result:{data:[
        {id:'gpt-6-luna',model:'gpt-6-luna',displayName:'Luna',hidden:false,
          supportedReasoningEfforts:[{reasoningEffort:'medium'}]},
        {id:'gpt-6.1-sol',model:'gpt-6.1-sol',hidden:false,isDefault:true},
      ],nextCursor:null}})+'\n')));
    }};
    child.kill=()=>{child.emit('close',0)};
    return child;
  };
  const out=await queryCodexAppServerModels({binary:'fake-codex',spawnProcess:fakeSpawn,
    env:{HOME:'/tmp'},cwd:'/tmp',includeHidden:true,timeoutMs:2000});
  assert.equal(out.available,true);
  assert.deepEqual(out.models.map(x=>x.model),['gpt-6-luna','gpt-6.1-sol']);
  assert.deepEqual(out.models[0].supportedReasoningEfforts,['medium']);
  assert.equal(requests.some(x=>x.method==='turn/start'||x.method==='thread/start'),false);
  assert.equal(requests.find(x=>x.method==='model/list').params.includeHidden,true);
});

test('list action merges native model catalog and third-party config without claiming tested inference',async()=>{
  const x=fixture();try{
    const out=await listSubagentModelChoices({configPath:x.configPath,home:x.home,env:{},
      getCatalog:async()=>({available:true,models:[{model:'gpt-6-luna'}],nextCursor:null})});
    assert.deepEqual(out.managedDefaults.map(x=>x.model),['gpt-6-luna','gpt-6.1-sol']);
    assert.equal(out.configuredProviders.find(x=>x.provider==='runanytime_grok').credentialStatus,'missing');
    assert.match(out.notes.join(' '),/NOT certify access/);
    assert.equal(out.codexCatalog.available,true);
  }finally{x.cleanup()}
});

test('Codex catalog failure cannot hide configured providers or leak provider stderr',async()=>{
  const x=fixture();try{
    const out=await listSubagentModelChoices({configPath:x.configPath,home:x.home,env:{},
      getCatalog:async()=>{throw Error('private_secret_in_provider_error')}});
    assert.equal(out.codexCatalog.available,false);
    assert.equal(out.configuredProviders.length,2);
    assert.doesNotMatch(JSON.stringify(out),/private_secret_in_provider_error/);
  }finally{x.cleanup()}
});
