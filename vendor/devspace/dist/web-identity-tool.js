import { openAiConversationScopeId } from './request-meta.js';
import { createWebIdentityStore } from './web-identity-store.js';
import { createTipsV2 } from './tips-core.js';
import { TIP_TOOL_DESCRIPTIONS } from './tips-tool-descriptions.js';

function result(fn){return async (args,context)=>{
  try {return {content:[{type:'text',text:JSON.stringify(fn(args,context),null,2)}]}}
  catch(e){return {isError:true,content:[{type:'text',text:String(e.message??e)}]}}
}}
const schemaRecipient=/^(web-[a-z0-9_.-]{1,60}|sub-[a-z0-9_.-]{1,60}|server-controller|controller)$/i;

export function registerWebIdentityTools(server,config,z){
  const store=createWebIdentityStore(config),tips=createTipsV2(config);
  const context=(args,extra)=>({scope:openAiConversationScopeId(extra?._meta),claimKey:args.claimKey});
  const identity=(args,extra)=>store.authenticate(context(args,extra));
  server.registerTool('web_identity',{
    title:'Register and recognize a specific Web Chat identity',
    description:TIP_TOOL_DESCRIPTIONS.web_identity,
    inputSchema:{action:z.enum(['prepare','claim','whoami','list','renew','release','revoke']).describe('prepare/claim/register; whoami; revoke a web-* identity with the private Tips viewToken.'),
      id:z.string().optional().describe('Role ID starting with web-, required for prepare/claim/revoke; do not use a server Agent ID here.'),label:z.string().optional(),invite:z.string().optional().describe('PRIVATE 10-minute one-time token returned by prepare, needed for claim only.'),claimKey:z.string().optional().describe('PRIVATE fallback credential returned by claim; only needed when automatic conversation recognition fails.'),
      viewToken:z.string().optional().describe('PRIVATE Tips dashboard view token, required on each revoke call. Never put it into Tips message bodies.'),
      reason:z.string().optional().describe('Optional audit reason for administrator revoke, maximum 400 characters.')},
    annotations:{readOnlyHint:false},
  },result((args,extra)=>{
    const ctx=context(args,extra);
    switch(args.action){
      case 'prepare':return store.prepare(args);
      case 'claim':return store.claim({...args,scope:ctx.scope});
      case 'whoami':return store.whoami(ctx);
      case 'list':return {roles:store.list(),scopeAvailable:Boolean(ctx.scope)};
      case 'renew':return store.renew(ctx);
      case 'release':return store.release(ctx);
      case 'revoke':{
        return store.revoke(args.id,args.viewToken,tips.credentials.viewToken,args.reason??'');
      }
    }
  }));
  server.registerTool('web_mail',{
    title:'Identity-bound Web Chat and Agent mailbox',
    description:TIP_TOOL_DESCRIPTIONS.web_mail,
    inputSchema:{action:z.enum(['send','inbox','sent','get','ack','reply','resolve','verify']).describe('send creates mail; inbox/sent list own mail; get inspects one; ack after reading; reply; resolve untracked or verify tracked after ACK.'),
      claimKey:z.string().optional().describe('PRIVATE fallback Web identity credential; only if whoami does not auto-recognize this Chat.'),to:z.string().optional().describe('Recipient ID: web-*, sub-*, controller (legacy) or server-controller.'),id:z.string().optional().describe('Original message UUID for get/ack/reply/resolve/verify.'),
      subject:z.string().optional(),body:z.string().optional().describe('Message text. Never include invite, claimKey or credentials.'),priority:z.enum(['low','normal','high']).optional(),
      tracked:z.boolean().optional().describe('True means the recipient must ACK and issue verify verdict; tracked requests must not use plain resolve.'),wake:z.boolean().optional().describe('Trusted mail to server-controller requests a Sol wake by default; normal priority is coalesced for 10 minutes, high priority is immediate. Specify false for passive notes. Cannot wake another Web Chat.'),limit:z.number().int().optional(),
      verdict:z.enum(['accepted','rejected','needs_changes']).optional().describe('Required for verify on tracked messages, after ACK.'),note:z.string().optional()},
    annotations:{readOnlyHint:false},
  },result((args,extra)=>{
    const me=identity(args,extra),id=me.id;
    const involved=m=>m&&(m.from===id||m.to===id);
    const received=m=>m&&m.to===id;
    const fetch=id=>{
      const m=tips.messages({action:'get',id});
      if(!involved(m))throw Error('Message is not addressed to or sent by this Web identity');
      return m;
    };
    switch(args.action){
      case 'send':{
        if(typeof args.to!=='string'||!schemaRecipient.test(args.to))throw Error('Invalid recipient');
        if(args.to.startsWith('web-')&&!store.list().some(role=>role.id===args.to))throw Error('Web recipient identity not registered');
        if(typeof args.body!=='string'||!args.body.trim())throw Error('Message body required');
        if(args.wake===true&&args.to!=='server-controller')throw Error('wake=true is only for server-controller');
        const msg=tips.messages({action:'post',from:id,to:args.to,body:args.body,
          subject:args.subject??`Message from ${id}`,priority:args.priority??'normal',
          tracked:args.tracked===true,...(args.wake!==undefined?{wake:args.wake}:{})},{trustedWake:true});
        return {message:msg,authenticatedSender:id};
      }
      case 'inbox':return {identity:id,messages:tips.messages({action:'list',to:id,limit:Math.min(200,Math.max(1,args.limit??50))})};
      case 'sent':return {identity:id,messages:tips.messages({action:'list',limit:300})
        .filter(message=>message.from===id).slice(0,Math.min(200,Math.max(1,args.limit??50)))};
      case 'get':return {identity:id,message:fetch(args.id)};
      case 'ack':{
        const m=fetch(args.id);if(!received(m))throw Error('Only the recipient may ACK');
        return tips.messages({action:'ack',id:m.id,agentId:id});
      }
      case 'reply':{
        const m=fetch(args.id);if(!received(m))throw Error('Only a recipient may reply to this message');
        if(typeof args.body!=='string'||!args.body.trim())throw Error('Reply body required');
        return tips.messages({action:'reply',from:id,to:m.from,inReplyTo:m.id,
          subject:args.subject??`Re: ${m.subject}`,body:args.body,priority:args.priority??'normal'}, {trustedWake:true});
      }
      case 'resolve':{
        const m=fetch(args.id);if(!received(m))throw Error('Only recipient may resolve');
        if(m.ackBy!==id)throw Error('ACK before resolving');
        return tips.messages({action:'resolve',id:m.id,agentId:id,note:args.note??''});
      }
      case 'verify':{
        const m=fetch(args.id);if(!received(m))throw Error('Only recipient may verify');
        return tips.messages({action:'verify',id:m.id,agentId:id,verdict:args.verdict,note:args.note??''},{trustedWake:true});
      }
    }
  }));
}
