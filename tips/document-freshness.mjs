/** Non-mutating documentation freshness checks for shared research workspaces.
 * Git commit history and current disk content are evidence; an Agent's old
 * Thread recollection or a stale copied README is NOT authoritative. */
import {execFileSync} from 'node:child_process';
import {existsSync,statSync} from 'node:fs';
import {join,relative} from 'node:path';

const DOCS=['AGENTS.md','README.md','docs/README.md','docs/DEPLOYMENT.md','docs/RESEARCH_STATE.md',
  'RESEARCH_STATE.md','CURRENT_STATUS.md','PLAN.md','EXPERIMENT_PLAN.md'];
function git(cwd,...args){return execFileSync('git',['-C',cwd,...args],{
  encoding:'utf8',timeout:6000,maxBuffer:180_000,stdio:['ignore','pipe','ignore'],
  env:{...process.env,GIT_OPTIONAL_LOCKS:'0',GIT_TERMINAL_PROMPT:'0'}}).trim()}
function checkedDocs(root,cwd){
  const rel=relative(root,cwd);
  const prefixes=rel&&!rel.startsWith('..')?rel.split('/').reduce((a,part)=>(a.push(join(a.at(-1)||'',part)),a),[]):[];
  return [...new Set([...DOCS,...prefixes.flatMap(p=>[join(p,'AGENTS.md'),join(p,'README.md')])])]
    .filter(p=>!p.startsWith('..')).slice(0,18);
}
export function inspectDocumentation(cwd){
  try{
    const root=git(cwd,'rev-parse','--show-toplevel');
    const head=git(cwd,'rev-parse','HEAD');
    const docs=checkedDocs(root,cwd).flatMap(path=>{
      const file=join(root,path);
      try{
        if(!existsSync(file))return [];
        const stat=statSync(file);
        if(!stat.isFile()||stat.size>2_000_000)return [];
        return [{path,sizeBytes:stat.size,modifiedMs:stat.mtimeMs,changedMs:stat.ctimeMs,
          lastCommittedAt:git(root,'log','-1','--format=%cI','--',path)||null}];
      }catch{return []}
    });
    const latestSourceCommit=git(root,'log','-1','--format=%cI','--','.',':!*.md',':!docs/**')||null;
    const allDocsOlder=!!latestSourceCommit&&docs.length>0&&docs.every(d=>!d.lastCommittedAt||Date.parse(d.lastCommittedAt)<Date.parse(latestSourceCommit));
    return {available:true,root,head,docs,latestSourceCommit,
      possibleStaleDocs:allDocsOlder,
      note:'Modification metadata and commit dates are review signals, NOT proof of document correctness. Never automatically fetch, reset or overwrite research documents.'};
  }catch{return {available:false,docs:[],possibleStaleDocs:null,note:'Not a Git checkout or unable to inspect docs; check source manually.'}}
}
export function compareDocumentation(before,after,{workspaceChanged=false}={}){
  if(!before?.available||!after?.available)return {status:'unknown',reason:'Documentation snapshot unavailable'};
  const a=new Map((before.docs??[]).map(d=>[d.path,d]));
  const changedDocs=(after.docs??[]).filter(d=>{
    const old=a.get(d.path);
    return !old||old.sizeBytes!==d.sizeBytes||old.modifiedMs!==d.modifiedMs||old.changedMs!==d.changedMs;
  }).map(d=>d.path);
  const removedDocs=(before.docs??[]).filter(d=>!(after.docs??[]).some(a=>a.path===d.path)).map(d=>d.path);
  changedDocs.push(...removedDocs);
  const changes=workspaceChanged||before.head!==after.head;
  return {status:changes?(changedDocs.length?'docs_changed_requires_review':'needs_documentation_review'):
    after.possibleStaleDocs?'baseline_docs_may_be_stale':'no_workspace_change',
    changedDocs,workspaceChanged:changes,possibleStaleDocs:after.possibleStaleDocs,
    provenance:'shared_workspace_unattributed',comparison:'file_modification_metadata_only',
    note:changes&&!changedDocs.length?'Workspace changed without any monitored document metadata change. Main must inspect current documentation or justify why it is irrelevant.':
      'File modification metadata cannot prove content correctness, or attribute changes to one Sub in a shared checkout.'};
}
export function documentationTurnReminder(report){
  if(!report?.available)return 'DOC FRESHNESS: Could not inspect current Git workspace; verify current working tree and docs before trusting older Thread context.';
  const files=report.docs.map(d=>`${d.path}:modified=${new Date(d.modifiedMs).toISOString()} updated-in-git=${d.lastCommittedAt??'untracked/unknown'}`).join('; ');
  return `DOC FRESHNESS (read-only runtime check): HEAD=${report.head}; observed docs: ${files||'none'}; `+
    `committed source is newer than all checked docs=${report.possibleStaleDocs}. `+
    'Re-open relevant on-disk instructions/documentation and compare against real current code/tests before decisions; old Thread quotes/summaries may be outdated. '+
    'If you change implementation or workflow, update relevant README/plans/status docs during THIS task, or explicitly document a justified docs-not-needed decision and ask Main to verify it. '+
    'Do not auto git pull/reset, overwrite frozen docs, or treat timestamps alone as scientific truth.';
}
