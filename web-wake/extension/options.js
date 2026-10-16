const $=id=>document.getElementById(id);
const DEFAULT_URL='wss://regen.centralus.cloudapp.azure.com/web-wake/ws';
let initialized=false,refreshSequence=0;
const isEndpointAllowed=endpoint=>{
  try {const u=new URL(endpoint);return (u.protocol==='wss:'&&u.hostname==='regen.centralus.cloudapp.azure.com'&&u.pathname==='/web-wake/ws') ||
    (u.protocol==='ws:'&&u.hostname==='127.0.0.1'&&u.pathname==='/ws');}catch{return false;}
};
function element(tag,className,text){const node=document.createElement(tag);node.className=className;node.textContent=text;return node;}
function statusText(raw){
  if(raw==='Connected and authenticated')return '已连接，认证成功';
  if(raw==='Connecting…')return '正在连接…';
  if(raw==='Not connected')return '尚未连接';
  const sent=raw.match(/^Wake submitted: (\S+) \((\d+) message\(s\)\)/);
  if(sent)return `已提交提醒 ${sent[1]} · ${sent[2]} 条消息（等待 Web ACK）`;
  const recovery=raw.match(/^Recovery (\d)\/(\d) submitted: (\S+) \((\d+) message\(s\)\)/);
  if(recovery)return `${recovery[3]} 已发送第 ${recovery[1]}/${recovery[2]} 次超时恢复提醒 · ${recovery[4]} 条消息`;
  const notReady=raw.match(/^Chat (\S+) content script not ready/);
  if(notReady)return `${notReady[1]} 需要刷新聊天页面`;
  if(raw.includes('Page script recovery pending'))return '正在恢复页面脚本，消息保持排队';
  if(raw.includes('Page script recovery failed'))return '页面脚本恢复失败，请检查插件对 ChatGPT 的网站访问权限';
  if(raw.includes('Chat page is loading or sleeping'))return '聊天页面正在加载或休眠，消息保持排队';
  if(raw.includes('is processing or waiting for stable idle'))return 'Web 正在处理或等待稳定空闲，消息保持排队';
  const busy=raw.match(/^Chat (\S+) is generating or has a draft/);
  if(busy)return `${busy[1]} 正在生成或有草稿，稍后重试`;
  return raw;
}
async function resetBinding(role){
  const {bindings={}}=await chrome.storage.local.get('bindings');
  delete bindings[role];await chrome.storage.local.set({bindings});await refresh();
}
async function refresh(){
  const sequence=++refreshSequence;
  const {endpoint=DEFAULT_URL,token='',enabled=false,lastStatus='Not connected',lastStatusAt=0,serverRoles=[],bindings={},pending={},submitted={},done={},recoveries={}}
    =await chrome.storage.local.get(['endpoint','token','enabled','lastStatus','lastStatusAt','serverRoles','bindings','pending','submitted','done','recoveries']);
  const tabs=await chrome.tabs.query({url:'https://chatgpt.com/*'});
  if(sequence!==refreshSequence)return;
  // Live status updates must not overwrite settings the user is editing.
  if(!initialized){$('endpoint').value=endpoint;$('token').value=token;$('enabled').checked=enabled;
    $('settings').open=!token;initialized=true;}
  $('mode').classList.toggle('on',enabled);
  $('modeText').textContent=enabled?'自动唤醒已开启':'自动唤醒已暂停';
  $('pendingCount').textContent=Object.keys(pending).length;
  $('submittedCount').textContent=Object.keys(submitted).length;
  $('doneCount').textContent=Object.keys(done).length;
  const exhausted=Object.values(recoveries).filter(v=>v?.count>=2).length;
  $('recoveryState').textContent=exhausted?`${exhausted} 条提醒已达到 2 次恢复上限，可检查对应 Web 对话。`:
    '30 分钟无 ACK 且页面空闲才尝试恢复，最多 2 次。';
  $('status').textContent=statusText(lastStatus);
  $('updated').textContent=lastStatusAt?`最近状态 · ${new Date(lastStatusAt).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false})}`:'';
  $('updated').dateTime=lastStatusAt?new Date(lastStatusAt).toISOString():'';
  const roles=[...new Set(serverRoles)].filter(role=>/^web-[a-z0-9][a-z0-9_.-]{0,58}$/.test(role));
  $('roleCount').textContent=`${roles.length} 个身份`;
  const cards=roles.map(role=>{
    const matches=tabs.filter(t=>t.title?.replace(/\s+(?:[-–—|]|·)\s+ChatGPT\s*$/i,'').trim()===role);
    const pin=bindings[role];
    const mismatch=matches.length===1 && pin && (()=>{try{return new URL(matches[0].url).pathname.replace(/\/$/,'')!==`/c/${pin}`;}catch{return true;}})();
    const ready=matches.length===1&&!mismatch;
    const card=element('article','role','');
    const heading=element('div','role-heading','');
    heading.append(element('span','role-name',role),element('span',`badge ${ready?'ready':matches.length>1||mismatch?'warn':''}`,mismatch?'绑定不符':matches.length===1?'标签页已匹配':matches.length>1?`${matches.length} 个重复标签页`:'未找到标签页'));
    card.append(heading);
    if(mismatch||matches.length>1)card.append(element('p','role-help',mismatch?'当前聊天与已绑定的会话不同；切回原会话或解除绑定。':matches.length>1?'同名标签页只保留一个，才能自动唤醒。':'打开对应聊天，并将标题设为此身份名称。'));
    const footer=element('div','role-footer','');
    const binding=element('span','','');binding.append(document.createTextNode(pin?'已绑定 · ':'尚未绑定'));
    if(pin){const id=element('span','binding',`${pin.slice(0,8)}…${pin.slice(-4)}`);id.title=pin;binding.append(id);}
    footer.append(binding);
    if(pin){const reset=element('button','unbind','解除绑定');reset.type='button';reset.setAttribute('aria-label',`解除 ${role} 的绑定`);
      reset.addEventListener('click',async()=>{reset.disabled=true;try{await resetBinding(role);}catch(e){$('status').textContent=`解绑失败：${e.message}`;reset.disabled=false;}});footer.append(reset);}
    card.append(footer);return card;
  });
  $('roles').replaceChildren(...(cards.length?cards:[element('div','empty','暂无 Web 身份，连接后将自动显示')]));
}
document.addEventListener('DOMContentLoaded',()=>refresh().catch(e=>{$('status').textContent=`读取失败：${e.message}`;}));
$('save').addEventListener('click',async()=>{
  const endpoint=$('endpoint').value.trim(),token=$('token').value;
  if(!isEndpointAllowed(endpoint)){$('status').textContent='地址不支持，请使用配置的 WSS 域名或本机 Relay。';return;}
  if($('enabled').checked&&!token){$('status').textContent='请填写配对令牌。';return;}
  $('save').disabled=true;
  try{await chrome.storage.local.set({endpoint,token,enabled:$('enabled').checked,lastStatus:'Connecting…',lastStatusAt:Date.now()});
    await chrome.runtime.sendMessage({type:'DEVSPACE_RECONNECT'});await refresh();
  }catch(e){$('status').textContent=`连接失败：${e.message}`;}finally{$('save').disabled=false;}
});
$('refresh').addEventListener('click',async()=>{
  $('refresh').disabled=true;
  try{await chrome.runtime.sendMessage({type:'DEVSPACE_PUMP'});await refresh();}
  catch(e){$('status').textContent=`刷新失败：${e.message}`;}finally{$('refresh').disabled=false;}
});
chrome.storage.onChanged.addListener((_changes,area)=>{if(area==='local')refresh().catch(e=>{$('status').textContent=`读取失败：${e.message}`;});});
chrome.tabs.onUpdated.addListener(()=>refresh().catch(()=>{}));
chrome.tabs.onRemoved.addListener(()=>refresh().catch(()=>{}));
