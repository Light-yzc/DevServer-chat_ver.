/* DevSpace Web Wake. Only this service worker sees the private relay pairing token. */
const DEFAULT_URL = 'wss://regen.centralus.cloudapp.azure.com/web-wake/ws';
const WAKE_DELAY_MS = 60_000;
let socket=null,connectTimer=null,pinging=null,busy=false,lastAttempt={};
let serverRoles=[];
let stateQueue=Promise.resolve();
const recoveryAt={};
function withState(fn){const result=stateQueue.then(fn);stateQueue=result.catch(()=>{});return result;}
function pendingIds(state,role){return Object.values(state.pending??{}).filter(m=>m.to===role&&!state.submitted?.[m.id]&&!state.done?.[m.id]).map(m=>m.id).slice(0,30);}
async function contentStatus(tab){
  if(tab.discarded || tab.status==='loading')return {status:'not_ready',reason:'Chat page is loading or sleeping; wake queued'};
  const version=chrome.runtime.getManifest().version;
  try{const state=await chrome.tabs.sendMessage(tab.id,{type:'DEVSPACE_STATUS'});if(state?.version===version)return state;}catch{}
  if(Date.now()-(recoveryAt[tab.id]??0)<60_000)return {status:'not_ready',reason:'Page script recovery pending; wake queued'};
  recoveryAt[tab.id]=Date.now();
  try{
    // Recover a missing/stale content context without navigating, reloading,
    // clearing drafts, or replaying a possibly submitted WAKE request.
    await chrome.scripting.executeScript({target:{tabId:tab.id},files:['content.js']});
    const state=await chrome.tabs.sendMessage(tab.id,{type:'DEVSPACE_STATUS'});
    if(state?.version===version)return state;
  }catch{}
  return {status:'not_ready',reason:'Page script recovery failed; check ChatGPT site access'};
}
async function restoreContentScripts(){
  const {enabled=false}=await chrome.storage.local.get(['enabled']);
  if(!enabled)return;
  const tabs=await chrome.tabs.query({url:'https://chatgpt.com/*'});
  for(const tab of tabs){
    if(conversationId(tab.url) && /^web-[a-z0-9][a-z0-9_.-]{0,58}$/.test(normalizeTitle(tab.title)))await contentStatus(tab);
  }
}
async function canSubmit(m,sender){
  if(sender.id!==chrome.runtime.id || sender.frameId!==0 || !sender.tab?.id ||
     !/^web-[a-z0-9][a-z0-9_.-]{0,58}$/.test(m.role) || !Array.isArray(m.ids) || !m.ids.length || m.ids.length>30)return {ok:false};
  return withState(async()=>{
    const state=await chrome.storage.local.get(['enabled','pending','submitted','done','bindings']);
    const tab=await chrome.tabs.get(sender.tab.id),id=conversationId(tab.url);
    const tabs=await chrome.tabs.query({url:'https://chatgpt.com/*'});
    const targets=tabs.filter(t=>conversationId(t.url)&&normalizeTitle(t.title)===m.role);
    const allowed=new Set(pendingIds(state,m.role));
    return {ok:!!(state.enabled && serverRoles.includes(m.role) && id && normalizeTitle(tab.title)===m.role &&
      targets.length===1 && targets[0].id===tab.id && (!state.bindings?.[m.role]||state.bindings[m.role]===id) && m.ids.every(id=>allowed.has(id)))};
  });
}

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
  await withState(async()=>{
  serverRoles=payload.roles.filter(v=>/^web-[a-z0-9][a-z0-9_.-]{0,58}$/.test(v));
  const state=await chrome.storage.local.get(['done','pending','submitted','attempts','submissionStateVersion']);
  const pending=state.pending??{},submitted=state.submitted??{};
  let done=state.done??{};
  if(state.submissionStateVersion!==2){
    // Before v2, `done` was written when the browser submitted a prompt,
    // NOT when Web ACKed. Treat every legacy done marker as submitted so
    // upgrades neither falsely claim completion nor re-submit the reminder.
    for(const [id,at] of Object.entries(done))submitted[id]??=at;
    done={};
  }
  // Older versions retained submitted IDs in `pending` for timed retries.
  // Correct their displayed state as well as preventing resubmission.
  for(const id of Object.keys(submitted))delete pending[id];
  // Only explicit server-side MCP acknowledgement can advance to done.
  for(const item of Array.isArray(payload.acked)?payload.acked:[]){
    if(!item||typeof item.id!=='string'||!serverRoles.includes(item.to)||
       !/^[a-f\d-]{36}$/i.test(item.id))continue;
    done[item.id]=Date.now();delete pending[item.id];delete submitted[item.id];
  }
  const present=new Set();
  for(const e of payload.events) {
    if(!e || typeof e.id!=='string'||!serverRoles.includes(e.to)||!/^[a-f\d-]{36}$/i.test(e.id))continue;
    present.add(e.id);
    if(!submitted[e.id]&&!done[e.id])pending[e.id]={id:e.id,to:e.to};
    else delete pending[e.id];
  }
  // A message can disappear due to retention or role changes, not just ACK;
  // never turn disappearance into `done`. Submitted records remain durable.
  for(const id of Object.keys(pending))if(!present.has(id))delete pending[id];
  await chrome.storage.local.set({pending,submitted,done,serverRoles,submissionStateVersion:2});
  });
  await pump();
}

async function pump() {
  if(busy)return;busy=true;
  try {
    const initial=await chrome.storage.local.get(['enabled','pending']);
    if(!initial.enabled)return;
    const tabs=(await chrome.tabs.query({url:'https://chatgpt.com/*'})).filter(tab=>conversationId(tab.url));
    const roles=[...new Set(Object.values(initial.pending??{}).map(m=>m.to))].filter(r=>serverRoles.includes(r));
    for(const role of roles){
      if((Date.now()-(lastAttempt[role]??0))<15_000)continue;
      const targets=tabs.filter(tab=>normalizeTitle(tab.title)===role);
      if(targets.length!==1){if(targets.length>1)await report(`Duplicate tabs named ${role}. Wake blocked.`);continue;}
      const tab=targets[0],id=conversationId(tab.url);
      lastAttempt[role]=Date.now();
      const readiness=await contentStatus(tab);
      if(readiness.status!=='idle'){
        await report(readiness.status==='busy'?`Chat ${role} is processing or waiting for stable idle. Wake queued.`:`Chat ${role}: ${readiness.reason??'composer not ready'}`);
        continue;
      }
      // Probing/recovery takes time. Re-read ACKs and new messages rather than
      // dispatching the stale batch from the start of this pump.
      const state=await withState(()=>chrome.storage.local.get(['enabled','pending','submitted','done','bindings']));
      if(!state.enabled || !serverRoles.includes(role))continue;
      if(state.bindings?.[role]&&state.bindings[role]!==id){await report(`Role ${role} is pinned to a different conversation; reset its binding first.`);continue;}
      const ids=pendingIds(state,role);
      if(!ids.length)continue;
      let result;
      try {result=await chrome.tabs.sendMessage(tab.id,{type:'DEVSPACE_WAKE',role,ids});}
      catch {await report(`Chat ${role}: Submission connection interrupted; wake remains queued.`);continue;}
      if(result?.status==='sent'){
        const sentIds=Array.isArray(result.ids)?ids.filter(id=>result.ids.includes(id)):ids;
        if(!sentIds.length)continue;
        await withState(async()=>{
          const {submitted={},pending={},done={},bindings={}}=await chrome.storage.local.get(['submitted','pending','done','bindings']);
          bindings[role]=id;
          for(const messageId of sentIds){if(!done[messageId])submitted[messageId]=Date.now();delete pending[messageId];}
          await chrome.storage.local.set({submitted,pending,bindings});
        });
        lastAttempt[role]=Date.now()+WAKE_DELAY_MS-15_000;
        await report(`Wake submitted: ${role} (${sentIds.length} message(s)); awaiting MCP ACK, no duplicate submission.`);
      } else if(result?.status==='busy'){
        await report(`Chat ${role} is processing or waiting for stable idle. Wake queued.`);
      } else {await report(`Chat ${role}: ${result?.reason??'composer not ready'}`);}
    }
  }finally{busy=false;}
}

chrome.runtime.onInstalled.addListener(async()=>{
  await chrome.alarms.create('web-wake-tick',{periodInMinutes:0.5});
  const settings=await chrome.storage.local.get('endpoint');
  if(!settings.endpoint)await chrome.storage.local.set({endpoint:DEFAULT_URL,enabled:false});
  await restoreContentScripts();
  await openSocket();
});
chrome.runtime.onStartup.addListener(()=>openSocket());
chrome.alarms.onAlarm.addListener(a=>{if(a.name==='web-wake-tick'){openSocket();pump();}});
chrome.tabs.onUpdated.addListener(()=>pump());
chrome.tabs.onRemoved.addListener(()=>pump());
chrome.runtime.onMessage.addListener((m,sender,sendResponse)=>{
  if(m?.type==='DEVSPACE_WAKE_CHECK'){
    canSubmit(m,sender).then(sendResponse).catch(()=>sendResponse({ok:false}));return true;
  }
  if(m?.type==='DEVSPACE_RECONNECT'){
    disconnect();serverRoles=[];openSocket().then(()=>sendResponse({ok:true}));return true;
  }
  if(m?.type==='DEVSPACE_PUMP'){pump().then(()=>sendResponse({ok:true}));return true;}
});
openSocket();
