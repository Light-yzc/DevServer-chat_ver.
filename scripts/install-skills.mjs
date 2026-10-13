#!/usr/bin/env node
/** Install Tips' own allowlisted Codex Skills without touching system ones.
 * The target contains symlinks to one canonical source tree. */
import {existsSync,lstatSync,mkdirSync,readlinkSync,symlinkSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const source=resolve(process.env.TIPS_SKILLS_SOURCE??join(root,'tips','skills'));
const destination=resolve(process.env.CODEX_HOME??join(process.env.HOME??'', '.codex'),'skills');
const names=['agent-coordination','main-batch-triage','research-safety','tips-troubleshooting','project-overview'];
mkdirSync(destination,{recursive:true,mode:0o700});
for(const name of names){
  const path=join(source,name),target=join(destination,name);
  if(!existsSync(join(path,'SKILL.md')))throw Error('Missing canonical Tips Skill '+name);
  try{
    const info=lstatSync(target);
    if(!info.isSymbolicLink()||readlinkSync(target)!==path)
      throw Error('Refusing to overwrite an existing nonmatching skill: '+target);
    console.log('EXISTS',name);
  }catch(err){
    if(err.code!=='ENOENT')throw err;
    symlinkSync(path,target,'dir');
    console.log('INSTALLED',name);
  }
}
console.log('Tips Skills ready for Codex. Real docs:',source);
