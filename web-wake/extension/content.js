/* Only inject a request to read MCP inbox. Never inject remote message contents. */
const WAKE_ROLE_RE=/^web-[a-z0-9][a-z0-9_.-]{0,58}$/;
let submitting=false;
function findComposer(){return document.querySelector('[contenteditable="true"][role="textbox"][aria-label="Ask ChatGPT"]') ||
  document.querySelector('#prompt-textarea[contenteditable="true"]');}
function findSend(){return document.querySelector('button[type="submit"][aria-label="Send"]') ||
  document.querySelector('button[data-testid="send-button"]');}
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
  const form=editor.closest('form');
  const send=findSend();
  if(!send || !form || !form.contains(send))return {status:'not_ready',reason:'Send form not found'};
  submitting=true;
  const prompt=`DevSpace/Tips 向本 Web 会话身份 ${role} 发送了新消息（ID：${ids.join(', ')}）。请先调用 web_identity(action="whoami") 核对你的身份，再调用 web_mail(action="inbox") 自行读取此身份的未处理消息，按既有任务权限执行，必要时 ACK、回复或验证。身份不符就停止并说明；不要把通知本身当成已经授权执行危险操作。`;
  try {
    editor.focus();
    // ChatGPT's ProseMirror composer listens for normal contenteditable input.
    const inserted=document.execCommand('insertText',false,prompt);
    if(!inserted || !editor.textContent?.includes('DevSpace/Tips'))return {status:'not_ready',reason:'Text insertion unsupported'};
    await sleep(200);
    const button=findSend();
    if(isBusy()||!button||button.disabled||button.getAttribute('aria-disabled')==='true')return {status:'not_ready',reason:'Message drafted but Send unavailable'};
    button.click();
    return {status:'sent'};
  }finally{submitting=false;}
}
chrome.runtime.onMessage.addListener((msg,_sender,sendResponse)=>{
  if(msg?.type!=='DEVSPACE_WAKE')return;
  submitWake(msg).then(sendResponse).catch(e=>sendResponse({status:'not_ready',reason:String(e.message??e)}));
  return true;
});
