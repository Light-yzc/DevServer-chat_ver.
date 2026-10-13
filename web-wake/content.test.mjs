import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const source=readFileSync(new URL('./extension/content.js',import.meta.url),'utf8');
const request={type:'DEVSPACE_WAKE',role:'web-test_1',ids:['11111111-1111-1111-1111-111111111111']};
function fixture({draft='',appearAt=3,clearOnClick=true,editAt=0,form=true,turnState='complete',stop=false,working=false,streaming=false,attachment=false,quiet=true,approval=true,onCheck}={}){
  let ticks=0,clicks=0,deletes=0,lookupsBeforeInsert=0,lastSubmittedText='',clock=1_000_000,observer,version='0.1.8';
  const listeners=new Set();
  const turn={contains:n=>n===turn,querySelector(selector){if(selector==='[data-markdown-animated]')return streaming?{}:null;return turnState==null?null:{getAttribute:()=>turnState};}};
  const editor={textContent:draft,isConnected:true,focus(){},querySelector(){return null;},closest(selector){return selector==='form'?(form?root:null):root;}};
  const button={disabled:false,getAttribute(){return null;},click(){clicks++;lastSubmittedText=editor.textContent;if(clearOnClick)editor.textContent='';}};
  const root={querySelector(){if(!editor.textContent)lookupsBeforeInsert++;return ticks>=appearAt?button:null;}};
  const document={documentElement:{setAttribute(){}},querySelectorAll:()=>[turn],querySelector(selector){
    if(selector.includes('contenteditable'))return editor;
    if(selector.includes('stop-button'))return stop?{}:null;
    if(selector.includes('Working'))return working?{}:null;
    if(selector.includes('composer-attachment'))return attachment?{}:null;
    return null;
  },execCommand(command,_unused,value){if(command==='insertText')editor.textContent=value;if(command==='delete'){editor.textContent='';deletes++;}return true;},createRange(){return {selectNodeContents(){}};}};
  const location={pathname:'/c/11111111-1111-1111-1111-111111111111'};
  const ctx={document,location,Date:class extends Date{static now(){return clock;}},
    MutationObserver:class{constructor(fn){observer=fn;}observe(){}disconnect(){}},
    window:{getSelection(){return {removeAllRanges(){},addRange(){}};}},
    setTimeout(callback){ticks++;clock+=100;if(ticks===editAt)editor.textContent='user changed draft';queueMicrotask(callback);},
    chrome:{runtime:{id:'test-extension',getManifest:()=>({version}),async sendMessage(m){assert.equal(m.type,'DEVSPACE_WAKE_CHECK');await onCheck?.(controls);return {ok:approval};},onMessage:{addListener:fn=>listeners.add(fn),removeListener:fn=>listeners.delete(fn)}}}};
  const controls={setTurn:s=>{turnState=s;},setStop:s=>{stop=s;},setWorking:s=>{working=s;},setAttachment:s=>{attachment=s;},location,
    mutate:()=>observer([{target:turn}]),advance:ms=>{clock+=ms;}};
  runInNewContext(source,ctx);
  if(quiet)clock+=21_000;
  function message(msg){return new Promise(resolve=>[...listeners].at(-1)(msg,{},resolve));}
  return {...controls,send:(msg=request)=>message(msg),probe:()=>message({type:'DEVSPACE_STATUS'}),editor,ctx,
    reinstall:()=>runInNewContext(source,ctx),upgrade:()=>{version='0.1.9';runInNewContext(source,ctx);},listenerCount:()=>listeners.size,
    stats:()=>({clicks,deletes,lookupsBeforeInsert}),submittedText:()=>lastSubmittedText};
}

test('waits for Send after insertion, rechecks pending, and confirms composer cleared',async()=>{
  const f=fixture();assert.equal((await f.send()).status,'sent');assert.deepEqual(f.stats(),{clicks:1,deletes:0,lookupsBeforeInsert:0});
});
test('wake prompt reads unread mail and advances authorized work with one final inbox check',async()=>{
  const f=fixture();await f.send();const prompt=f.submittedText();
  assert.match(prompt,/读取未读消息/);assert.match(prompt,/按已有授权处理后 ACK/);assert.match(prompt,/推进进度、启动 agent 或发送信息/);assert.match(prompt,/本轮结束前再查一次 inbox/);assert.ok(prompt.length<300);
});
test('supports composer container without form and protects existing drafts',async()=>{
  assert.equal((await fixture({form:false}).send()).status,'sent');
  const f=fixture({draft:'my draft'});assert.equal((await f.send()).status,'busy');assert.equal(f.editor.textContent,'my draft');assert.equal(f.stats().clicks,0);
});
test('missing Send removes only its own unsent draft so retry is possible',async()=>{
  const f=fixture({appearAt:Infinity});assert.equal((await f.send()).status,'not_ready');assert.equal(f.editor.textContent,'');assert.equal(f.stats().deletes,1);
});
test('user edits during wait are neither sent nor deleted',async()=>{
  const f=fixture({editAt:1});assert.equal((await f.send()).status,'not_ready');assert.equal(f.editor.textContent,'user changed draft');assert.equal(f.stats().clicks,0);assert.equal(f.stats().deletes,0);
});
test('click without submission preserves draft and does not click again',async()=>{
  const f=fixture({clearOnClick:false});assert.equal((await f.send()).status,'not_ready');assert.match(f.editor.textContent,/DevSpace\/Tips/);assert.equal((await f.send()).status,'busy');assert.equal(f.stats().clicks,1);
});
test('tool-call gaps and unknown turn state stay busy even without Stop',async()=>{
  for(const settings of [{turnState:'in_progress'},{turnState:null},{working:true},{stop:true},{streaming:true}]){
    const f=fixture(settings);assert.equal((await f.send()).status,'busy');assert.equal(f.stats().clicks,0);assert.equal(f.editor.textContent,'');
  }
});
test('requires a quiet window after startup, activity, and completion',async()=>{
  const f=fixture({quiet:false});assert.equal((await f.probe()).status,'busy');f.advance(21_000);assert.equal((await f.probe()).status,'idle');
  f.mutate();assert.equal((await f.send()).status,'busy');f.advance(21_000);assert.equal((await f.send()).status,'sent');
});
test('processing resumes during final check: cancel and remove only our unchanged draft',async()=>{
  for(const onCheck of [f=>f.setTurn('in_progress'),f=>f.setWorking(true),f=>f.mutate(),f=>f.setAttachment(true),f=>{f.location.pathname='/c/22222222-2222-2222-2222-222222222222';}]){
    const f=fixture({onCheck});assert.equal((await f.send()).status,'busy');assert.equal(f.stats().clicks,0);assert.equal(f.editor.textContent,'');
  }
});
test('ACK or disabled wake discovered at final check cancels before clicking',async()=>{
  const f=fixture({approval:false});assert.equal((await f.send()).status,'not_ready');assert.equal(f.stats().clicks,0);assert.equal(f.editor.textContent,'');
});
test('reinjecting is idempotent; upgrades replace the listener and restart quiet time',async()=>{
  const f=fixture();f.reinstall();assert.equal(f.listenerCount(),1);assert.equal((await f.probe()).status,'idle');f.upgrade();assert.equal(f.listenerCount(),1);assert.equal((await f.probe()).status,'busy');
});
test('a confirmed message cannot be submitted twice after a lost background response',async()=>{
  const f=fixture();assert.equal((await f.send()).status,'sent');f.advance(120_000);assert.equal((await f.send()).status,'sent');assert.equal(f.stats().clicks,1);
});

test('confirmed IDs are acknowledged locally without repeating a mixed old/new batch',async()=>{
  const f=fixture();await f.send();f.advance(120_000);
  const result=await f.send({...request,ids:[...request.ids,'22222222-2222-2222-2222-222222222222']});
  assert.equal(result.status,'sent');assert.deepEqual([...result.ids],request.ids);assert.equal(f.stats().clicks,1);
});
