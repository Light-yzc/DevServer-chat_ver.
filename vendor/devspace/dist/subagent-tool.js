import { subagentRegistry } from '../../../tips/subagents.mjs';
import { createTipsV2 } from './tips-core.js';
import { TIP_TOOL_DESCRIPTIONS } from './tips-tool-descriptions.js';
import {readSubEvidence,listSubJobEvidence} from '../../../tips/subagent-evidence.mjs';
import {createWebIdentityStore} from './web-identity-store.js';
import {openAiConversationScopeId} from './request-meta.js';
import {listSubagentModelChoices} from '../../../tips/codex-model-list.mjs';

function safeTool(handler){return async (input,extra)=>{
  try{return {content:[{type:'text',text:JSON.stringify(await handler(input,extra),null,2)}]}}
  catch(e){return {isError:true,content:[{type:'text',text:String(e.message??e)}]}}
}}

export function registerSubagentTool(server,config,z){
  const tips=createTipsV2(config);
  const agents=subagentRegistry(config,tips);
  const identities=createWebIdentityStore(config);
  server.registerTool('subagent',{
    title:'Codex App Server subagents with Tips mailboxes',
    description:TIP_TOOL_DESCRIPTIONS.subagent,
    inputSchema:{
      action:z.enum(['models','start','list','status','jobs','handoff','result','diff','log','events','manifest','documentation','message','stop']).describe('models reads Codex model/list and configured providers WITHOUT running a model Turn. jobs lists prior Turns; handoff/diff/log are bounded reads.'),
      name:z.string().optional().describe('Stable managed Agent identity, must start with sub-, e.g. sub-air-cpu. Required except list/models.'),
      goal:z.string().optional().describe('Concrete bounded task prompt, required for start; do not authorize frozen GPU experiments by implication.'),
      model:z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:\/+\-]{0,119}$/).optional().describe('Codex model ID. Native: gpt-6-luna or gpt-6.1-sol. Custom: e.g. grok-4.7 with provider=runanytime_grok configured in Codex config.toml.'),
      provider:z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/).optional().describe('Codex config.toml [model_providers.NAME] ID, e.g. runanytime_grok. Not another Agent app. Default native Luna/Sol provider remains unchanged.'),
      cwd:z.string().optional().describe('Absolute path within a DevSpace allowedRoots workspace.'),
      sandbox:z.enum(['read-only','workspace-write','danger-full-access']).optional().describe('Owner policy: managed Subagents always use danger-full-access; legacy lower values are normalized to full access. This does NOT authorize frozen GPU or STOP-protected work.'),
      group:z.string().optional(),
      from:z.string().optional().describe('Non-web sender ID; claimed web-* must use web_mail to preserve authenticated identity.'),
      subject:z.string().optional(),
      body:z.string().optional(),
      priority:z.enum(['low','normal','high']).optional(),
      jobId:z.string().uuid().optional().describe('Optional precise Sub Turn ID; defaults to this Sub identity current job.'),
      maxChars:z.number().int().min(200).max(16000).optional().describe('Maximum read-only excerpt length, default 7000.'),
      includeHidden:z.boolean().optional().describe('models only: include hidden entries from the Codex App Server default-provider catalog.'),
    },annotations:{readOnlyHint:false},
  },safeTool((input,extra)=>{
    switch(input.action){
      case 'list':return agents.list();
      case 'models':return listSubagentModelChoices({includeHidden:input.includeHidden});
      case 'status':{
        const agent=agents.status(input.name);
        if(!agent)throw Error('Unknown subagent');
        return {agent,mail:tips.messages({action:'list',to:input.name,limit:15})};
      }
      case 'jobs':{
        const agent=agents.status(input.name);if(!agent)throw Error('Unknown subagent');
        return {name:agent.name,jobs:listSubJobEvidence({dir:agents.dir,name:agent.name,limit:30})};
      }
      case 'handoff':case 'result':case 'diff':case 'log':case 'events':case 'manifest':{
        const agent=agents.status(input.name);
        if(!agent)throw Error('Unknown subagent');
        const jobId=input.jobId??agent.jobId;
        if(!jobId)throw Error('No Subagent Turn recorded');
        return readSubEvidence({dir:agents.dir,name:agent.name,jobId,kind:input.action,limitChars:input.maxChars});
      }
      case 'start':{
        let reportTo=null;
        try{reportTo=identities.authenticate({scope:openAiConversationScopeId(extra?._meta)}).id}catch{}
        if(reportTo&&!/^web-[a-z0-9_.-]{1,60}$/.test(reportTo))reportTo=null;
        return {accepted:true,agent:agents.start({...input,reportTo}),
          note:'Job queued; its verified Web caller (if recognized) is retained for completion handoff. Poll jobs/handoff by jobId.'};
      }
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
