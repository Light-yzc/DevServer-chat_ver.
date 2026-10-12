import { subagentRegistry } from '../../../tips/subagents.mjs';
import { createTipsV2 } from './tips-core.js';
import { TIP_TOOL_DESCRIPTIONS } from './tips-tool-descriptions.js';

function safeTool(handler){return async input=>{
  try{return {content:[{type:'text',text:JSON.stringify(handler(input),null,2)}]}}
  catch(e){return {isError:true,content:[{type:'text',text:String(e.message??e)}]}}
}}

export function registerSubagentTool(server,config,z){
  const tips=createTipsV2(config);
  const agents=subagentRegistry(config,tips);
  server.registerTool('subagent',{
    title:'Codex App Server subagents with Tips mailboxes',
    description:TIP_TOOL_DESCRIPTIONS.subagent,
    inputSchema:{
      action:z.enum(['start','list','status','message','stop']).describe('start queues a new Turn; status checks completion; message uses Tips to steer or wake; stop requests termination.'),
      name:z.string().optional().describe('Stable managed Agent identity, must start with sub-, e.g. sub-air-cpu. Required except list.'),
      goal:z.string().optional().describe('Concrete bounded task prompt, required for start; do not authorize frozen GPU experiments by implication.'),
      model:z.enum(['gpt-6-luna','gpt-6.1-sol']).optional().describe('Default Luna. Use Sol only for genuinely difficult checks with explicit budget authorization.'),
      cwd:z.string().optional().describe('Absolute path within a DevSpace allowedRoots workspace.'),
      sandbox:z.enum(['read-only','workspace-write','danger-full-access']).optional().describe('Default workspace-write; danger-full-access is high privilege, use only when explicitly needed.'),
      group:z.string().optional(),
      from:z.string().optional().describe('Non-web sender ID; claimed web-* must use web_mail to preserve authenticated identity.'),
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
        if(typeof input.from==='string'&&input.from.startsWith('web-'))throw Error('Web identity senders must use web_mail');
        const mail=agents.send(input);
        return {accepted:true,mail,agent:agents.status(input.name),note:'Messages are durable; delivery/ACK happen asynchronously'};
      }
      case 'stop':return {accepted:true,agent:agents.stop(input.name)};
      default:throw Error('Invalid action');
    }
  }));
}
