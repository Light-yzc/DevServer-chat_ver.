import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createTipsV2} from '../vendor/devspace/dist/tips-core.js';
import {applySubagentProgress} from './subagent-progress.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const html=readFileSync(join(root,'vendor/devspace/dist/tips-dashboard.html'),'utf8');

test('Local Sub can post meaningful progress using existing machine-readable response footer',()=>{
  const dir=mkdtempSync(join(tmpdir(),'tips-progress-'));
  try{
    const tips=createTipsV2({stateDir:dir});
    tips.messages({action:'post',from:'web-main',to:'sub-air-study',subject:'Review AIR study',body:'CPU-only; no GPU'});
    let card=tips.mutate({action:'get',id:'sub-air-study'});
    assert.equal(card.progressMeasured,false);
    assert.equal(card.progress,0);
    card=applySubagentProgress(tips,'sub-air-study',{
      status:'running',message:'已检查控制变量，正在复核统计检验',details:'原始日志和核对清单已保存'});
    assert.equal(card.message,'已检查控制变量，正在复核统计检验');
    assert.equal(card.progressMeasured,false);
    assert.equal(card.status,'running');
    card=applySubagentProgress(tips,'sub-air-study',{
      status:'running',message:'7/10 组对照已核对',current:7,total:10});
    assert.equal(card.progressMeasured,true);
    assert.equal(card.progress,70);
    assert.equal(card.current,7);
    card=applySubagentProgress(tips,'sub-air-study',{status:'blocked',message:'缺少第8组对照的原始日志'});
    assert.equal(card.status,'blocked');
    assert.match(card.message,/第8组/);
  }finally{rmSync(dir,{recursive:true,force:true})}
});

test('Invalid stage, fabricated ratio, or empty progress never changes the task',()=>{
  const dir=mkdtempSync(join(tmpdir(),'tips-progress-reject-'));
  try{
    const tips=createTipsV2({stateDir:dir});
    tips.mutate({action:'update',id:'sub-verify',status:'running',progressMeasured:false});
    const prior=tips.mutate({action:'get',id:'sub-verify'});
    for(const value of [
      {status:'failed',message:'Failed'},
      {status:'running',message:' '},
      {status:'running',message:'claimed 5/3',current:5,total:3},
      {status:'running',message:'claimed 2/0',current:2,total:0},
      {status:'running',message:'bad fractional',current:2.2,total:10},
    ])assert.throws(()=>applySubagentProgress(tips,'sub-verify',value));
    assert.equal(tips.mutate({action:'get',id:'sub-verify'}).updatedAt,prior.updatedAt);
  }finally{rmSync(dir,{recursive:true,force:true})}
});

test('Admin controls stay hidden until panel is explicitly opened and close again immediately',()=>{
  assert.match(html,/<details id="admin-panel" class="admin-panel" hidden>/);
  assert.match(html,/const adminMode=\(\)=>canManage&&\$\('admin-panel'\)\.open/);
  assert.match(html,/if\(!adminMode\(\)\|\|!actions\.length\)return/);
  assert.match(html,/addEventListener\('toggle',\(\)=>\{if\(canManage\)refreshAdminViews\(\)\}/);
  assert.match(html,/\|admin:'\+adminMode\(\)/);
  assert.match(html,/近期指令/);
  assert.match(html,/阶段进度 · 尚未量化/);
});
