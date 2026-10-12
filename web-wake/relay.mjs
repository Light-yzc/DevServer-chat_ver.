import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { WebSocketServer, WebSocket } from 'ws';
import { createTipsV2 } from '../vendor/devspace/dist/tips-core.js';
import { allowSocketOrigin, collectWakeEvents, createWakeToken, verifyWakeToken } from './relay-core.mjs';

// Mount directly onto the existing DevSpace HTTP server. The public WSS URL
// shares its HTTPS port and SSH tunnel with /mcp and /tips.
export function attachWakeRelay(server,{stateDir,path='/web-wake/ws',intervalMs=2000,requireExtensionOrigin=true}) {
  const config={stateDir};
  const tips=createTipsV2(config);
  // Read the live Web identity registry directly. No import from the in-progress
  // identity tool implementation and no write access to its lease or claim keys.
  function readClaimedRoles(){
    const file=join(stateDir,'tips','web-identities.json');
    if(!existsSync(file))return [];
    const registry=JSON.parse(readFileSync(file,'utf8'));
    return Object.values(registry.roles??{}).map(({id,status,leaseExpiresAt})=>({id,status,leaseExpiresAt}));
  }
  const sockets=new WebSocketServer({noServer:true,maxPayload:4096});
  const upgrade=(req,socket,head)=>{
    if(req.url!==path)return;
    if(requireExtensionOrigin&&!allowSocketOrigin(req.headers.origin)){
      socket.destroy();return;
    }
    try{sockets.handleUpgrade(req,socket,head,ws=>sockets.emit('connection',ws,req));}
    catch{socket.destroy();}
  };
  server.on('upgrade',upgrade);
  function emit(ws,payload){if(ws.readyState===WebSocket.OPEN) ws.send(JSON.stringify(payload));}
  const active=new Set();
  sockets.on('connection',ws=>{
    let authenticated=false;
    const deadline=setTimeout(()=>{if(!authenticated)ws.close(1008,'Authentication required');},5000);
    ws.on('message',data=>{
      let request;
      try {request=JSON.parse(String(data));}catch{ws.close(1003,'Bad JSON');return;}
      if(!authenticated){
        if(request?.type!=='auth'||!verifyWakeToken(stateDir,request.token)){
          ws.close(1008,'Invalid pairing token');return;
        }
        authenticated=true;clearTimeout(deadline);active.add(ws);
        emit(ws,{type:'ready',version:1});flush(ws);return;
      }
      if(request?.type==='ping')emit(ws,{type:'pong'});
    });
    ws.on('close',()=>{clearTimeout(deadline);active.delete(ws);});
    ws.on('error',()=>{clearTimeout(deadline);active.delete(ws);});
  });
  function flush(ws){
    try {
      const roles=readClaimedRoles();
      const events=collectWakeEvents({roles,messages:tips.messages({action:'list',limit:300})});
      const payload=JSON.stringify({type:'snapshot',roles:roles.filter(r=>r.status==='claimed'&&Date.parse(r.leaseExpiresAt)>Date.now()).map(r=>r.id),events});
      // Do not wake the MV3 service worker repeatedly for an unchanged inbox.
      if(ws.lastWakeSnapshot!==payload){ws.lastWakeSnapshot=payload;ws.send(payload);}
    } catch(err){emit(ws,{type:'error',message:'Tips state temporarily unavailable'});}
  }
  const refresh=setInterval(()=>{for(const ws of active)flush(ws);},intervalMs);
  refresh.unref();
  let stopped=false;
  const close=()=>new Promise(resolve=>{
    if(stopped){resolve();return;}
    stopped=true;clearInterval(refresh);server.off('upgrade',upgrade);
    for(const ws of sockets.clients)ws.terminate();
    sockets.close(()=>resolve());
  });
  server.once('close',()=>{void close();});
  return {sockets,close};
}

export function startWakeRelay({stateDir,host='127.0.0.1',port=17679,intervalMs=2000,requireExtensionOrigin=true}) {
  const server=createServer((req,res)=>{
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Content-Type-Options','nosniff');
    if(req.url==='/health' && req.method==='GET'){
      res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({ok:true,service:'web-wake'}));
    } else {res.writeHead(404);res.end();}
  });
  const relay=attachWakeRelay(server,{stateDir,path:'/ws',intervalMs,requireExtensionOrigin});
  server.listen(port,host);
  return {server,sockets:relay.sockets,close:async()=>{
    await relay.close();
    await new Promise((resolve,reject)=>server.close(err=>err?reject(err):resolve()));
  }};
}

function option(argv,key,fallback){const i=argv.indexOf(key);return i>=0?argv[i+1]:fallback;}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [mode,...argv]=process.argv.slice(2);
  const stateDir=resolve(option(argv,'--state-dir',process.env.TIPS_STATE_DIR??''));
  if(!option(argv,'--state-dir',process.env.TIPS_STATE_DIR)){
    process.stderr.write('Supply --state-dir /path/to/devspace/state or TIPS_STATE_DIR (same live instance as Tips).\n');process.exit(2);
  }
  if(mode==='token-init'){
    try {process.stdout.write(`Copy this PRIVATE token to the extension Options page once:\n${createWakeToken(stateDir)}\n`);}
    catch(e){process.stderr.write(`${e.message}\n`);process.exitCode=1;}
  } else if(mode==='serve') {
    const host=option(argv,'--host','127.0.0.1'),port=Number(option(argv,'--port','17679'));
    if(!Number.isInteger(port)||port<=0||port>65535)throw Error('Invalid port');
    startWakeRelay({stateDir,host,port});
    process.stdout.write(`Web wake relay listening on ${host}:${port} (Tips read-only)\n`);
  } else {process.stderr.write('Usage: node relay.mjs token-init|serve --state-dir /path --port 17679\n');process.exitCode=2;}
}
