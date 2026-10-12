const $=id=>document.getElementById(id);
const DEFAULT_URL='wss://regen.centralus.cloudapp.azure.com/web-wake/ws';
const isEndpointAllowed=endpoint=>{
  try {const u=new URL(endpoint);return (u.protocol==='wss:'&&u.hostname==='regen.centralus.cloudapp.azure.com'&&u.pathname==='/web-wake/ws') ||
    (u.protocol==='ws:'&&u.hostname==='127.0.0.1'&&u.pathname==='/ws');}catch{return false;}
};
async function refresh(){
  const {endpoint=DEFAULT_URL,token='',enabled=false,lastStatus='Not connected',lastStatusAt=0,serverRoles=[],bindings={},pending={},done={}}
    =await chrome.storage.local.get(['endpoint','token','enabled','lastStatus','lastStatusAt','serverRoles','bindings','pending','done']);
  $('endpoint').value=endpoint;$('token').value=token;$('enabled').checked=enabled;
  $('status').textContent=`${lastStatus}${lastStatusAt?'\n'+new Date(lastStatusAt).toLocaleString():''}\nPending: ${Object.keys(pending).length} · Submitted: ${Object.keys(done).length}`;
  const tabs=await chrome.tabs.query({url:'https://chatgpt.com/*'});
  $('roles').textContent=serverRoles.length ? serverRoles.map(role=>{
    const matches=tabs.filter(t=>t.title?.replace(/\s+(?:[-–—|]|·)\s+ChatGPT\s*$/i,'').trim()===role);
    return `${role}\n  tabs: ${matches.length} ${matches.length===1?'✓':matches.length>1?'⚠ duplicate':'(rename ChatGPT conversation)'}\n  pinned: ${bindings[role]??'not yet'}`;
  }).join('\n'):'No claimed web-* roles received yet';
}
document.addEventListener('DOMContentLoaded',refresh);
$('save').addEventListener('click',async()=>{
  const endpoint=$('endpoint').value.trim(),token=$('token').value.trim();
  if(!isEndpointAllowed(endpoint)){ $('status').textContent='不支持此 URL。请使用配置的 HTTPS 域名或本机 127.0.0.1 Relay。';return;}
  if($('enabled').checked && token.length<32){$('status').textContent='请先填写服务器生成的完整私有令牌。';return;}
  await chrome.storage.local.set({endpoint,token,enabled:$('enabled').checked,lastStatus:'Connecting…',lastStatusAt:Date.now()});
  await chrome.runtime.sendMessage({type:'DEVSPACE_RECONNECT'});await refresh();
});
$('refresh').addEventListener('click',async()=>{await chrome.runtime.sendMessage({type:'DEVSPACE_PUMP'});await refresh();});
$('reset').addEventListener('click',async()=>{
  const role=$('resetRole').value.trim(),{bindings={}}=await chrome.storage.local.get('bindings');
  if(!/^web-[a-z0-9][a-z0-9_.-]{0,58}$/.test(role)){$('status').textContent='无效身份 ID';return;}
  delete bindings[role];await chrome.storage.local.set({bindings});await refresh();
});
