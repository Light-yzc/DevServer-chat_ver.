/* DevSpace Web Wake. Only this service worker sees the private relay pairing token. */
const DEFAULT_URL = 'wss://regen.centralus.cloudapp.azure.com/web-wake/ws';
const WAKE_DELAY_MS = 60_000;
const ACK_RETRY_BASE_MS=20*60_000,ACK_RETRY_MAX_MS=2*60*60_000;
let socket=null,connectTimer=null,pinging=null,busy=false,lastAttempt={};
let serverRoles=[];
function nextAckRetryMs(attempts=1){return Math.min(ACK_RETRY_MAX_MS,ACK_RETRY_BASE_MS*Math.pow(2,Math.min(3,Math.max(0,attempts-1))));}

function normalizeTitle(title='') {
  return title.replace(/\s+(?:[-–—|]|·)\s+ChatGPT\s*$/i,'').trim();
}
function conversationId(url) {
  try {const u=new URL(url);return u.origin==='https://chatgpt.com' ? u.pathname.match(/^\/c\/([a-z0-9-]{36})\/?$/i)?.[1]??null : null;}
  catch{return null;}
}
function endpointAllowed(endpoint) {
  try {const u=new URL(endpoint);return (u.protocol==='wss:'&&u.hostname==='regen.centralus.cloudapp.azure.com'&&u.pathname==='/web-wake/ws') ||
    (u.protocol==='ws:'&&u.hostname==='127.0.0.1'&&u.pathname==='/ws');}catch{return false;}
}
async function report(text) {await chrome.storage.local.set({lastStatus:text,lastStatusAt:Date.now()});}

async function openSocket() {
  if(socket && [WebSocket.CONNECTING,WebSocket.OPEN].includes(socket.readyState))return;
  const {enabled=false,token='',endpoint=DEFAULT_URL}=await chrome.storage.local.get(['enabled','token','endpoint']);
  if(!enabled||!token||!endpointAllowed(endpoint))return;
  try {
    socket=new WebSocket(endpoint);
    socket.onopen=()=>{socket.send(JSON.stringify({type:'auth',token}));
      pinging=setInterval(()=>{if(socket?.readyState===WebSocket.OPEN)socket.send(JSON.stringify({type:'ping'}));},20_000);
    };
    socket.onmessage=async event=>{
      let payload;try{payload=JSON.parse(event.data);}catch{return;}
      if(payload.type==='ready')await report('Connected and authenticated');
      if(payload.type==='error')await report(payload.message??'Server state unavailable');
      if(payload.type==='snapshot')await absorbSnapshot(payload);
    };
    socket.onerror=()=>{report('WebSocket connection failed (check Caddy and relay)');};
    socket.onclose=event=>{if(event.code===1008)report('Authentication rejected: check wake relay pairing token.');
      socket=null;clearInterval(pinging);pinging=null;clearTimeout(connectTimer);
      connectTimer=setTimeout(openSocket,5000);
    };
  }catch(e){await report(`Socket error: ${e.message}`);}
}
function disconnect(){clearTimeout(connectTimer);clearInterval(pinging);pinging=null;
  if(socket){const old=socket;socket=null;old.onclose=null;old.close();}}

async function absorbSnapshot(payload) {
  if(!Array.isArray(payload.events)||!Array.isArray(payload.roles))return;
  serverRoles=payload.roles.filter(v=>/^web-[a-z0-9][a-z0-9_.-]{0,58}$/.test(v));
  const {done={},pending={},attempts={}}=await chrome.storage.local.get(['done','pending','attempts']);
  const present=new Set();
  for(const e of payload.events) {
    if(!e || typeof e.id!=='string'||!serverRoles.includes(e.to)||!/^[a-f\d-]{36}$/i.test(e.id))continue;
    present.add(e.id);
    // "done" means the UI submitted an inbox reminder, NOT a model ACK.
    // Retry unacknowledged messages after a bounded backoff even across
    // browser restarts. The relay snapshot is the source of truth for ACK.
    pending[e.id]={id:e.id,to:e.to};
  }
  // If MCP ACKed/resolved it, don't create a stale wake later.
  for(const id of Object.keys(pending))if(!present.has(id)){
    delete pending[id];delete done[id];delete attempts[id];
  }
  await chrome.storage.local.set({pending,serverRoles,done,attempts});
  await pump();
}

async function pump() {
  if(busy)return;busy=true;
  try {
    const {enabled=false,pending={},done={},attempts={},bindings={}}=await chrome.storage.local.get(['enabled','pending','done','attempts','bindings']);
    if(!enabled)return;
    const tabs=(await chrome.tabs.query({url:'https://chatgpt.com/*'})).filter(tab=>conversationId(tab.url));
    const roles=[...new Set(Object.values(pending).map(m=>m.to))].filter(r=>serverRoles.includes(r));
    for(const role of roles){
      if((Date.now()-(lastAttempt[role]??0))<15_000)continue;
      const targets=tabs.filter(tab=>normalizeTitle(tab.title)===role);
      if(targets.length!==1){if(targets.length>1)await report(`Duplicate tabs named ${role}. Wake blocked.`);continue;}
      const tab=targets[0],id=conversationId(tab.url);
      if(!id)continue;
      if(bindings[role]&&bindings[role]!==id){await report(`Role ${role} is pinned to a different conversation; reset its binding first.`);continue;}
      const now=Date.now();
      const ids=Object.values(pending).filter(m=>m.to===role&&
        (!done[m.id]||now-done[m.id]>=nextAckRetryMs(attempts[m.id]??1)))
        .map(m=>m.id).slice(0,30);
      if(!ids.length)continue;
      lastAttempt[role]=Date.now();
      let result;
      try {result=await chrome.tabs.sendMessage(tab.id,{type:'DEVSPACE_WAKE',role,ids});}
      catch {await report(`Chat ${role} content script not ready. Try reloading the tab.`);continue;}
      if(result?.status==='sent'){
        bindings[role]=id;
        for(const messageId of ids){done[messageId]=Date.now();attempts[messageId]=(attempts[messageId]??0)+1;}
        const ordered=Object.entries(done).sort((a,b)=>b[1]-a[1]).slice(0,500);
        await chrome.storage.local.set({done:Object.fromEntries(ordered),attempts,pending,bindings});
        lastAttempt[role]=Date.now()+WAKE_DELAY_MS-15_000;
        await report(`Wake submitted: ${role} (${ids.length} message(s)); will retry if no MCP ACK.`);
      } else if(result?.status==='busy'){
        await report(`Chat ${role} is generating or has a draft. Wake queued.`);
      } else {await report(`Chat ${role}: ${result?.reason??'composer not ready'}`);}
    }
  }finally{busy=false;}
}

chrome.runtime.onInstalled.addListener(async()=>{
  await chrome.alarms.create('web-wake-tick',{periodInMinutes:0.5});
  const settings=await chrome.storage.local.get('endpoint');
  if(!settings.endpoint)await chrome.storage.local.set({endpoint:DEFAULT_URL,enabled:false});
  await openSocket();
});
chrome.runtime.onStartup.addListener(()=>openSocket());
chrome.alarms.onAlarm.addListener(a=>{if(a.name==='web-wake-tick'){openSocket();pump();}});
chrome.tabs.onUpdated.addListener(()=>pump());
chrome.tabs.onRemoved.addListener(()=>pump());
chrome.runtime.onMessage.addListener((m,_sender,sendResponse)=>{
  if(m?.type==='DEVSPACE_RECONNECT'){
    disconnect();serverRoles=[];openSocket().then(()=>sendResponse({ok:true}));return true;
  }
  if(m?.type==='DEVSPACE_PUMP'){pump().then(()=>sendResponse({ok:true}));return true;}
});
openSocket();
