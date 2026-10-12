import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,mkdirSync,writeFileSync,existsSync,readlinkSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';
import {createTipsSkills,SKILL_CATALOG} from '../vendor/devspace/dist/tips-skills.js';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const folder=join(root,'tips','skills');
test('MCP lists and reads each allowlisted Skill without letting caller traverse paths',()=>{
  const reader=createTipsSkills({allowedRoots:[root]});
  const items=reader.run({action:'list'});
  assert.equal(items.skills.length,4);
  for(const name of Object.keys(SKILL_CATALOG)){
    const entry=reader.run({action:'read',name});
    assert.equal(entry.name,name);
    assert.match(entry.content,new RegExp(`name: ${name}`));
    assert.ok(entry.content.length>250);
    assert.ok(existsSync(join(folder,name,'SKILL.md')));
  }
  assert.throws(()=>reader.run({action:'read',name:'../private/security.json'}),/Unknown Skill/);
  assert.throws(()=>reader.run({action:'read',name:'agent-coordination/../research-safety'}),/Unknown Skill/);
  assert.throws(()=>reader.run({action:'delete'}),/Unsupported/);
});

test('Codex Skill installation is repeatable and never overwrites other skills',()=>{
  const state=mkdtempSync(join(tmpdir(),'tips-skills-install-'));
  try{
    const code=process.execPath,script=join(root,'scripts','install-skills.mjs');
    const env={...process.env,CODEX_HOME:join(state,'codex'),TIPS_SKILLS_SOURCE:folder};
    const once=spawnSync(code,[script],{env,encoding:'utf8'});
    assert.equal(once.status,0,once.stderr);
    assert.ok(once.stdout.includes('INSTALLED'));
    const twice=spawnSync(code,[script],{env,encoding:'utf8'});
    assert.equal(twice.status,0,twice.stderr);
    assert.ok(twice.stdout.includes('EXISTS'));
    const link=join(state,'codex','skills','main-batch-triage');
    assert.equal(readlinkSync(link),join(folder,'main-batch-triage'));
  }finally{rmSync(state,{recursive:true,force:true})}
});
