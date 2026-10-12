/** A read-only unified overview. Sources are authoritative registries and process observations. */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createWebIdentityStore } from './web-identity-store.js';

const summarize=(value,max=160)=>typeof value==='string'?value.replace(/<tips-actions>[\s\S]*$/i,'').replace(/\s+/g,' ').trim().slice(0,max):'';
const parseFile=(path,fallback)=>{try{return existsSync(path)?JSON.parse(readFileSync(path,'utf8')):fallback}catch{return fallback}};
const isPending=status=>['unread','delivered','processing'].includes(status);
function run(cmd,args){try{return execFileSync(cmd,args,{encoding:'utf8',timeout:1200,stdio:['ignore','pipe','ignore']}).trim()}catch{return null}}

export function buildAgentOverview(config,tips,options={}){
  const now=options.now??(()=>Date.now());
  const serviceStatus=options.serviceStatus??(unit=>run('systemctl',['--user','is-active',unit])??'unknown');
  const panes=options.panes??(()=>run('tmux',['list-panes','-a','-F','#{session_name}|#{pane_current_command}|#{pane_pid}'])??'');
  const tasks=tips.snapshot().tasks;
  const taskById=new Map(tasks.map(t=>[t.id,t]));
  const messages=tips.messages({action:'list',limit:300});
  const mailbox=id=>{
    const mine=messages.filter(m=>m.to===id||m.from===id);
    const last=mine[0];
    return {unread:mine.filter(m=>m.to===id&&isPending(m.status)).length,
      last:last?{at:last.at,from:last.from,to:last.to,subject:summarize(last.subject,96),status:last.status,tracked:!!last.tracked}:null};
  };
  const web=createWebIdentityStore(config).list().map(role=>({
    type:'web',id:role.id,name:role.label||role.id,
    tier:role.id==='web-main'||/^web-[a-z0-9_.-]+-main$/.test(role.id)?'web-main':'web-sub',
    status:role.status,source:'Web identity registry',
    updatedAt:role.lastSeenAt??role.claimedAt??role.createdAt,
    summary:role.status==='claimed'?'已认领；无法从服务器判断 Web Chat 当前是否打开':role.status==='available'?'等待邀请码认领':role.status==='released'?'已释放':'身份登记',
    leaseExpiresAt:role.leaseExpiresAt,scopeBound:role.scopeBound,
    mailbox:mailbox(role.id),
  }));
  const db=parseFile(join(tips.dir,'subagents','registry.json'),{agents:{}});
  const subs=Object.values(db.agents??{}).map(a=>{
    const card=taskById.get(a.name);
    const running=a.status==='running'||a.status==='stopping';
    const summary=running?summarize(card?.message)||'App Server 正在执行一轮任务':a.status==='queued'?'已加入任务队列':
      a.status==='failed'?summarize(a.error)||'最后一轮失败':summarize(a.lastResult)||'暂无近期结果';
    return {type:'sub',tier:'local-sub',id:a.name,name:a.name,status:a.status,source:'App Server registry',
      model:a.model??null,group:a.group??null,updatedAt:a.updatedAt??null,
      summary,jobId:a.jobId??null,revision:a.revision??null,
      mailbox:mailbox(a.name),
    };
  }).sort((a,b)=>(b.updatedAt??'').localeCompare(a.updatedAt??''));
  const mainService=serviceStatus('tips-server-controller.service');
  const mainTask=taskById.get('tips-server-controller');
  const main=[{type:'main',tier:'local-main',id:'server-controller',name:'Local Main · Codex Sol',
    status:mainService==='active'?(mainTask?.status==='running'?'running':'listening'):mainService==='inactive'?'offline':'unknown',
    serviceStatus:mainService,model:'gpt-6.1-sol',source:'systemd + Tips',
    summary:summarize(mainTask?.message)||'没有主控状态记录',
    updatedAt:mainTask?.updatedAt??null,mailbox:mailbox('server-controller')}];
  const known=new Set();
  const legacy=[];
  for(const line of panes().split('\n')){
    const [session,command,pid]=line.split('|');
    if(!session?.startsWith('air-')||known.has(session))continue;
    known.add(session);
    legacy.push({type:'legacy',id:session,name:session,
      status:'observed',source:'tmux (process snapshot)',
      summary:`检测到 tmux 会话，前台命令 ${summarize(command,35)||'未知'}；不代表 Codex 模型正在推理`,
      command:summarize(command,35)||'unknown',updatedAt:null,mailbox:mailbox(session)});
  }
  legacy.sort((a,b)=>a.id.localeCompare(b.id));
  const managerService=serviceStatus('tips-subagent-manager.service');
  const tracked=tasks.filter(t=>t.status==='running'&&!t.archived&&!t.id.startsWith('sub-')&&t.id!=='tips-server-controller')
    .map(t=>({id:t.id,name:t.title||t.id,status:t.status,summary:summarize(t.message),updatedAt:t.updatedAt,source:'Tips task (not an agent identity)'}));
  const webMain=web.filter(a=>a.tier==='web-main');
  const webSubs=web.filter(a=>a.tier==='web-sub');
  return {at:new Date(now()).toISOString(),services:{main:mainService,subagents:managerService},
    groups:{main,subs,web,webMain,webSubs,legacy,tracked},
    counts:{main:main.length,subagents:subs.length,web:web.length,legacy:legacy.length,
      webMain:webMain.length,webSubs:webSubs.length,
      runningSubs:subs.filter(a=>a.status==='running').length,
      claimedWeb:web.filter(a=>a.status==='claimed').length},
    note:'Web Main/Sub 按命名约定分类（web-main 或 web-*-main 为 Web Main，其余 Web 为 Sub），这只代表职责，不代表管理员权限。Local Main 为独立 Sol 服务，Local Sub 为持久 App Server。Web 已认领不等于在线，tmux 会话不等于推理中的 Agent，Tips 任务不等于独立 Agent 身份。'};
}
