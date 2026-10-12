import { openAiConversationScopeId } from './request-meta.js';
import { createWebIdentityStore } from './web-identity-store.js';
import { createTipsV2 } from './tips-core.js';

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
    description:'One Web Chat = one claimed web-* role. DevSpace OAuth authenticates server access but multiple ChatGPT chats may share OAuth. action=prepare creates an available role and a PRIVATE single-use invite valid 10 minutes (the main Web Chat can prepare slots). action=claim id+invite self-registers instantly WITHOUT another Web approval, binding this Chat to its OpenAI conversation metadata when available; returns private claimKey as a fallback if conversation metadata is unavailable/changes. On later turns call action=whoami to recognize the chat, optionally including claimKey if not automatically recognized. action=list shows nonsecret role slots; renew extends a seven-day lease; release frees your own role. Do NOT print or share invite/claimKey to Tips boards or Agent message bodies. The service cannot auto-activate an idle ChatGPT chat. If no stable OpenAI session metadata is supplied, identity requires claimKey on each call. No code can prove two ChatGPT tabs differ when both provide identical server-visible metadata.',
    inputSchema:{action:z.enum(['prepare','claim','whoami','list','renew','release']),
      id:z.string().optional(),label:z.string().optional(),invite:z.string().optional(),claimKey:z.string().optional()},
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
    }
  }));
  server.registerTool('web_mail',{
    title:'Identity-bound Web Chat and Agent mailbox',
    description:'After web_identity claim, this tool recognizes the Web Chat from OpenAI conversation metadata (or private claimKey fallback). Sender identity is ALWAYS derived from the claimed role, never a caller supplied from field. action=send to a web-*, sub-* or server-controller recipient; optional tracked=true requests recipient ACK and formal verdict. action=inbox/get reads only messages involving this chat; ack/reply/resolve/verify record reading, reply and recipient verdict under the claimed identity. Web-to-Web messages remain on the server until the other chat next calls inbox; Tips cannot wake a closed/inactive ChatGPT window. All sent/received messages are visible on the Tips board with true identities. Do NOT put claimKey inside message body, and do not use ordinary tips_messages to impersonate web-* identities.',
    inputSchema:{action:z.enum(['send','inbox','sent','get','ack','reply','resolve','verify']),
      claimKey:z.string().optional(),to:z.string().optional(),id:z.string().optional(),
      subject:z.string().optional(),body:z.string().optional(),priority:z.enum(['low','normal','high']).optional(),
      tracked:z.boolean().optional(),wake:z.boolean().optional(),limit:z.number().int().optional(),
      verdict:z.enum(['accepted','rejected','needs_changes']).optional(),note:z.string().optional()},
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
          tracked:args.tracked===true,wake:args.wake===true},{trustedWake:true});
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
