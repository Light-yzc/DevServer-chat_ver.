import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const source=readFileSync(new URL('./extension/content.js',import.meta.url),'utf8');
const request={type:'DEVSPACE_WAKE',role:'web-test_1',ids:['11111111-1111-1111-1111-111111111111']};
function fixture({draft='',appearAt=3,clearOnClick=true,editAt=0,form=true}={}){
  let listener,ticks=0,clicks=0,deletes=0,lookupsBeforeInsert=0,lastSubmittedText='';
  const editor={textContent:draft,isConnected:true,focus(){},querySelector(){return null;},
    closest(selector){return selector==='form'?(form?root:null):root;}};
  const button={disabled:false,getAttribute(){return null;},click(){clicks++;lastSubmittedText=editor.textContent;if(clearOnClick)editor.textContent='';}};
  const root={querySelector(){if(!editor.textContent)lookupsBeforeInsert++;return ticks>=appearAt?button:null;}};
  const document={querySelector(selector){return selector.includes('contenteditable')?editor:null;},
    execCommand(command,_unused,value){if(command==='insertText')editor.textContent=value;
      if(command==='delete'){editor.textContent='';deletes++;}return true;},
    createRange(){return {selectNodeContents(){}};}};
  runInNewContext(source,{document,location:{pathname:'/c/11111111-1111-1111-1111-111111111111'},
    window:{getSelection(){return {removeAllRanges(){},addRange(){}};}},
    setTimeout(callback){ticks++;if(ticks===editAt)editor.textContent='user changed draft';queueMicrotask(callback);},
    chrome:{runtime:{onMessage:{addListener(fn){listener=fn;}}}}});
  return {send:()=>new Promise(resolve=>listener(request,{},resolve)),editor,
    stats:()=>({clicks,deletes,lookupsBeforeInsert}),submittedText:()=>lastSubmittedText};
}

test('waits for Send to appear after insertion and confirms composer cleared',async()=>{
  const f=fixture();assert.equal((await f.send()).status,'sent');
  assert.deepEqual(f.stats(),{clicks:1,deletes:0,lookupsBeforeInsert:0});
});
test('wake template requires an end-of-turn inbox check before finishing',async()=>{
  const f=fixture();assert.equal((await f.send()).status,'sent');
  const prompt=f.submittedText();
  assert.equal(prompt,'DevSpace/Tips：web-test_1 有新消息（ID：11111111-1111-1111-1111-111111111111）。请调用 web_mail(action="inbox") 读取，按授权处理并 ACK，必要时回复或推进研究、启动 agent。任务完成后务必再查一次 inbox，处理完新信并 ACK 才结束；若受门禁阻塞，说明原因和下一 Owner，勿无限轮询。');
  assert.ok(prompt.length<300,'Keep the wake prompt token-efficient');
});
test('supports composer container without a form',async()=>{
  const f=fixture({form:false});assert.equal((await f.send()).status,'sent');
});
test('existing user drafts are untouched',async()=>{
  const f=fixture({draft:'my draft'});assert.equal((await f.send()).status,'busy');
  assert.equal(f.editor.textContent,'my draft');assert.equal(f.stats().clicks,0);
});
test('missing Send removes only its own unsent draft so retry is possible',async()=>{
  const f=fixture({appearAt:Infinity});assert.equal((await f.send()).status,'not_ready');
  assert.equal(f.editor.textContent,'');assert.equal(f.stats().deletes,1);
});
test('user edits during wait are neither sent nor deleted',async()=>{
  const f=fixture({editAt:1});assert.equal((await f.send()).status,'not_ready');
  assert.equal(f.editor.textContent,'user changed draft');assert.equal(f.stats().clicks,0);assert.equal(f.stats().deletes,0);
});
test('click without submission does not acknowledge pending messages or click again',async()=>{
  const f=fixture({clearOnClick:false});assert.equal((await f.send()).status,'not_ready');
  assert.match(f.editor.textContent,/DevSpace\/Tips/);assert.equal((await f.send()).status,'busy');
  assert.equal(f.stats().clicks,1);
});
