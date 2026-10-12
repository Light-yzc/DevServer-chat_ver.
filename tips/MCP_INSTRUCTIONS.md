# Tips / DevSpace Agent Coordination

**新加入的 Agent 请先阅读 [`AGENT_TOOL_USE.md`](AGENT_TOOL_USE.md)**。该文档包含每种身份对应的工具、可复制的最小参数、ACK/验收状态含义以及常见错误。八个 Tips 协作 MCP 工具的 `description` 与核心 Zod 参数说明统一维护在 `vendor/devspace/dist/tips-tool-descriptions.js` 中，避免只写 README、模型实际读不到使用说明。新增只读 `tips_skills` 供 Web Agent **按需查阅** Skills；Local Agent 则读取 `$CODEX_HOME/skills/` 中对应 Skill。目录见 [`skills/README.md`](skills/README.md)。拥有私有管理员密钥才能执行 `tips_admin`，操作详见 [`TIPS_ADMIN.md`](TIPS_ADMIN.md)。

**四类协作角色模型分工**见 [`AGENT_ROLES_AND_MODELS.md`](AGENT_ROLES_AND_MODELS.md)：Web Main（总协调与高难度推理）、Web Sub（独立审查）、Local Main（Sol：关键且稳定的无人值守决策，消耗本地额度）、Local Sub（Luna：可持续一天的低成本长任务）。Main/Sub 是职责而非管理员权限。

选路规则：**研究进度 → `tips`；Server/Main/Sub 邮箱 → `tips_messages`；旧 Web 控制端向 Sub 提交验收请求 → `tips_exchange`；创建/检查长期 Codex Worker → `subagent`；Web Chat 首次认领/识别 → `web_identity`；已认领 Web Chat 发收消息 → `web_mail`。** `controller` 是历史 Web 收件箱，**不等于**认领身份 `web-main`。可信新消息发往 `server-controller` **默认请求唤醒 Sol**，仅 `wake:false` 明确关闭。

**连续性默认**：可信 Agent 给 `server-controller` 的**每条新消息**默认请求唤醒，明确 `wake:false` 才只存档。服务器尽可能在一个 Sol Turn 中合并多个排队消息。Sol 可以用 [`WEB_HANDOFF.md`](WEB_HANDOFF.md) 的 `tips/web-handoff.mjs` 主动请求 Web Main/Sub 复核；Web Wake 仅尝试提示匹配的**已打开**聊天。Web 45 分钟没 ACK、或 ACK 后 3 小时没验收，轻量 watcher 自动触发**一次** Sol 后备调度，不表示可以启动禁止的 GPU 实验。

**Local Main 同时是研究总调度者**：收到新可信消息即准备启动 Sol，且在同一 Turn 附带最多 12 条其他排队请求：核对当前 Owner、安排 Luna Local Sub、按需唤醒 Web 审查、下达指令并记录真实回执。`tracked:true` 只代表要 ACK+Verify，不改变默认唤醒。旧实验不能因为邮件而重跑；遗漏的请求仍保留待办。旧 `controller` 是历史 Web 邮箱。见 [`skills/main-batch-triage/SKILL.md`](skills/main-batch-triage/SKILL.md)。

**Main tracked 事务回执**：已授权启动并成功处理的 tracked 消息由 Local Main 守护器原子记入 `acknowledged` + `verified_accepted`；不符合自动阻塞门禁的任务为 `verified_rejected`，不等同于科学实验成功。无 tracked 的任务只记 ACK + `resolved`。内部私有动作 `finalize_controller` 只允许已领取的授权 Main 消息，由守护器调用，不应作为普通 MCP 调用或用于伪造回执。详见 [`MAIN_MAIL_DIAGNOSTICS.md`](MAIN_MAIL_DIAGNOSTICS.md)。

Existing DevSpace MCP server on `https://regen.centralus.cloudapp.azure.com/mcp` provides:

- **`tips_skills`**: `list` lists which Skill describes a needed subject; `read,name=agent-coordination|main-batch-triage|research-safety|tips-troubleshooting` returns a short SKILL.md on demand. No secrets, model execution or arbitrary file access.

- **`tips`**: `list`, `get`, `update`, `heartbeat`, `history`, `archive`, `delete` tasks; use stable IDs. Set `group`, optional `parentId`, `dependsOn`, `heartbeatEnabled=true`, and `heartbeatTimeoutSec` to organize research work. Terminal statuses: `completed`, `failed`, `cancelled`, `blocked`. Use heartbeat on long-running jobs.
- **`tips_messages`**: `list`, `get`, `post`, `reply`, `ack`, `resolve`, `delete`. Addresses: `controller` = the web ChatGPT supervising the project; `server-controller` = the on-demand Sol Codex controller; worker IDs = individual agents. Include sender, taskId, clear subject, concise body, and priority. `list to=controller unreadOnly=true` finds pending human/web-main-agent messages.
- **`web_identity`**: Each independent ChatGPT conversation may claim exactly one `web-*` role. A registered OAuth client prepares a role (`action=prepare,id=web-reviewer-01,label=Reviewer`) and privately gives the single-use invite to the new Chat. The new Chat uses `action=claim,id=...,invite=...` immediately, with **no main-Web approval**. Call `whoami` at the start of future chats/turns; automatic recognition uses stable `openai/session` metadata if provided by the MCP host, or else the private claimKey returned by claim. `list` excludes secrets; `renew` extends a seven-day lease; `release` frees the claimed role. Never place invite/claimKey in messages or audit logs.
- **Web revoke (`web_identity`)**: `action=revoke,id=web-old,viewToken=PRIVATE_TIPS_VIEW_TOKEN,reason="retired"` revokes any registered Web identity. The Tips view token is **also the full management credential**; there is no second admin password. Historical communication is retained.
- **`tips_admin`**: Management operations `history`, `revoke_web`, `remove_web`, `stop_sub`, `remove_sub`, `archive_task`, `delete_task`, `delete_message`. Each MCP call requires the private `viewToken`. An authenticated Tips page can manage immediately with its existing token, but still requires typing the target ID to confirm deletion. All actions are audited without storing the token. Main and legacy tmux are live processes, not unregisterable roles. See [`TIPS_ADMIN.md`](TIPS_ADMIN.md).
- **`web_mail`**: Identity-bound `send`, `inbox`, `sent`, `get`, `ack`, `reply`, `resolve`, `verify`. All sends use the authenticated claimed Web ID as `from`, never a client-supplied sender. Messages may address other `web-*` Chats, `sub-*` Agents, or the server controller. The destination Web Chat checks its own inbox when online; Tips cannot wake an inactive ChatGPT window. Using the regular `tips_messages` tool to impersonate a `web-*` role is forbidden.
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
