import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,chmodSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {resolveCodexBin} from './codex-bin.mjs';

test('Local Main resolves Codex even when systemd PATH omits ~/.local/bin',()=>{
  const root=mkdtempSync(join(tmpdir(),'tips-codex-path-'));
  try{
    const bin=join(root,'.local','bin');mkdirSync(bin,{recursive:true});
    const executable=join(bin,'codex');writeFileSync(executable,'#!/bin/sh\nexit 0\n');chmodSync(executable,0o700);
    assert.equal(resolveCodexBin({HOME:root,PATH:'/usr/bin:/bin'}),executable);
    assert.equal(resolveCodexBin({HOME:'/not/there',PATH:bin}),executable);
    assert.equal(resolveCodexBin({TIPS_CODEX_BIN:executable,HOME:'/missing',PATH:''}),executable);
    assert.throws(()=>resolveCodexBin({TIPS_CODEX_BIN:'/missing/codex',PATH:bin}),/TIPS_CODEX_BIN/);
    assert.throws(()=>resolveCodexBin({HOME:'/missing',PATH:''}),/Codex executable unavailable/);
  }finally{rmSync(root,{recursive:true,force:true})}
});
