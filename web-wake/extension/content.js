/* Only inject a request to read MCP inbox. Never inject remote message contents. */
const WAKE_ROLE_RE=/^web-[a-z0-9][a-z0-9_.-]{0,58}$/;
let submitting=false;
function findComposer(){return document.querySelector('[contenteditable="true"][role="textbox"][aria-label="Ask ChatGPT"]') ||
  document.querySelector('#prompt-textarea[contenteditable="true"]');}
function findSend(editor){
  const root=editor.closest('form') || editor.closest('[data-chatgpt-composer]');
  return root?.querySelector('button[data-testid="send-button"],button[type="submit"][aria-label="Send"],button[type="submit"][aria-label="Send message"],button[type="submit"][aria-label="发送"],button[type="submit"][aria-label="发送消息"]');
}
function isBusy(){return !!document.querySelector('button[data-testid="stop-button"],button[aria-label="Stop generating"],button[aria-label="Stop"],button[aria-label="停止生成"]');}
function sleep(ms){return new Promise(resolve=>setTimeout(resolve,ms));}
async function submitWake({role,ids}){
  if(submitting)return {status:'busy'};
  if(!WAKE_ROLE_RE.test(role) || !Array.isArray(ids) || ids.length>30 || ids.some(id=>typeof id!=='string'||!/^[a-f\d-]{36}$/i.test(id)))return {status:'invalid'};
  if(!/^\/c\/[a-f0-9-]{36}\/?$/i.test(location.pathname))return {status:'not_ready',reason:'Not a saved conversation'};
  if(isBusy())return {status:'busy'};
  const editor=findComposer();
  if(!editor)return {status:'not_ready',reason:'Composer not found'};
  if(editor.textContent?.trim() || editor.querySelector('[data-testid="file-thumbnail"]') ||
    document.querySelector('[data-testid="composer-attachment"]'))return {status:'busy'};
  if(!editor.closest('form') && !editor.closest('[data-chatgpt-composer]'))return {status:'not_ready',reason:'Composer container not found'};
  submitting=true;
  const prompt=`DevSpace/Tips：${role} 有新消息（ID：${ids.join(', ')}）。请调用 web_mail(action="inbox") 读取，按授权处理并 ACK，必要时回复或推进研究、启动 agent。任务完成后务必再查一次 inbox，处理完新信并 ACK 才结束；若受门禁阻塞，说明原因和下一 Owner，勿无限轮询。`;
  try {
    editor.focus();
    // ChatGPT's ProseMirror composer listens for normal contenteditable input.
    const inserted=document.execCommand('insertText',false,prompt);
    if(!inserted || !editor.textContent?.includes('DevSpace/Tips'))return {status:'not_ready',reason:'Text insertion unsupported'};
    // Empty ChatGPT composers show Voice instead of Send. Wait for React to
    // mount and enable Send AFTER insertion, scoped to this composer only.
    for(let attempt=0;attempt<40;attempt++){
      await sleep(100);
      if(!editor.isConnected || editor.textContent?.trim()!==prompt.trim())return {status:'not_ready',reason:'Composer changed; wake remains queued'};
      const button=findSend(editor);
      if(isBusy())break;
      if(!button || button.disabled || button.getAttribute('aria-disabled')==='true')continue;
      button.click();
      // A click alone is not a submission. Only record success after the
      // composer clears; otherwise keep pending and preserve the draft.
      for(let check=0;check<50;check++){
        await sleep(100);
        const current=findComposer();
        if(current && !current.textContent?.trim())return {status:'sent'};
      }
      return {status:'not_ready',reason:'Submission not confirmed; wake draft preserved, check the chat'};
    }
    // No click occurred. Remove only our unchanged draft so a later alarm
    // can retry; never erase a draft edited by the user.
    if(editor.isConnected && editor.textContent?.trim()===prompt.trim()){
      editor.focus();
      const selection=window.getSelection(),range=document.createRange();
      range.selectNodeContents(editor);selection.removeAllRanges();selection.addRange(range);
      document.execCommand('delete',false);
    }
    return {status:'not_ready',reason:'Send unavailable; wake remains queued'};
  }finally{submitting=false;}
}
chrome.runtime.onMessage.addListener((msg,_sender,sendResponse)=>{
  if(msg?.type!=='DEVSPACE_WAKE')return;
  submitWake(msg).then(sendResponse).catch(e=>sendResponse({status:'not_ready',reason:String(e.message??e)}));
  return true;
});
