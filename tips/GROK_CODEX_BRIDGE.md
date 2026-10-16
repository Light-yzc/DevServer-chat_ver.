# Grok 4.7 with Codex App Server via local bridge

The server's Codex CLI 0.160.0 no longer accepts `wire_api = "chat"`. The
original `https://runanytime.hxi.me/v1/responses` returned HTTP 500 with
`convert_request_failed` / `not implemented`; Chat Completions worked.

This integration uses the maintained [MetaFARS codex-relay](https://github.com/MetaFARS/codex-relay)
binary (`codex-relay==0.5.8`, pinned in a separate virtualenv) to translate
Responses requests to RunAnytime Chat Completions. **No other agent app** is
involved: DevSpace continues to launch Codex App Server.

```
DevSpace subagent(model="grok-4.7",provider="runanytime_grok")
   -> Codex App Server (wire_api="responses")
   -> http://127.0.0.1:18741/v1/responses
   -> codex-relay
   -> https://runanytime.hxi.me/v1/chat/completions
```

The local bridge binds **127.0.0.1 only** and loads the already configured
`~/.config/runanytime/grok.key` (owner=current user, mode `0600`). It is never
put into code, logs or an argument list. This is localhost-only access,
**not a separate security boundary from other local users/processes**. Use
only on a trusted host. Shell launcher: `tips/grok-codex-relay-launch.sh`.

The provider rejected the full Codex 12-tool schema (`upstream_400`). The
relay drops the unsupported `reasoning_effort` and `stream_options` fields,
and forwards only the real Codex tools `exec_command` and `write_stdin`.
Grok successfully executed a read-only `pwd` through Codex App Server and
returned a `commandExecution` event. Advanced tools (nested agents, goal
board, image tools) remain unavailable to this Grok provider. Luna/Sol
continue using their original tool support.

```bash
systemctl --user status tips-grok-codex-relay.service
systemctl --user restart tips-grok-codex-relay.service
ss -ltn | grep 18741
```

The original `runanytime_grok` Provider section in `~/.codex/config.toml`
is preserved, except `base_url` is redirected to the local bridge and
`supports_websockets=false` forces the supported HTTP/SSE transport. An exact
timestamped backup of that file is saved outside the project before editing.
Default `ly_3090_proxy`, Luna and Sol are unchanged. To roll back, restore
the backed-up user Codex config and stop/disable this relay unit; nothing in
the project's research state or Subagent registry needs resetting.

**Verified live:** relay startup; Responses HTTP/SSE streaming; Codex App Server
real `turn/start`; Grok text reply; and an actual `commandExecution` tool call
round trip. For a repeatable isolated smoke test:

```bash
node /mnt/disk1/yangzhongcheng/devspace-tips-mcp/tips/grok-codex-smoke.mjs text
node /mnt/disk1/yangzhongcheng/devspace-tips-mcp/tips/grok-codex-smoke.mjs tool
```

Only these two tools have been validated with RunAnytime. A successful
process exit still does not imply scientific acceptance.

**Safety:** This does not turn on the currently stopped Subagent Manager,
Local Sol, or any experimental jobs. The user's STOP on all experiments,
GPU/Owner constraints and frozen artifacts remain binding. The bridge
exchanges API traffic only for commands explicitly sent to it.
