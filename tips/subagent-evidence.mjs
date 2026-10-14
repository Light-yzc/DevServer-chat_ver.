/** Model-free, bounded, private per-Turn workspace evidence.
 * A shared checkout's diff MUST NOT be attributed to a particular Agent.
 * This is an observational snapshot, never a patch applied to the repository.
 */
import {execFileSync} from 'node:child_process';
import {existsSync,readFileSync,writeFileSync,readdirSync,openSync,readSync,closeSync,lstatSync,constants} from 'node:fs';
import {join} from 'node:path';
import {inspectDocumentation,compareDocumentation} from './document-freshness.mjs';

const MAX_GIT_BYTES=2_000_000;
const MAX_READ_CHARS=16_000;
const SAFE_NAME=/^sub-[a-z0-9][a-z0-9_.-]{0,57}$/;
const SAFE_JOB=/^[0-9a-f-]{30,40}$/i;
function git(cwd,args){return execFileSync('git',['--no-pager','-C',cwd,...args],{
  encoding:'utf8',timeout:7000,maxBuffer:MAX_GIT_BYTES,
  env:{...process.env,GIT_OPTIONAL_LOCKS:'0',GIT_TERMINAL_PROMPT:'0'},
  stdio:['ignore','pipe','ignore'],
});}
const safeRead=p=>existsSync(p)?readFileSync(p,'utf8'):null;
const paths=(dir,name,jobId)=>{
  if(!SAFE_NAME.test(name)||!SAFE_JOB.test(jobId))throw Error('Invalid Subagent evidence identity');
  return {start:join(dir,`${name}-${jobId}.git-start.json`),
    startPatch:join(dir,`${name}-${jobId}.git-start.patch`),
    end:join(dir,`${name}-${jobId}.git-end.json`),
    handoff:join(dir,`${name}-${jobId}.handoff.json`),
    documentation:join(dir,`${name}-${jobId}.documentation.json`),
    patch:join(dir,`${name}-${jobId}.workspace.patch`),
    result:join(dir,`${name}-${jobId}.last.txt`),
    log:join(dir,`${name}-${jobId}.stdout.log`),
    events:join(dir,`${name}-${jobId}.events.jsonl`)};
};
const privateWrite=(file,content)=>writeFileSync(file,content,{mode:0o600,flag:'w'});
function snapshot(cwd){
  try{
    const repoRoot=git(cwd,['rev-parse','--show-toplevel']).trim();
    const head=git(cwd,['rev-parse','HEAD']).trim();
    const status=git(cwd,['status','--porcelain=v1','--untracked-files=normal']);
    const trackedPatch=git(cwd,['diff','--no-ext-diff','--no-textconv','--binary','HEAD','--']);
    return {available:true,repoRoot,head,status:status.slice(0,100_000),
      trackedPatch,documentation:inspectDocumentation(cwd),
      // Read-only inspection of git state, not exclusive ownership of changes.
      provenance:'shared_workspace_unattributed',at:new Date().toISOString()};
  }catch(e){return {available:false,reason:e.code==='ENOBUFS'?'git_output_too_large':'git_unavailable_or_not_repository',at:new Date().toISOString()}}
}
export function beginGitEvidence({dir,name,jobId,cwd}){
  const p=paths(dir,name,jobId);
  const start=snapshot(cwd);
  if(start.available){privateWrite(p.startPatch,start.trackedPatch);}
  const {trackedPatch,...metadata}=start;
  privateWrite(p.start,JSON.stringify(metadata,null,2)+'\n');
  return metadata;
}
export function finishGitEvidence({dir,name,jobId,cwd}){
  const p=paths(dir,name,jobId);
  const start=JSON.parse(safeRead(p.start)||'null');
  const end=snapshot(cwd);
  const {trackedPatch:workingPatch='',...endMetadata}=end;
  const originalPatch=safeRead(p.startPatch);
  const report={...endMetadata,baselineHead:start?.head??null,
    baselineDirty:!!start?.status,
    headChanged:Boolean(start?.head&&end.head&&start.head!==end.head),
    workingDiffChanged:originalPatch!==null&&end.available&&originalPatch!==workingPatch,
    note:'Workspace-level evidence only. Concurrent Main/Sub or external writes may be included; do not attribute this patch to the named agent. Untracked content is not included.'};
  report.documentationReview=compareDocumentation(start?.documentation,end.documentation,
    {workspaceChanged:report.headChanged||report.workingDiffChanged});
  let patch='';
  if(start?.available&&end.available&&start.repoRoot===end.repoRoot){
    try{
      if(report.headChanged)patch+=git(cwd,['diff','--no-ext-diff','--no-textconv','--binary',start.head,end.head,'--']);
      patch+=workingPatch;
    }catch(e){report.patchError=e.code==='ENOBUFS'?'patch_too_large':'patch_unavailable';patch='';}
  }
  report.patchChars=patch.length;
  report.patchAvailable=!!patch;
  if(patch)privateWrite(p.patch,patch);
  privateWrite(p.end,JSON.stringify(report,null,2)+'\n');
  return report;
}

// Never return unrestricted raw logs/patches to a model, even if private files
// happen to contain service tokens. Agent textual output is untrusted evidence.
export function redactEvidence(text){return String(text).split('\n').map(line=>
  /github_pat_[A-Za-z0-9]+|gh[pousr]_[A-Za-z0-9]+|sk-[A-Za-z0-9_-]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|(?:password|passwd|api[_-]?key|secret|bearer|access[_-]?token|viewToken)\s*[:=]\s*\S+/i.test(line)?'[REDACTED LINE]':line).join('\n');}
function boundedDiskRead(file,limitBytes,{tail=false}={}){
  const st=lstatSync(file);if(!st.isFile())throw Error('Not a regular evidence file');
  const bytes=Math.max(512,Math.min(limitBytes,MAX_READ_CHARS*4));
  const start=tail?Math.max(0,st.size-bytes):0;
  const buf=Buffer.alloc(Math.min(bytes,st.size-start));
  const fd=openSync(file,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{let read=0;while(read<buf.length){const n=readSync(fd,buf,read,buf.length-read,start+read);if(!n)break;read+=n}
    return {text:buf.subarray(0,read).toString('utf8'),size:st.size,partial:st.size>read};
  }finally{closeSync(fd)}
}
export function readSubEvidence({dir,name,jobId,kind='result',limitChars=7000}){
  const p=paths(dir,name,jobId);
  if(!['result','diff','log','events','manifest','handoff','documentation'].includes(kind))throw Error('Unknown evidence type');
  const file=kind==='manifest'?p.end:kind==='diff'?p.patch:p[kind];
  const max=Math.max(200,Math.min(MAX_READ_CHARS,Number(limitChars)||7000));
  if(!existsSync(file))return {name,jobId,kind,available:false,reason:'not_recorded_for_this_turn'};
  // Diff is read from its start; logs are read from their end for diagnostics.
  const tail=['log','events'].includes(kind);
  const chunk=boundedDiskRead(file,max*4,{tail});
  const text=redactEvidence(chunk.text);
  const excerpt=text.length<=max?text:tail?text.slice(-max):text.slice(0,max);
  let meta=null;try{meta=existsSync(p.end)?JSON.parse(boundedDiskRead(p.end,100_000).text):null}catch{}
  return {name,jobId,kind,available:true,excerpt,truncated:chunk.partial||text.length>max,
    fileBytes:chunk.size,provenance:meta?.provenance??'unknown',
    note:kind==='diff'?'Shared workspace snapshot, not an Agent-attributed patch.':undefined};
}
export function listSubJobEvidence({dir,name,limit=20}){
  if(!SAFE_NAME.test(name))throw Error('Invalid Subagent identity');
  const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const re=new RegExp('^'+escaped+'-([0-9a-f-]{36})\\.handoff\\.json$','i');
  const count=Math.max(1,Math.min(100,Number(limit)||20));
  return readdirSync(dir).map(file=>({file,jobId:re.exec(file)?.[1]})).filter(x=>x.jobId)
    .map(x=>{try{const d=JSON.parse(boundedDiskRead(join(dir,x.file),100_000).text);
      return {jobId:x.jobId,at:d.finishedAt??null,status:d.status??'unknown',
        requestedBy:d.requestedBy??null,gitProvenance:d.git?.provenance??null};}
    catch{return {jobId:x.jobId,status:'unavailable'}}})
    .sort((a,b)=>(b.at??'').localeCompare(a.at??'')).slice(0,count);
}
export function extractSubReport(result=''){
  const match=String(result).match(/<sub-report>\s*([\s\S]{0,16000}?)\s*<\/sub-report>/i);
  if(!match)return null;
  let report;try{report=JSON.parse(match[1])}catch{return null}
  if(!report||typeof report!=='object'||Array.isArray(report))return null;
  const str=x=>redactEvidence(String(x??'').slice(0,700));
  const strings=(x,n=12)=>Array.isArray(x)?x.slice(0,n).map(str):[];
  const tests=Array.isArray(report.tests)?report.tests.slice(0,16).map(t=>({
    command:str(t?.command),outcome:['pass','fail','not_run'].includes(t?.outcome)?t.outcome:'unknown',
    evidence:str(t?.evidence)})):[];
  return {summary:str(report.summary),files:strings(report.files,30),
    tests,blockers:strings(report.blockers),evidencePaths:strings(report.evidencePaths,20),
    nextAction:str(report.nextAction),nextOwner:str(report.nextOwner),
    documentation:{updated:strings(report.documentation?.updated,20),
      notNeededReason:str(report.documentation?.notNeededReason)},
    provenance:'sub_self_reported_unverified'};
}
export function writeSubHandoff({dir,name,jobId,status,exitCode,startedAt,finishedAt,requestedBy,goal='',result='',gitEvidence=null,documentation=null}){
  const p=paths(dir,name,jobId),head=redactEvidence(result.slice(0,2500));
  const submitted=extractSubReport(result);
  const hasDocAction=Boolean(submitted?.documentation?.updated?.length||submitted?.documentation?.notNeededReason);
  const claimed= new Set(submitted?.documentation?.updated??[]);
  const actuallyUpdated=new Set(documentation?.changedDocs??[]);
  const falseDocClaims=[...claimed].filter(path=>!actuallyUpdated.has(path));
  const docStatus=documentation?.status==='needs_documentation_review'&&!hasDocAction?
    'requires_main_review':documentation?.status==='needs_documentation_review'&&hasDocAction?
    'decision_claim_requires_verification':documentation?.status??'unknown';
  const report={schemaVersion:1,name,jobId,status,exitCode,startedAt,finishedAt,
    requestedBy:requestedBy??null,scientificAcceptance:'not_verified',
    goal: redactEvidence(String(goal).slice(0,700)),
    summary:submitted?.summary||head,subReport:submitted,
    tests:submitted?.tests??[],testEvidenceLevel:'sub_self_reported_unverified',
    evidence:{result:p.result,log:p.log,events:p.events,patch:gitEvidence?.patchAvailable?p.patch:null,manifest:p.end,documentation:p.documentation},
    documentation:documentation?{status:docStatus,observation:documentation.status,possibleStaleDocs:documentation.possibleStaleDocs,
      changedDocs:documentation.changedDocs,note:documentation.note,
      evidencePath:p.documentation,agentDecision:submitted?.documentation??null,
      falseUpdateClaims:falseDocClaims,checkedAgainst:'per_turn_file_metadata_comparison'}:null,
    git:gitEvidence?{repoRoot:gitEvidence.repoRoot??null,head:gitEvidence.head??null,
      available:gitEvidence.available===true,
      baselineHead:gitEvidence.baselineHead??null,
      patchChars:gitEvidence.patchChars,provenance:gitEvidence.provenance,
      changed:gitEvidence.workingDiffChanged||gitEvidence.headChanged,
      baselineDirty:gitEvidence.baselineDirty,
      note:gitEvidence.note}:null,
    documentationReview:gitEvidence?.documentationReview??{status:'unknown'},
    nextAction:submitted?.nextAction||'Requires Main to verify task evidence and determine next Owner / acceptance.',
    safety:'No GPU/STOP/dispatch_hold approval is conferred by this record.'};
  privateWrite(p.handoff,JSON.stringify(report,null,2)+'\n');
  return report;
}
