# Tips MCP Subagents (Codex App Server)

新 Agent 的完整工具参数和 Tips 生命周期示例见 [`AGENT_TOOL_USE.md`](AGENT_TOOL_USE.md)；工具自带的描述由 `vendor/devspace/dist/tips-tool-descriptions.js` 统一提供，Sub Agent 正常首轮仍只注入一次 `tips/subagent-protocol.mjs`。

The **`subagent`** MCP tool adds managed addressable Codex research workers without a new network port. `tips-subagent-manager.service` is a light background launcher. Up to 2 turns run concurrently by default; one Codex App Server instance is started per active turn and its thread is resumed across calls. The manager does not continuously consume model quota while idle.

## Web ChatGPT / DevSpace MCP

Start a Luna worker:

```
subagent(action="start", name="sub-air-review", goal="Read AGENTS.md and inspect current AIR CPU baseline tests without modifying frozen outputs.", cwd="/your/allowed/research-workspace", model="gpt-6-luna")
```

Inspect: `subagent(action="status", name="sub-air-review")`. Retrieve all: `subagent(action="list")`.
Use Codex's own configured third-party provider (not another Agent App):
`subagent(action="start", name="sub-grok-review", model="grok-4.7", provider="runanytime_grok", cwd="/mnt/disk1/yangzhongcheng", goal="An authorized, bounded CPU-only code review")`.
The `provider` is selected from user-level Codex `config.toml` and passed as an App Server config override. Default Luna/Sol launches remain unchanged. A missing provider/key or Chat Completions-only endpoint cannot serve Codex; actual Responses/Tool Calling must be validated separately before trusting results.
Read past evidence without waking any model: `subagent(action="jobs", name="sub-air-review")`, then `subagent(action="handoff", name="sub-air-review", jobId="EXACT-JOB-UUID")`; optional actions `result`, `diff`, `log`, `events`, `manifest`, `documentation`. The per-Job Git patch is a **shared workspace snapshot, not proven modifications by this Agent**. A self-reported passed test is not Main-verified. In the authenticated Tips dashboard, expand a Sub card → **执行证据** to view the same bounded excerpts.
Send a message while it works:

```
subagent(action="message", name="sub-air-review", from="controller", subject="Check experiment logs", body="Please audit CPU-only test failures and report a bounded fix.")
```

Stop one managed child only: `subagent(action="stop", name="sub-air-review")`.

Model `gpt-6-luna` is default. Opt-in `gpt-6.1-sol` only when the problem genuinely needs concentrated deep research; do not circumvent the two-Sol-reviews-per-topic policy. **Owner policy (2026-10-14): all managed Subagent Codex App Server turns use `danger-full-access`**. Old callers specifying `workspace-write` or `read-only` are normalized to full access. Previously registered, idle Subagents must first be migrated using `node tips/subagent-cli.mjs promote-full --confirm-all` with the Manager stopped and no queued/active jobs; existing thread IDs remain intact. Full filesystem access is **not** authority to bypass experiment pre-registration, frozen outputs, GPU gate, resource ownership or STOP constraints. Do not share untrusted Tips mail directly with full access agents.

## Server Main Agent CLI

```
node tips/subagent-cli.mjs start sub-air-review \
  --cwd /your/allowed/research-workspace \
  --goal-file /path/to/approved-task.txt
node tips/subagent-cli.mjs status sub-air-review
node tips/subagent-cli.mjs jobs sub-air-review
node tips/subagent-cli.mjs handoff sub-air-review --job EXACT-JOB-UUID
node tips/subagent-cli.mjs diff sub-air-review --job EXACT-JOB-UUID
node tips/subagent-cli.mjs message sub-air-review \
  --from server-controller --subject 'Need check' --body 'Review discrepancy'
```

## Message delivery and ACK

- Main/Sub both use the same persistent Tips message store. `to="sub-name"` targets a Sub's inbox; `from` identifies sender. The black dashboard can display all messages, and `tips_messages` can filter by recipient.
- If an App Server turn is running, its adapter polls trusted messages and attempts `turn/steer` with the active thread and turn ID. If steering is unavailable, the message remains **unread** and is delivered in a subsequent turn.
- An idle managed Sub with trusted unread messages will be queued for a new App Server turn using its original thread. Normal plain write-token-only HTTP messages do **not** cause an agent to execute.
- Delivering a message changes its state to `delivered`, **not** ACK. To ACK, the Sub must explicitly acknowledge it at the end of its turn with a `tips-actions` JSON footer; the adapter validates the received message IDs before applying receipts, resolving work or posting replies.
- Sub Agents can send a new research note to `controller`, `server-controller`, or other registered Sub Agent via `tips-actions.posts` without requiring private filesystem access. A normal `posts` action does *not* authorize a Sol wake request.
- An ACK means *the receiving agent says it has read the message*; it is not independent proof of correctness or task completion. Main can see replies and exact status via `tips_messages` and the Board.

**One-time protocol injection (managed App Server only):** The first actual Turn in a persistent Thread receives `tips/subagent-protocol.mjs`: inbox check, ACK after reading, reply when appropriate, and RESOLVE after work finishes. A persistent flag prevents resending it on resumes; new messages are delivered separately. The runner still monitors the inbox during active turns. If delivery succeeds but an ACK never arrives, the dispatcher attempts redelivery after 60 seconds, up to 3 delivered turns per message; after the cap, the message remains visible for manual follow-up. Older nonmanaged `codex exec` Owner processes are **not covered automatically** until safely migrated.

## Service and migration

`systemctl --user status tips-subagent-manager.service` or `journalctl --user -u tips-subagent-manager -f`.

New long-running Agent orchestration should use this App Server interface. Existing AIR `codex exec` owners stay as-is until a safe controlled transition; never terminate running GPU work merely to switch interfaces. The server fallback Sol is a separate legacy `codex exec` service until its own safe migration is verified.
