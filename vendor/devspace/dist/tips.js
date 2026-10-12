import { timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createTipsV2 } from './tips-core.js';
import { buildAgentOverview } from './tips-agent-overview.js';
import { createTipsAdmin } from './tips-admin.js';
import { TIP_TOOL_DESCRIPTIONS } from './tips-tool-descriptions.js';
import {createTipsSkills} from './tips-skills.js';

export { createTipsV2 as createTips } from './tips-core.js';
const AUTH = (received, expected) => {
  if(typeof received!=='string'||typeof expected!=='string')return false;
  const x=Buffer.from(received),y=Buffer.from(expected);
  return x.length===y.length && timingSafeEqual(x,y);
};
function mutation(tips,args,context={}){
  const old=args.action==='update'&&args.id?tips.mutate({action:'get',id:args.id}):null;
  const result=tips.mutate(args,context);
  if(args.action==='update'&&args.status&&args.status!==old?.status){
    tips.notify({category:'task',id:result.id,title:result.title,status:result.status,message:result.message});
  }
  return result;
}
const textResult=callback=>async args=>{
  try {return {content:[{type:'text',text:JSON.stringify(callback(args),null,2)}]};}
  catch(err){return {isError:true,content:[{type:'text',text:String(err.message??err)}]};}
};
export function registerTipsTool(server,config,z){
  const tips=createTipsV2(config);
  const admin=createTipsAdmin(config,tips);
  const skills=createTipsSkills(config);
  server.registerTool('tips_skills',{
    title:'Tips Agent Skills — discover and read optional research/coordination guidance',
    description:TIP_TOOL_DESCRIPTIONS.tips_skills,
    inputSchema:{
      action:z.enum(['list','read']).describe('list available Agent Skills; read one named SKILL.md by allowlisted name.'),
      name:z.enum(['agent-coordination','main-batch-triage','research-safety','tips-troubleshooting']).optional()
        .describe('Required for read. Read only when this topic applies; never include private keys in Skills.'),
    },annotations:{readOnlyHint:true},
  },textResult(args=>skills.run(args)));
  server.registerTool('tips_admin',{
    title:'Tips management — revoke, remove, archive, stop (view token required)',
    description:TIP_TOOL_DESCRIPTIONS.tips_admin,
    inputSchema:{
      action:z.enum(['history','revoke_web','remove_web','stop_sub','remove_sub','archive_task','delete_task','delete_message']).describe('history reads administrator audit; revoke/remove_web affects Web roles; stop/remove_sub affects managed Local Sub; task/message actions manage Tips records.'),
      id:z.string().optional().describe('Exact web-*, sub-*, task ID or message UUID to operate on; required except history.'),
      viewToken:z.string().describe('PRIVATE Tips dashboard view token, required on every MCP management call; the same token is used to unlock /tips.'),
      reason:z.string().max(400).optional().describe('Short administrator reason, written to audit (never a secret).'),
    },annotations:{readOnlyHint:false,destructiveHint:true},
  },textResult(args=>admin.run(args)));
  server.registerTool('tips',{
    title:'Tips research console — tasks',
    description:TIP_TOOL_DESCRIPTIONS.tips,
    inputSchema:{
      action:z.enum(['list','get','update','heartbeat','history','archive','delete']).optional().describe('Default list. get/update/heartbeat/history/archive/delete need a stable task id.'),
      id:z.string().optional().describe('Stable Tips task identifier reused across updates.'),limit:z.number().int().optional(),title:z.string().optional(),
      status:z.enum(['pending','running','completed','blocked','failed','cancelled','paused']).optional().describe('Real task state; blocked means technical blocker, paused/cancelled mean intentional halt.'),
      kind:z.enum(['progress','text','metric','checklist','log','table','link','chart']).optional(),
      progress:z.number().int().min(0).max(100).optional(),
      message:z.string().optional().describe('Concise current progress or blocker, displayed on Tips dashboard.'),details:z.string().optional(),group:z.string().optional(),
      parentId:z.string().optional(),dependsOn:z.array(z.string()).optional(),
      current:z.number().min(0).optional(),total:z.number().min(0).optional(),
      value:z.union([z.number(),z.string()]).optional(),unit:z.string().optional(),
      items:z.array(z.object({text:z.string(),done:z.boolean()})).optional(),
      append:z.string().optional(),columns:z.array(z.string()).optional(),
      rows:z.array(z.array(z.union([z.string(),z.number()]))).optional(),
      url:z.string().optional(),points:z.array(z.number()).optional(),
      xLabel:z.string().optional(),yLabel:z.string().optional(),
      heartbeatEnabled:z.boolean().optional().describe('Turn on stale-process monitoring for long-running tasks; then send action=heartbeat.'),heartbeatTimeoutSec:z.number().int().optional(),
      heartbeat:z.boolean().optional(),archived:z.boolean().optional(),
    },annotations:{readOnlyHint:false},
  },textResult(args=>mutation(tips,args,{trustedUpdate:true})));
  server.registerTool('tips_messages',{
    title:'Tips Agent mailbox (unclaimed server identities)',
    description:TIP_TOOL_DESCRIPTIONS.tips_messages,
    inputSchema:{
      action:z.enum(['list','get','post','reply','delivered','ack','resolve','delete']).optional().describe('list default; post/reply create messages; ack only after reading; resolve only after work is done.'),
      id:z.string().optional().describe('Message UUID for get/ack/resolve/delete.'),from:z.string().optional().describe('Origin Agent ID for post/reply; web-* identities MUST use web_mail instead.'),to:z.string().optional().describe('Recipient mailbox, e.g. sub-cpu, server-controller, or legacy controller.'),
      subject:z.string().optional(),body:z.string().optional(),taskId:z.string().optional(),
      priority:z.enum(['low','normal','high']).optional(),inReplyTo:z.string().optional().describe('Original message ID when using action=reply; preserves conversation thread.'),
      threadId:z.string().optional(),unreadOnly:z.boolean().optional(),
      limit:z.number().int().optional(),note:z.string().optional(),
      wake:z.boolean().optional().describe('Set true ONLY for urgent authorized post to server-controller to wake Sol. Ordinary mail does not wake Main.'),agentId:z.string().optional(),turnId:z.string().optional(),
    },annotations:{readOnlyHint:false},
  },textResult(args=>{
    if(['post','reply'].includes(args.action)&&typeof args.from==='string'&&args.from.startsWith('web-')){
      throw Error('Web Chat identities must send through web_mail to bind the sender to a claimed identity');
    }
    if(['ack','resolve','delete'].includes(args.action)&&args.id){
      const target=tips.messages({action:'get',id:args.id});
      if(target?.to?.startsWith('web-'))throw Error('Web Chat recipients must use web_mail for authenticated receipts');
    }
    const result=tips.messages(args,{trustedWake:true});
    if((args.action==='post'||args.action==='reply')&&result.to==='controller'&&result.priority==='high'){
      tips.notify({category:'message',...result});
    }
    return result;
  }));
  server.registerTool('tips_exchange',{
    title:'Tips tracked exchange: submit and verify Agent handoffs',
    description:TIP_TOOL_DESCRIPTIONS.tips_exchange,
    inputSchema:{
      action:z.enum(['submit','get','list']).describe('submit creates a tracked message; get checks verdict/ACK/replies by id; list returns tracked history.'),
      id:z.string().optional().describe('Tracked message ID returned by submit; required for get.'),
      from:z.string().optional().describe('Optional legacy controller sender, never a claimed web-* identity; use web_mail for that.'),
      to:z.string().optional().describe('Submit recipient must be a managed sub-* Agent ID.'),
      subject:z.string().optional(),
      body:z.string().optional(),
      priority:z.enum(['low','normal','high']).optional(),
      taskId:z.string().optional(),
      limit:z.number().int().optional(),
      status:z.string().optional(),
    },annotations:{readOnlyHint:false},
  },textResult(args=>{
    if(args.action==='submit'){
      if(typeof args.from==='string'&&args.from.startsWith('web-'))throw Error('Use web_mail for claimed Web Chat senders');
      if(typeof args.to!=='string'||!/^sub-[a-z0-9_.-]{1,60}$/i.test(args.to))throw Error('Tracked App Server exchange requires a sub- recipient');
      const message=tips.messages({action:'post',tracked:true,from:args.from??'controller',to:args.to,
        subject:args.subject??'Tracked agent request',body:args.body,priority:args.priority??'normal',taskId:args.taskId},
        {trustedWake:true});
      return {accepted:true,id:message.id,message,webBoard:'/tips',note:'Submitted, not yet verified; poll tips_exchange get until recipient accepts/rejects'};
    }
    if(args.action==='get'){
      const message=tips.messages({action:'get',id:args.id});
      if(!message||!message.tracked)throw Error('Tracked exchange not found');
      const thread=tips.messages({action:'list',threadId:message.threadId??message.id,limit:300});
      return {id:message.id,message,related:thread.filter(x=>x.id!==message.id)};
    }
    return tips.messages({action:'list',limit:300})
      .filter(m=>m.tracked&&(!args.to||m.to===args.to)&&(!args.from||m.from===args.from)&&(!args.status||m.status===args.status))
      .slice(0,Math.min(100,Math.max(1,args.limit??40)));
  }));
}
export function mountTipsRoutes(app,config,express){
  const tips=createTipsV2(config);
  const admin=createTipsAdmin(config,tips);
  const headers=res=>{res.set('Cache-Control','no-store');res.set('Referrer-Policy','no-referrer');res.set('X-Content-Type-Options','nosniff');};
  const auth=(req,res,write=false)=>{
    const expected=write?tips.credentials.writeToken:tips.credentials.viewToken;
    if(!AUTH(req.header('authorization')?.replace(/^Bearer /i,''),expected)){
      headers(res);res.status(401).json({error:'Unauthorized'});return false;
    }
    return true;
  };
  const guard=(handler,req,res)=>{
    try{headers(res);res.json(handler());}
    catch(err){res.status(400).json({error:String(err.message??err)});}
  };
  app.get(['/tips','/tips/'],(_req,res)=>{
    headers(res);res.type('html').send(readFileSync(new URL('./tips-dashboard.html',import.meta.url),'utf8'));
  });
  app.get(['/tips/agents','/tips/agents/'],(_req,res)=>{
    headers(res);res.type('html').send(readFileSync(new URL('./tips-dashboard.html',import.meta.url),'utf8'));
  });
  let overviewCache=null,overviewAt=0;
  app.get('/tips/agents/api',(req,res)=>{
    if(!auth(req,res))return;
    guard(()=>{
      if(!overviewCache||Date.now()-overviewAt>12000){
        overviewCache=buildAgentOverview(config,tips);
        overviewAt=Date.now();
      }
      return overviewCache;
    },req,res);
  });
  app.post('/tips/admin/api',express.json({limit:'256kb'}),(req,res)=>{
    if(!auth(req,res))return;
    // A valid dashboard view token is sufficient; no second admin key.
    guard(()=>{const outcome=admin.run({...req.body,viewToken:tips.credentials.viewToken});overviewCache=null;return outcome},req,res);
  });
  app.get('/tips/api',(req,res)=>{
    if(!auth(req,res))return;
    guard(()=>req.query.action==='history'?tips.mutate({action:'history',id:String(req.query.id??''),limit:Number(req.query.limit??100)}):tips.snapshot(),req,res);
  });
  app.post('/tips/api',express.json({limit:'64kb'}),(req,res)=>{
    if(!auth(req,res,true))return;
    const dispatch=req.header('x-tips-dispatch');
    const trustedUpdate=Boolean(tips.credentials.dispatchToken)&&typeof dispatch==='string'&&AUTH(dispatch,tips.credentials.dispatchToken);
    guard(()=>mutation(tips,req.body,{trustedUpdate}),req,res);
  });
  app.get('/tips/messages',(req,res)=>{
    if(!auth(req,res))return;
    guard(()=>tips.messages({action:'list',to:req.query.to==='all'?undefined:typeof req.query.to==='string'?req.query.to:'controller',unreadOnly:req.query.unreadOnly==='true',limit:Number(req.query.limit??100)}),req,res);
  });
  app.post('/tips/messages',express.json({limit:'16kb'}),(req,res)=>{
    if(!auth(req,res,true))return;
    guard(()=>{
      if(['post','reply'].includes(req.body?.action)&&typeof req.body?.from==='string'&&req.body.from.startsWith('web-')){
        throw Error('Claimed web-* senders must use the identity-bound web_mail MCP tool');
      }
      if(['ack','resolve','delete','verify'].includes(req.body?.action)&&req.body?.id){
        const original=tips.messages({action:'get',id:req.body.id});
        if(original?.to?.startsWith('web-'))throw Error('Claimed Web recipients must use web_mail receipts');
      }
      const dispatch = req.header('x-tips-dispatch');
      const trustedWake = Boolean(tips.credentials.dispatchToken)&&typeof dispatch==='string'&&AUTH(dispatch,tips.credentials.dispatchToken);
      const result=tips.messages(req.body,{trustedWake});
      if(['post','reply'].includes(req.body?.action)&&result.to==='controller'&&result.priority==='high')tips.notify({category:'message',...result});
      return result;
    },req,res);
  });
  // Check tracked heartbeats at a fixed cadence without touching task progress.
  const timer=setInterval(()=>{
    try{for(const task of tips.sweep())tips.notify({category:'task',...task,message:'Agent heartbeat expired'});}
    catch{}
  },60000);
  timer.unref();
}
