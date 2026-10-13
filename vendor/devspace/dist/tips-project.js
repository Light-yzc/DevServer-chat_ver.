/** One coherent project overview over EXISTING Tips task records.
 * No duplicate backlog database: project membership is inferred from legacy
 * AIR groups, or set explicitly for newly created tasks. */
import {timingSafeEqual,randomUUID} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,renameSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';

const ID=/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/;
const OPEN=new Set(['pending','running','blocked','failed','paused']);
const PRIORITY={critical:0,high:1,normal:2,low:3};
const PROJECTS=[
  {id:'air',title:'AIR · 科研总项目',description:'实验、论文、因果设计、基线比较、数据验证与科研 Agent 调度'},
  {id:'infrastructure',title:'研究基础设施',description:'Tips、DevSpace、Web Wake、Agent 运行与可靠性'},
  {id:'other',title:'其他任务',description:'暂未归入上述项目的任务'},
];
function safeEqual(a,b){
  if(typeof a!=='string'||typeof b!=='string'||!a.length||!b.length)return false;
  const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);
}
function projectOf(task){
  if(task.projectId)return task.projectId;
  if(/^(AIR|Subagents|Agent handoffs)/i.test(task.group??'')||/^(air-|sub-air-|web-handoff-)/i.test(task.id))return 'air';
  if(/^(Tips|Infrastructure|AIR-Infrastructure)/i.test(task.group??'')||/^tips-/.test(task.id))return 'infrastructure';
  return 'other';
}
function rank(task){return (OPEN.has(task.status)?0:1)*100 +
  (PRIORITY[task.priority]??2)*10+
  ({blocked:0,failed:1,running:2,pending:3,paused:4,completed:5,cancelled:6}[task.status]??9);}
function order(a,b){return rank(a)-rank(b)||Date.parse(b.updatedAt??0)-Date.parse(a.updatedAt??0)}
function projectSummary(project,tasks,limit){
  const assigned=tasks.filter(t=>projectOf(t)===project.id&&!t.archived),active=assigned.filter(t=>OPEN.has(t.status));
  const counts=Object.fromEntries(['pending','running','blocked','failed','paused','completed','cancelled']
    .map(key=>[key,assigned.filter(t=>t.status===key).length]));
  const workstreams=[...new Set(assigned.map(t=>t.group??'其他'))].sort();
  return {...project,total:assigned.length,counts,open:active.length,
    missingOwner:active.filter(t=>!t.owner).length,missingNextAction:active.filter(t=>!t.nextAction).length,
    workstreams,tasks:[...assigned].sort(order).slice(0,limit).map(t=>({
      id:t.id,title:t.title,status:t.status,group:t.group,owner:t.owner??null,
      priority:t.priority??'normal',nextAction:t.nextAction??null,acceptanceCriteria:t.acceptanceCriteria??null,
      message:t.message??'',gate:t.gate??null,health:t.health,updatedAt:t.updatedAt,
    }))};
}
export function createTipsProjectBoard(tips){
  const auditFile=join(tips.dir,'project-audit.json');
  function audit(action,id,actor,reason){
    const history=existsSync(auditFile)?JSON.parse(readFileSync(auditFile,'utf8')):[];
    const updated=[{id,action,actor,reason,at:new Date().toISOString()},...history].slice(0,500);
    const temp=`${auditFile}.${randomUUID()}.tmp`;
    try{writeFileSync(temp,JSON.stringify(updated,null,2)+'\n',{mode:0o600});renameSync(temp,auditFile)}
    finally{rmSync(temp,{force:true})}
  }
  function run(input={},context={}){
    const action=input.action??'overview';
    const manager=context.manager===true||safeEqual(input.viewToken,tips.credentials.viewToken);
    if(action==='overview'||action==='list'){
      const tasks=tips.snapshot().tasks;
      const limit=Math.min(60,Math.max(1,Number(input.limit??(action==='list'?40:10))||10));
      return {projects:PROJECTS.map(p=>projectSummary(p,tasks,limit)),
        note:'One source of truth: live Tips task records; archived/terminal tasks stay in history, not the actionable queue.'};
    }
    const id=input.id;
    if(typeof id!=='string'||!ID.test(id))throw Error('Valid task ID required');
    if(action==='get')return tips.mutate({action:'get',id});
    if(action==='history')return tips.mutate({action:'history',id,limit:input.limit??80});
    if(!['create','edit','archive','delete'].includes(action))throw Error('Unsupported project board action');
    if(action!=='create'&&!manager)throw Error('Project curation requires recognized Web Main or private Tips view token');
    const before=tips.mutate({action:'get',id});
    if(action==='create'){
      if(before)throw Error('Task already exists: use a new stable ID or ask Main to edit');
      if(!PROJECTS.some(p=>p.id===input.projectId))throw Error('Choose projectId air, infrastructure or other');
      if(typeof input.title!=='string'||!input.title.trim())throw Error('Task title is required');
      if(typeof input.message!=='string'||!input.message.trim())throw Error('Task description is required');
      const group=input.group??(input.projectId==='air'?'AIR-Research':input.projectId==='infrastructure'?'Infrastructure':'Other');
      const result=tips.mutate({action:'update',id,projectId:input.projectId,
        title:input.title,group,kind:'text',status:'pending',message:input.message,
        owner:context.manager===true&&input.owner?input.owner:context.actor??'unassigned',priority:input.priority??'normal',
        nextAction:input.nextAction??'',acceptanceCriteria:input.acceptanceCriteria??'',gate:input.gate??''},
        {trustedUpdate:true});
      audit('create',id,context.actor??'agent','Task added to project overview');
      return {created:true,task:result};
    }
    if(!before)throw Error('Unknown task');
    if(input.expectedUpdatedAt&&before.updatedAt!==input.expectedUpdatedAt)
      throw Error('Task changed since last read; refresh before applying edits');
    if(action==='edit'){
      const allowed=['title','group','message','details','status','projectId','owner','nextAction','acceptanceCriteria','priority','gate'];
      const changes=Object.fromEntries(allowed.filter(k=>input[k]!==undefined).map(k=>[k,input[k]]));
      if(!Object.keys(changes).length)throw Error('No task fields supplied');
      if(changes.projectId&&!PROJECTS.some(p=>p.id===changes.projectId))throw Error('Unknown project');
      const result=tips.mutate({action:'update',id,...changes},{trustedUpdate:true,trustedManage:true});
      audit('edit',id,context.actor??'manager',input.reason??'Project planning update');
      return {updated:true,task:result};
    }
    if(before.status==='running')throw Error('Running tasks cannot be archived or deleted');
    if(action==='delete'&&!before.archived)throw Error('Archive first; deletion must not erase active project context');
    const result=tips.mutate({action,id},{trustedManage:true});
    audit(action,id,context.actor??'manager',input.reason??'Project curation');
    return {action,id,result};
  }
  return {run,projectOf};
}
