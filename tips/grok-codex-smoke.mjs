#!/usr/bin/env node
/** Optional isolated Codex App Server smoke test; never launches experiments.
 * The API key is loaded from the existing private file into the child env.
 * No credentials or raw tool outputs are logged.
 */
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {codexProviderEnvironment} from './codex-provider-models.mjs';
import {resolveCodexBin} from './codex-bin.mjs';

const mode=process.argv[2]??'text';
if(!['text','tool'].includes(mode))throw Error('Usage: grok-codex-smoke.mjs [text|tool]');
const port=Number(process.env.GROK_RELAY_TEST_PORT??18741);
if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid isolated relay port');
const cwd=mkdtempSync(join(tmpdir(),'codex-grok-integration-'));
const args=[
  '-c','model_provider="runanytime_grok"',
];
if(process.env.GROK_SMOKE_USE_USER_CONFIG!=='1'){
  args.push('-c',`model_providers.runanytime_grok.base_url="http://127.0.0.1:${port}/v1"`);
  args.push('-c','model_providers.runanytime_grok.supports_websockets=false');
}
args.push('app-server','--stdio');
const childEnv=codexProviderEnvironment('runanytime_grok');
const child=spawn(resolveCodexBin(),args,{cwd,
  env:childEnv,stdio:['pipe','pipe','pipe']});
let seq=0,stage='initializing',buffer='',turnStatus='',reply='',errorCode=null;
let toolSeen=false,toolNames=[],done=false,transientErrors=0;
let errorDetail='';
const safeError=x=>String(x??'').replaceAll(childEnv.RUNANYTIME_API_KEY??'\u0000','[REDACTED]')
  .replace(/sk-[a-z0-9_-]{8,}/gi,'[REDACTED]').slice(0,280);
const started=Date.now();
const cleanup=()=>{try{child.kill('SIGTERM')}catch{}rmSync(cwd,{recursive:true,force:true})};
function finish(reason){
  if(done)return;done=true;clearTimeout(timeout);
  const info={mode,reason,stage,turnStatus,errorCode,errorDetail,transientErrors,toolSeen,toolNames,reply:reply.slice(0,160),
    seconds:Math.round((Date.now()-started)/1000)};
  console.log(JSON.stringify(info));
  cleanup();
  process.exitCode=turnStatus==='completed'&&(mode==='text'?reply.includes('GROK_CODEX_OK'):toolSeen)?0:2;
}
const timeout=setTimeout(()=>finish('timeout_100_seconds'),100_000);
const send=(method,params)=>{child.stdin.write(JSON.stringify({id:++seq,method,params})+'\n')};
const probe=mode==='text'?
  'This is an isolated Codex protocol smoke test. Reply exactly GROK_CODEX_OK. No tools needed.':
  'This is an isolated read-only tool-use test. Use your local shell tool to run `pwd` exactly once, then report only TOOL_SMOKE_OK. Do not create or modify files.';

child.on('error',()=>finish('codex_process_error'));
child.on('close',()=>{if(!done)finish('codex_exited')});
child.stderr.on('data',()=>{}); // No stdout of stderr: may contain private details.
child.stdout.on('data',chunk=>{
  buffer+=chunk.toString('utf8');
  if(buffer.length>800_000)return finish('event_buffer_exceeded');
  let pos;
  while((pos=buffer.indexOf('\n'))>=0){
    const line=buffer.slice(0,pos);buffer=buffer.slice(pos+1);
    let msg;try{msg=JSON.parse(line)}catch{continue}
    if(msg.id===1){
      if(msg.error)return finish('initialize_error');
      stage='opening_thread';
      child.stdin.write(JSON.stringify({method:'initialized',params:{}})+'\n');
      send('thread/start',{cwd,model:'grok-4.7',sandbox:'read-only',approvalPolicy:'never'});
    }else if(msg.id===2){
      if(msg.error||!msg.result?.thread?.id)return finish('thread_error');
      stage='turn_start';
      send('turn/start',{threadId:msg.result.thread.id,input:[{type:'text',text:probe}]});
    }else if(msg.id===3){
      if(msg.error)return finish('turn_start_error');
      stage='model_running';
    }else if(msg.method==='item/completed'){
      const item=msg.params?.item??{};
      if(item.type==='agentMessage'&&typeof item.text==='string')reply=item.text;
      if(/commandExecution|functionCall|toolCall/i.test(item.type??'')){
        toolSeen=true;toolNames.push(String(item.type).slice(0,40));
      }
    }else if(msg.method==='turn/completed'){
      turnStatus=msg.params?.turn?.status??'unknown';
      finish('turn_completed');
    }else if(msg.method==='error'&&/Reconnecting\.\.\./.test(msg.params?.error?.message??msg.params?.message??'')){
      transientErrors++;
    }else if(msg.method==='turn/failed'||msg.method==='error'){
      errorCode=msg.params?.error?.code??'generic';
      errorDetail=safeError(msg.params?.error?.message??msg.params?.message??msg.params?.error??'no message');
      finish('turn_error');
    }
  }
});
send('initialize',{clientInfo:{name:'grok_codex_bridge_smoke',title:'Grok Bridge Smoke',version:'1.0'}});
