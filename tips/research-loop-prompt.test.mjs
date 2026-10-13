import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join,dirname,resolve} from 'node:path';
import {mainResearchLoopPrompt,subResearchLoopPrompt} from './research-loop-prompt.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const read=path=>readFileSync(join(root,path),'utf8');

test('Sol Main always receives a compact goal-driven research handoff contract',()=>{
  const prompt=mainResearchLoopPrompt();
  for(const term of ['RECONCILE','ACT, NOT JUST SUMMARIZE','FOLLOW THROUGH','BLOCKED','Owner','acceptance','Tips','STOP/GPU/dispatch_hold'])
    assert.ok(prompt.includes(term),`Main prompt missing ${term}`);
  assert.ok(prompt.length<3200,'Do not waste Sol tokens on duplicated policy');
  const runner=read('tips/server-controller.mjs');
  assert.match(runner,/mainResearchLoopPrompt\(\)/);
  assert.match(runner,/taskBoardDigest\(tips\.snapshot\(\)/);
});

test('Luna resumed Threads receive a short research loop each Turn, with verified progress and reply',()=>{
  const prompt=subResearchLoopPrompt('sub-air-life');
  for(const term of ['sub-air-life','evidence','restartable checkpoint','<tips-actions>','Owner','exit 2'])
    assert.ok(prompt.includes(term),`Sub prompt missing ${term}`);
  assert.ok(prompt.length<2300,'Do not repeatedly inject full protocol into persistent Luna Threads');
  const runner=read('tips/app-agent.mjs');
  assert.match(runner,/subResearchLoopPrompt\(params\.name\)/);
  assert.match(runner,/localMainReplyWakeRequested\(parent\)/);
  assert.match(runner,/\{trustedWake:true\}/);
});

test('Web Main and Web Sub both receive a next-action/verification contract via MCP instructions',()=>{
  const instructions=read('vendor/devspace/dist/server.js');
  for(const term of ['WEB MAIN','WEB SUB','reconcile live Tips','independently checks source','acceptance test','wake event','dispatch_hold'])
    assert.ok(instructions.includes(term),`Web prompt missing ${term}`);
  const docs=read('tips/RESEARCH_LOOP.md');
  for(const heading of ['Web Main','Web Sub','Local Sol Main','Local Luna Sub','下一'])
    assert.ok(docs.includes(heading),`Role protocol missing ${heading}`);
  assert.match(docs,/Web 会话不会在浏览器关闭后自动执行/);
  assert.match(docs,/STOP/);
});
