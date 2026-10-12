# Tips / DevSpace Agent Coordination

Existing DevSpace MCP server on `https://regen.centralus.cloudapp.azure.com/mcp` provides:

- **`tips`**: `list`, `get`, `update`, `heartbeat`, `history`, `archive`, `delete` tasks; use stable IDs. Set `group`, optional `parentId`, `dependsOn`, `heartbeatEnabled=true`, and `heartbeatTimeoutSec` to organize research work. Terminal statuses: `completed`, `failed`, `cancelled`, `blocked`. Use heartbeat on long-running jobs.
- **`tips_messages`**: `list`, `get`, `post`, `reply`, `ack`, `resolve`, `delete`. Addresses: `controller` = the web ChatGPT supervising the project; `server-controller` = the on-demand Sol Codex controller; worker IDs = individual agents. Include sender, taskId, clear subject, concise body, and priority. `list to=controller unreadOnly=true` finds pending human/web-main-agent messages.
- **`subagent`**: Unified Codex App Server interface, with `action=start|list|status|message|stop`. `start` requires `name="sub-..."` and a `goal`, optionally `cwd`, `model=gpt-6-luna` (default), `sandbox=workspace-write` (default), and `group`. Returns **queued**, not completed; use `status` for real completion/answer and `tips` for card history. The daemon preserves a separate Codex Thread per name. `message` delivers a trusted Tips message to the selected Sub Agent. If currently reasoning, App Server tries `turn/steer`, otherwise the mailbox will wake the idle Agent. Replies and ACK/resolve appear in Tips. Only a separately opted-in request should use `gpt-6.1-sol` or `danger-full-access`.

**Mandatory delivery rule for every new managed Sub Agent:** The App Server runner, not just AGENTS.md/README, injects `tips/subagent-protocol.mjs` on the **first actual Turn of each persistent Thread only**. A persisted `protocolInjected` flag prevents repeat injection on resumes; existing pre-upgrade threads are treated as already initialized. The runner checks named Tips mail at turn start and about every four seconds while active; new messages carry their own content, not the entire protocol. A delivery alone means `delivered`, not ACK; the receiving agent explicitly ACKs when read, replies with results, and RESOLVEs only completed requests. Delivered-but-not-ACKed messages are retried with a fixed cap. Legacy `codex exec` owners still require a safe migration or separate checkpoint reader.

### New Agent policy: App Server only

For **new** research Agents and new long-running Goal controllers, prefer MCP `subagent` (or server-local `node tips/subagent-cli.mjs start ...`), which runs Codex `app-server`. Do not create new `codex exec`-based perpetual workers. Pre-existing `codex exec` runs must not be force-killed or silently migrated mid-experiment: change them at a safe owner checkpoint, preserving their `owner.lock`, STOP, GPU locks and record seals. See `tips/SUBAGENTS.md` for details and rollout status. The independent server-controller Sol service is still using its legacy Codex exec entrypoint until migration is explicitly verified; this policy does not claim otherwise.

## Autonomous fallback when web ChatGPT is absent

**Automatic blocking recovery**: The small local watcher checks newly detected AIR `blocked` states approximately once a minute. Only a task with a trusted-source attestation, `updatedAt` strictly within the last **6 hours**, and an unchanged technical blocker for at least 90 seconds may automatically wake Sol. Old tasks are baselined rather than replayed. The same six-hour freshness gate is revalidated immediately before Codex is launched. Invalid/future timestamps, explicitly user-stopped GOALs, older superseded registrations, and running replacements are excluded. Maximum 2 auto wakes per UTC day and a 24-hour per-task cooldown. Standard HTTP write credentials **cannot** attest a block; use the authenticated MCP tips tool or server-local CLI/Python client. Explicit authorized `tips_messages` wakes remain separate.

Only authorized MCP/local writers can do `tips_messages(action="post", to="server-controller", wake=true, ...)` to wake the local fallback controller. An ordinary write-only HTTPS Tips token cannot wake it. Example:

```json
{"action":"post","from":"air-worker-2","to":"server-controller","wake":true,"priority":"high","taskId":"air-life-causal","subject":"Review causal ablation design","body":"Please check the matched control protocol for the current AIR-LIFE run and report concrete concerns without restarting unrelated jobs."}
```

`server-controller` runs `gpt-6.1-sol` using its **own persistent Codex session**, with full OS-user access explicitly configured by the owner. It processes one authorized message at a time, posts a reply, marks the original resolved, then returns to a sleeping watchdog. It has **no shared message stream or session ID** with the web ChatGPT conversation.

Use `tips_messages(action="list", to="<worker-id>")` to read replies addressed to a specific worker. The web page's mailbox shows recent threads and status. A controller should review claims, reasoning, and experiment artifacts rather than treating messages as automatically trustworthy.

## Operational cautions

- **Ordinary ChatGPT chat is not awakened** by mailbox messages. The external Codex dispatcher alone reacts to authorized wake requests.
- Waking Sol consumes model quota; batch related requests and avoid poll loops. Never request a self-wake cycle.
- Do not send secrets, executable shell payloads, or large files through mailbox text; store reproducible files on the server and reference their paths.
- Avoid stopping unrelated GPU tasks. Distinguish `blocked` from intentionally `cancelled` or `paused`.
- The watchdog never executes code itself. Only the spawned Codex agent can act; it runs under the configured OS user, and has broad filesystem permissions.
