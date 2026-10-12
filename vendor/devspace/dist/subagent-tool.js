import { subagentRegistry } from '../../../tips/subagents.mjs';
import { createTipsV2 } from './tips-core.js';

function safeTool(handler){return async input=>{
  try{return {content:[{type:'text',text:JSON.stringify(handler(input),null,2)}]}}
  catch(e){return {isError:true,content:[{type:'text',text:String(e.message??e)}]}}
}}

export function registerSubagentTool(server,config,z){
  const tips=createTipsV2(config);
  const agents=subagentRegistry(config,tips);
  server.registerTool('subagent',{
    title:'Codex App Server subagents with Tips mailboxes',
    description:'Required Tips protocol for ALL managed subagents: start research subagents through this Codex App Server tool. The first actual Turn of a persistent Thread receives the complete Tips mailbox protocol ONCE. Later resumed turns receive only their task and incoming messages, without repeated policy text. While working, the bridge polls trusted incoming messages and attempts turn/steer; when idle, a trusted message wakes the same Codex thread. Delivery is NOT reading: each subagent ACKs only messages actually read, RESOLVEs only completed work, and replies or sends progress updates via Tips; unacknowledged delivered messages have limited redelivery attempts. action=start queues Luna (default) or explicitly requested Sol with independent thread; list/status inspects jobs; message sends trusted Tips mail; stop stops only the managed child. start is asynchronous/queued, not success. Existing codex exec experiment owners are NOT automatically migrated. Default sandbox workspace-write; danger-full-access only when explicitly requested. Respect GPU freezes, approvals, and Sol budgets.',
    inputSchema:{
      action:z.enum(['start','list','status','message','stop']),
      name:z.string().optional(),
      goal:z.string().optional(),
      model:z.enum(['gpt-6-luna','gpt-6.1-sol']).optional(),
      cwd:z.string().optional(),
      sandbox:z.enum(['read-only','workspace-write','danger-full-access']).optional(),
      group:z.string().optional(),
      from:z.string().optional(),
      subject:z.string().optional(),
      body:z.string().optional(),
      priority:z.enum(['low','normal','high']).optional(),
    },annotations:{readOnlyHint:false},
  },safeTool(input=>{
    switch(input.action){
      case 'list':return agents.list();
      case 'status':{
        const agent=agents.status(input.name);
        if(!agent)throw Error('Unknown subagent');
        return {agent,mail:tips.messages({action:'list',to:input.name,limit:15})};
      }
      case 'start':return {accepted:true,agent:agents.start(input),note:'Job is queued; poll status for actual App Server turn results'};
      case 'message':{
        const mail=agents.send(input);
        return {accepted:true,mail,agent:agents.status(input.name),note:'Messages are durable; delivery/ACK happen asynchronously'};
      }
      case 'stop':return {accepted:true,agent:agents.stop(input.name)};
      default:throw Error('Invalid action');
    }
  }));
}
