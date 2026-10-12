import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {z} from 'zod/v4';
import {TIP_TOOL_DESCRIPTIONS} from '../vendor/devspace/dist/tips-tool-descriptions.js';
import {registerTipsTool} from '../vendor/devspace/dist/tips.js';
import {registerWebIdentityTools} from '../vendor/devspace/dist/web-identity-tool.js';
import {registerSubagentTool} from '../vendor/devspace/dist/subagent-tool.js';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');

function register(){
  const dir=mkdtempSync(join(tmpdir(),'tips-docs-contract-'));
  const tools={};const server={registerTool:(name,definition)=>{tools[name]=definition}};
  const config={stateDir:dir,allowedRoots:[dir]};
  registerTipsTool(server,config,z);
  registerWebIdentityTools(server,config,z);
  registerSubagentTool(server,config,z);
  return {tools,cleanup:()=>rmSync(dir,{recursive:true,force:true})};
}

test('all 8 advertised coordination tools have directly usable action-level descriptions',()=>{
  const x=register();try{
    const expected={
      tips_skills:['list','read','main-batch-triage','agent-coordination','research-safety'],
      tips_admin:['remove_web','revoke_web','remove_sub','stop_sub','delete_task','delete_message','viewToken'],
      tips:['list','update','heartbeat','history','blocked'],
      tips_messages:['post','reply','ACK','resolve','wake','controller'],
      tips_exchange:['submit','get','list','accepted','needs_changes'],
      subagent:['start','status','message','stop','gpt-6-luna','turn/steer'],
      web_identity:['prepare','claim','whoami','renew','release','claimKey'],
      web_mail:['send','inbox','sent','get','ack','reply','resolve','verify'],
    };
    assert.equal(Object.keys(TIP_TOOL_DESCRIPTIONS).length,8);
    for(const [tool,terms] of Object.entries(expected)){
      const definition=x.tools[tool];
      assert.ok(definition,`${tool} registered`);
      assert.equal(definition.description,TIP_TOOL_DESCRIPTIONS[tool]);
      assert.ok(definition.description.length>=500,`${tool} explanation not too terse`);
      assert.ok(definition.description.length<1900,`${tool} should not bloat context`);
      for(const term of terms)assert.ok(definition.description.includes(term),`${tool} missing ${term}`);
      assert.ok(definition.inputSchema.action.description?.length>=35,`${tool}: action field described`);
    }
  }finally{x.cleanup()}
});

test('message sender identities, expiry and completion semantics are unambiguous',()=>{
  const x=register();try{
    assert.match(x.tools.web_identity.description,/NO manual approval/);
    assert.match(x.tools.web_identity.description,/Lease expiration is NOT deletion/);
    assert.match(x.tools.web_mail.description,/no from parameter/);
    assert.match(x.tools.web_mail.description,/no automatic wake/);
    assert.match(x.tools.tips_messages.description,/Trusted post\/reply/);
    assert.match(x.tools.subagent.description,/NOT completion/);
    assert.match(x.tools.subagent.description,/ONCE/);
    assert.match(x.tools.tips_exchange.description,/QUEUED/);
    assert.ok(x.tools.web_mail.inputSchema.claimKey.description.includes('PRIVATE'));
    assert.ok(x.tools.tips_messages.inputSchema.wake.description.includes('server-controller'));
  }finally{x.cleanup()}
});

test('tool action guidance corresponds to actual Zod enum actions',()=>{
  const x=register();try{
    for(const [tool,actions] of Object.entries({
      tips_skills:['list','read'],
      tips_admin:['history','revoke_web','remove_web','stop_sub','remove_sub','archive_task','delete_task','delete_message'],
      tips:['list','get','update','heartbeat','history','archive','delete'],
      tips_messages:['list','get','post','reply','ack','resolve','delete'],
      tips_exchange:['submit','get','list'],subagent:['start','list','status','message','stop'],
      web_identity:['prepare','claim','whoami','list','renew','release'],
      web_mail:['send','inbox','sent','get','ack','reply','resolve','verify'],
    })){
      for(const action of actions){
        assert.equal(x.tools[tool].inputSchema.action.safeParse(action).success,true,`${tool} action ${action}`);
      }
    }
    const docs=readFileSync(join(root,'tips/AGENT_TOOL_USE.md'),'utf8');
    for(const tool of Object.keys(TIP_TOOL_DESCRIPTIONS))assert.ok(docs.includes('`'+tool+'`'),tool+' in docs');
    assert.ok(!docs.includes('HL7tq7IOrndbNrmhY8xjVuip9znSgrYx'),'Do not embed real invitations in docs');
  }finally{x.cleanup()}
});
