#!/usr/bin/env node
// CLI companion to DevSpace's /tips page and MCP tips tool.
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { loadConfig } from "../vendor/devspace/dist/config.js";
import { createTips } from "../vendor/devspace/dist/tips.js";

process.env.DEVSPACE_CONFIG_DIR ??= resolve(dirname(fileURLToPath(import.meta.url)), "../var/config");
const config = loadConfig();
const tips = createTips(config);
const [command = "list", id, ...options] = process.argv.slice(2);
function usage() {
    console.log(`Usage:
  node tips/tips-cli.mjs url
  node tips/tips-cli.mjs list
  node tips/tips-cli.mjs get TASK_ID
  node tips/tips-cli.mjs delete TASK_ID
  node tips/tips-cli.mjs heartbeat TASK_ID
  node tips/tips-cli.mjs history TASK_ID
  node tips/tips-cli.mjs archive TASK_ID
  node tips/tips-cli.mjs message --from worker-name --to server-controller --subject 'Need review' --body 'Check AIR results' --priority high --wake true
  node tips/tips-cli.mjs messages
  node tips/tips-cli.mjs ack MESSAGE_ID
  node tips/tips-cli.mjs resolve MESSAGE_ID
  node tips/tips-cli.mjs notify-set https://ntfy.sh/YOUR_PRIVATE_TOPIC
  node tips/tips-cli.mjs notify-status | notify-clear
  node tips/tips-cli.mjs update TASK_ID --title TEXT --kind progress|text|metric|checklist|log|table|link|chart --status running|completed|failed|blocked|pending --progress 0..100 --message TEXT
    [--details TEXT] [--current NUMBER --total NUMBER] [--value NUMBER_OR_TEXT --unit TEXT]
    [--items-json '[{"text":"step","done":true}]'] [--append LOG_LINE]
    [--columns-json '["Method","Score"]' --rows-json '[["AIR",80.2]]'] [--url https://example.com]
    [--points-json '[1,0.9,0.72]' --xLabel step --yLabel loss]
  echo '{"action":"update","id":"check","kind":"checklist","items":[{"text":"first","done":true}]}' | node tips/tips-cli.mjs json
  echo '{"action":"post","from":"worker-A","to":"controller","subject":"Result","body":"Please review"}' | node tips/tips-cli.mjs message-json

  TIPS_TITLE="Experiment" ./tips/tips-run.sh TASK_ID command args...
`);
}
if (["help", "-h", "--help"].includes(command)) { usage(); process.exit(0); }
if (command === "url") {
    console.log(`${config.publicBaseUrl.replace(/\/+$/, "")}/tips#${tips.credentials.viewToken}`);
    process.exit(0);
}
const confFile = `${tips.dir}/notifications.json`;
if (command === 'notify-status') {
    console.log(existsSync(confFile) ? JSON.stringify(JSON.parse(readFileSync(confFile,'utf8')),null,2) : 'Notifications are disabled');
    process.exit(0);
}
if (command === 'notify-clear') { rmSync(confFile,{force:true});console.log('Notifications disabled');process.exit(0); }
if (command === 'notify-set') {
    if (!id) throw Error('HTTPS ntfy topic URL is required');
    const target = new URL(id);
    if(target.protocol!=='https:' && !(target.protocol==='http:'&&['localhost','127.0.0.1'].includes(target.hostname)))throw Error('Use an HTTPS URL');
    writeFileSync(confFile, JSON.stringify({url:target.href,messages:true},null,2)+'\n',{mode:0o600});
    console.log('Notifications configured. Status transitions and high-priority messages will send an HTTP POST.');
    process.exit(0);
}
if (!["list", "get", "update", "delete", "json", "message", "messages", "message-json", "heartbeat", "history", "archive", "ack", "resolve"].includes(command)) { usage(); process.exit(2); }
const isMessage=['message','messages','message-json','ack','resolve'].includes(command);
let data = { action:command==='message'?'post':command==='messages'?'list':command==='message-json'?'post':command, id };
if (command === "update" || command === "message") {
    const opts=command==='message'?[id,...options].filter(x=>x!==undefined):options;
    if(command==='message')delete data.id;
    for (let i = 0; i < opts.length; i += 2) {
        const key = opts[i]?.replace(/^--/, "");
        if (!opts[i]?.startsWith("--") || !["title", "kind", "status", "progress", "message", "details", "group", "parentId", "dependsOn-json", "archived", "heartbeatEnabled", "heartbeatTimeoutSec", "heartbeat", "current", "total", "value", "unit", "items-json", "append", "columns-json", "rows-json", "url", "points-json", "xLabel", "yLabel", "from", "to", "subject", "body", "priority", "taskId", "inReplyTo", "wake"].includes(key) || opts[i + 1] === undefined) {
            throw Error(`Invalid flag: ${opts[i]}`);
        }
        const value = opts[i + 1];
        if (["items-json", "columns-json", "rows-json", "points-json", "dependsOn-json"].includes(key)) data[key.replace("-json", "")] = JSON.parse(value);
        else if (["progress", "current", "total", "heartbeatTimeoutSec"].includes(key)) data[key] = Number(value);
        else if (["heartbeatEnabled", "archived", "heartbeat", "wake"].includes(key)) data[key] = value==='true';
        else if (key === "value") data[key] = value.trim() && Number.isFinite(Number(value)) ? Number(value) : value;
        else data[key] = value;
    }
}
if (command === "json" || command === "message-json") {
    let raw = "";
    for await (const chunk of process.stdin) {
        raw += chunk;
        if (raw.length > 60_000) throw Error("JSON input too large");
    }
    data = JSON.parse(raw);
}
const url = `http://${config.host}:${config.port}${isMessage?'/tips/messages':'/tips/api'}`;
const response = await fetch(url, {
    method: "POST",
    headers: { "Authorization": `Bearer ${tips.credentials.writeToken}`, "Content-Type": "application/json", ...(tips.credentials.dispatchToken?{"X-Tips-Dispatch":tips.credentials.dispatchToken}:{}) },
    body: JSON.stringify(data),
    signal: AbortSignal.timeout(10000),
});
const body = await response.json();
if (!response.ok) { console.error(body); process.exit(1); }
console.log(JSON.stringify(body, null, 2));
