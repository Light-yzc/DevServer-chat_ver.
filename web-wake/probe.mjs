// Usage: node probe.mjs ws://127.0.0.1:7676/web-wake/ws
// or: node probe.mjs wss://regen.centralus.cloudapp.azure.com/web-wake/ws
// Tests WSS Upgrade without needing to reveal the private pairing token.
import WebSocket from 'ws';
const url=process.argv[2];
if(!url || !/^wss?:\/\//.test(url)){console.error('Expected ws:// or wss:// URL');process.exit(2)}
const ws=new WebSocket(url,{headers:{Origin:'chrome-extension://abcdefghijklmnopabcdefghijklmnop'},handshakeTimeout:5000});
const timeout=setTimeout(()=>{console.error('timeout');ws.terminate();process.exit(1)},8000);
ws.once('open',()=>{console.log('HTTP Upgrade: OK');ws.send(JSON.stringify({type:'auth',token:'deliberately-invalid-test-token'}));});
ws.once('unexpected-response',(_req,response)=>{console.error(`Handshake HTTP ${response.statusCode}`);ws.terminate();process.exitCode=1;});
ws.once('error',err=>{console.error('WebSocket error:',err.message);process.exitCode=1;});
ws.once('close',(code)=>{
  clearTimeout(timeout);
  if(code===1008){console.log('Authentication gate: OK (invalid token rejected with 1008)');}
  else{console.error(`Unexpected close code ${code}`);process.exitCode=1;}
});
