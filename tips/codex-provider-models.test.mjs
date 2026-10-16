import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,mkdirSync,chmodSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {codexProviderInfo,resolveCodexSelection,codexProviderEnvironment,codexAppServerArgs} from './codex-provider-models.mjs';

function fixture(){
  const root=mkdtempSync(join(tmpdir(),'codex-provider-'));
  const configPath=join(root,'config.toml');
  writeFileSync(configPath,`model = "gpt-6.1-sol"
model_provider = "ly_3090_proxy"

[model_providers.runanytime_grok]
name = "Grok"
base_url = "https://runanytime.hxi.me/v1"
env_key = "RUNANYTIME_API_KEY"
wire_api = "responses"

[model_providers.ly_3090_proxy]
name = "Default provider"
base_url = "http://127.0.0.1:28317/v1"
wire_api = "responses"
`);
  return {root,configPath,cleanup:()=>rmSync(root,{recursive:true,force:true})};
}

test('native Luna / Sol do not change their default Codex app-server routing',()=>{
  const a=resolveCodexSelection({model:'gpt-6-luna'});
  const b=resolveCodexSelection({model:'gpt-6.1-sol'});
  assert.equal(a.provider,null);assert.equal(b.provider,null);
  assert.deepEqual(codexAppServerArgs(a),['app-server','--stdio']);
});

test('Codex-configured provider and custom model route to the same Codex app-server',()=>{
  const f=fixture();try{
    const info=codexProviderInfo('runanytime_grok',{configPath:f.configPath});
    assert.equal(info.envKey,'RUNANYTIME_API_KEY');
    assert.equal(info.wireApi,'responses');
    const route=resolveCodexSelection({model:'grok-4.7',provider:'runanytime_grok',configPath:f.configPath});
    assert.deepEqual(route,{model:'grok-4.7',provider:'runanytime_grok'});
    assert.deepEqual(codexAppServerArgs(route),['-c','model_provider="runanytime_grok"','app-server','--stdio']);
    assert.deepEqual(resolveCodexSelection({model:'grok-4.7',configPath:f.configPath}),route,'previous Grok shorthand remains supported');
    assert.throws(()=>resolveCodexSelection({model:'unconfigured-future-model',configPath:f.configPath}),/requires a configured provider/);
    assert.throws(()=>resolveCodexSelection({model:'grok-4.7',provider:'not_in_toml',configPath:f.configPath}),/not configured/);
    assert.throws(()=>resolveCodexSelection({model:'x',provider:'../oops',configPath:f.configPath}),/Invalid Codex provider/);
  }finally{f.cleanup()}
});

test('Codex provider key is injected only into child environment, not config or argv',()=>{
  const f=fixture();try{
    const env=codexProviderEnvironment('runanytime_grok',{configPath:f.configPath,
      env:{RUNANYTIME_API_KEY:'fixture_secret_value'},home:f.root});
    assert.equal(env.RUNANYTIME_API_KEY,'fixture_secret_value');
    assert.doesNotMatch(JSON.stringify(codexAppServerArgs({provider:'runanytime_grok'})),/fixture_secret_value/);
    assert.throws(()=>codexProviderEnvironment('runanytime_grok',{configPath:f.configPath,
      env:{},home:f.root}),/requires RUNANYTIME_API_KEY/);
    const directory=join(f.root,'.config','runanytime');mkdirSync(join(f.root,'.config'));
    mkdirSync(directory);
    const secretFile=join(directory,'grok.key');writeFileSync(secretFile,'fixture_only\n',{mode:0o600});
    assert.equal(codexProviderEnvironment('runanytime_grok',{configPath:f.configPath,env:{},home:f.root}).RUNANYTIME_API_KEY,'fixture_only');
    chmodSync(secretFile,0o644);
    assert.throws(()=>codexProviderEnvironment('runanytime_grok',{configPath:f.configPath,env:{},home:f.root}),/mode 600/);
  }finally{f.cleanup()}
});

test('unsupported Codex wire protocol cannot be launched accidentally',()=>{
  const f=fixture();try{
    writeFileSync(f.configPath,`[model_providers.chat_only]\nwire_api = "chat"\n`);
    assert.throws(()=>codexProviderInfo('chat_only',{configPath:f.configPath}),/responses/);
    assert.throws(()=>resolveCodexSelection({model:'grok-4.7',provider:'not/valid',configPath:f.configPath}),/Invalid Codex provider/);
  }finally{f.cleanup()}
});
