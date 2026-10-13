/* Only inject a request to read MCP inbox. Never inject remote message contents. */
(() => {
const VERSION=chrome.runtime.getManifest().version;
const INSTALL_KEY='__devspaceWebWakeContent';
const previous=globalThis[INSTALL_KEY];
if(previous?.version===VERSION && previous.alive())return;
previous?.dispose();
document.documentElement.setAttribute('data-devspace-wake-version',VERSION);
const WAKE_ROLE_RE=/^web-[a-z0-9][a-z0-9_.-]{0,58}$/;
const QUIET_MS=20_000;
let submitting=false,disposed=false,lastActivity=Date.now(),observedPath=location.pathname;
const confirmed=new Map();
function alive(){try{return !disposed && !!chrome.runtime.id;}catch{return false;}}
function findComposer(){return document.querySelector('[contenteditable="true"][role="textbox"][aria-label="Ask ChatGPT"]') ||
  document.querySelector('#prompt-textarea[contenteditable="true"]');}
function composerRoot(editor){return editor?.closest('form') || editor?.closest('[data-chatgpt-composer]');}
function findSend(editor){return composerRoot(editor)?.querySelector('button[data-testid="send-button"],button[type="submit"][aria-label="Send"],button[type="submit"][aria-label="Send message"],button[type="submit"][aria-label="发送"],button[type="submit"][aria-label="发送消息"]');}
function hasAttachments(editor){return !!(editor.querySelector('[data-testid="file-thumbnail"]') || document.querySelector('[data-testid="composer-attachment"]'));}
function latestTurn(){return Array.from(document.querySelectorAll('main [data-turn-key]')).at(-1);}
function activityState(){
  if(observedPath!==location.pathname){observedPath=location.pathname;lastActivity=Date.now();}
  // Observed in Edge 2026-10-13: Stop is not the sole activity signal. The
  // current sidebar row says Working, and the full turn stays in_progress
  // across thinking/tool calls, even after an intermediate assistant reply.
  const working=document.querySelector('[role="group"][aria-current="page"] [role="status"][aria-label="Working"]');
  const stop=document.querySelector('button[data-testid="stop-button"],button[aria-label="Stop generating"],button[aria-label="Stop"],button[aria-label="停止生成"]');
  const turn=latestTurn();
  const state=turn?.querySelector('[data-talvt-turn-state]')?.getAttribute('data-talvt-turn-state');
  const streaming=turn?.querySelector('[data-markdown-animated]');
  if(stop || working || streaming || state!=='complete'){
    lastActivity=Date.now();return {status:'busy',reason:state?'Web turn is still processing':'Web turn state unknown'};
  }
  if(Date.now()-lastActivity<QUIET_MS)return {status:'busy',reason:'Waiting for stable idle'};
  return {status:'idle'};
}
const observer=new MutationObserver(records=>{
  const turn=latestTurn();
  if(records.some(r=>turn && (turn.contains(r.target) || Array.from(r.addedNodes??[]).some(n=>n===turn || n.contains?.(turn)))))lastActivity=Date.now();
});
observer.observe(document.documentElement,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['data-talvt-turn-state','data-markdown-animated','aria-busy','aria-label']});
function sleep(ms){return new Promise(resolve=>setTimeout(resolve,ms));}
function probe(){
  if(!alive())return {status:'not_ready',reason:'Content context unavailable',version:VERSION};
  const editor=findComposer();
  if(!editor || !composerRoot(editor))return {status:'not_ready',reason:'Composer not ready',version:VERSION};
  const state=activityState();
  if(submitting || editor.textContent?.trim() || hasAttachments(editor))return {status:'busy',reason:'Web is processing or has a draft',version:VERSION};
  return {...state,version:VERSION};
}
async function submitWake({role,ids}){
  if(submitting)return {status:'busy'};
  if(!WAKE_ROLE_RE.test(role) || !Array.isArray(ids) || !ids.length || ids.length>30 || ids.some(id=>typeof id!=='string'||!/^[a-f\d-]{36}$/i.test(id)))return {status:'invalid'};
  const path=location.pathname;
  if(!/^\/c\/[a-f0-9-]{36}\/?$/i.test(path))return {status:'not_ready',reason:'Not a saved conversation'};
  const alreadySent=ids.filter(id=>confirmed.get(id)===path);
  if(alreadySent.length)return {status:'sent',ids:alreadySent};
  const readiness=probe();
  if(readiness.status!=='idle')return readiness;
  const editor=findComposer();
  submitting=true;
  const prompt=`DevSpace/Tips：${role} 有新消息（ID：${ids.join(', ')}）。请调用 web_mail(action="inbox") 读取未读消息；按已有授权处理后 ACK，必要时回复。必要时请尝试推进进度、启动 agent 或发送信息。本轮结束前再查一次 inbox；受阻则说明原因，勿无限轮询。`;
  let clicked=false;
  try {
    editor.focus();
    const inserted=document.execCommand('insertText',false,prompt);
    if(!inserted || editor.textContent?.trim()!==prompt.trim())return {status:'not_ready',reason:'Text insertion unsupported'};
    for(let attempt=0;attempt<40;attempt++){
      await sleep(100);
      if(!alive() || path!==location.pathname || !editor.isConnected || editor.textContent?.trim()!==prompt.trim())return {status:'not_ready',reason:'Composer changed; wake remains queued'};
      if(activityState().status!=='idle' || hasAttachments(editor))return {status:'busy',reason:'Web resumed processing; wake queued'};
      const button=findSend(editor);
      if(!button || button.disabled || button.getAttribute('aria-disabled')==='true')continue;
      // Recheck the newest pending/ACK state just before clicking. Never infer
      // ACK from a disappearing event or an empty composer.
      const approval=await chrome.runtime.sendMessage({type:'DEVSPACE_WAKE_CHECK',role,ids});
      if(!approval?.ok)return {status:'not_ready',reason:'Wake changed or ACKed; waiting for next snapshot'};
      if(!alive() || path!==location.pathname || !editor.isConnected || editor.textContent?.trim()!==prompt.trim() || hasAttachments(editor) || activityState().status!=='idle')return {status:'busy',reason:'Web resumed processing; wake queued'};
      const currentButton=findSend(editor);
      if(!currentButton || currentButton.disabled || currentButton.getAttribute('aria-disabled')==='true')continue;
      clicked=true;currentButton.click();lastActivity=Date.now();
      for(let check=0;check<50;check++){
        await sleep(100);
        if(path!==location.pathname)return {status:'not_ready',reason:'Conversation changed; submission not confirmed'};
        const current=findComposer();
        if(current && !current.textContent?.trim()){
          for(const id of ids)confirmed.set(id,path);
          return {status:'sent'};
        }
      }
      return {status:'not_ready',reason:'Submission not confirmed; wake draft preserved, check the chat'};
    }
    return {status:'not_ready',reason:'Send unavailable; wake remains queued'};
  }finally{
    // Before any click, remove only our exact unchanged draft. User edits and
    // attachments are preserved; after a click retain ambiguous drafts.
    if(!clicked && alive() && editor.isConnected && editor.textContent?.trim()===prompt.trim()){
      editor.focus();
      const selection=window.getSelection(),range=document.createRange();
      range.selectNodeContents(editor);selection.removeAllRanges();selection.addRange(range);
      document.execCommand('delete',false);
    }
    submitting=false;
  }
}
function onMessage(msg,_sender,sendResponse){
  if(msg?.type==='DEVSPACE_STATUS'){sendResponse(probe());return;}
  if(msg?.type!=='DEVSPACE_WAKE')return;
  submitWake(msg).then(sendResponse).catch(e=>sendResponse({status:'not_ready',reason:String(e.message??e)}));
  return true;
}
chrome.runtime.onMessage.addListener(onMessage);
globalThis[INSTALL_KEY]={version:VERSION,alive,dispose(){disposed=true;observer.disconnect();try{chrome.runtime.onMessage.removeListener(onMessage);}catch{}}};
})();
