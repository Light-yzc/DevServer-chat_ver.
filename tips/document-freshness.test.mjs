import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {inspectDocumentation,compareDocumentation,documentationTurnReminder} from './document-freshness.mjs';

function workspace(){
  const root=mkdtempSync(join(tmpdir(),'docs-freshness-'));
  execFileSync('git',['-C',root,'init','-q']);
  execFileSync('git',['-C',root,'config','user.email','qa@example.invalid']);
  execFileSync('git',['-C',root,'config','user.name','Docs QA']);
  writeFileSync(join(root,'README.md'),'# Current documentation\n');
  writeFileSync(join(root,'code.py'),'print(1)\n');
  execFileSync('git',['-C',root,'add','.']);
  execFileSync('git',['-C',root,'commit','-qm','Initial docs and implementation']);
  return {root,cleanup:()=>rmSync(root,{recursive:true,force:true})};
}
test('each Turn reads current on-disk document modification state and Git HEAD instead of old Thread recollection',()=>{
  const x=workspace();try{
    const before=inspectDocumentation(x.root);
    assert.equal(before.available,true);
    assert.ok(before.docs.some(d=>d.path==='README.md'));
    assert.match(documentationTurnReminder(before),/HEAD=/);
    writeFileSync(join(x.root,'README.md'),'# Updated documentation from this task\n');
    const after=inspectDocumentation(x.root);
    assert.notEqual(before.docs.find(d=>d.path==='README.md').sizeBytes,
      after.docs.find(d=>d.path==='README.md').sizeBytes);
    const outcome=compareDocumentation(before,after,{workspaceChanged:true});
    assert.equal(outcome.status,'docs_changed_requires_review');
    assert.deepEqual(outcome.changedDocs,['README.md']);
  }finally{x.cleanup()}
});
test('code changes without document updates require explicit review; timestamps are not acceptance',()=>{
  const x=workspace();try{
    const before=inspectDocumentation(x.root);
    writeFileSync(join(x.root,'code.py'),'print(2)\n');
    const after=inspectDocumentation(x.root);
    const verdict=compareDocumentation(before,after,{workspaceChanged:true});
    assert.equal(verdict.status,'needs_documentation_review');
    assert.match(verdict.note,/Main must inspect/);
    assert.equal(compareDocumentation(before,after,{workspaceChanged:false}).status,'no_workspace_change');
    assert.equal(compareDocumentation({available:false},after).status,'unknown');
  }finally{x.cleanup()}
});
test('unavailable non-Git workspace is treated as unknown, not fresh',()=>{
  const dir=mkdtempSync(join(tmpdir(),'docs-nongit-'));try{
    const d=inspectDocumentation(dir);
    assert.equal(d.available,false);
    assert.equal(compareDocumentation(d,d).status,'unknown');
    assert.match(documentationTurnReminder(d),/verify current working tree/);
  }finally{rmSync(dir,{recursive:true,force:true})}
});
