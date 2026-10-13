# DevSpace Web Wake — ordinary ChatGPT Web prototype

This is an **opt-in, experimental Chrome/Edge Manifest V3 extension** plus a **read-only WebSocket relay**, which can share DevSpace's original port. It wakes an open, manually named ChatGPT conversation by submitting **only an instruction to read its own Tips MCP mailbox**. This is **not** an official ChatGPT wake API and is **not** MCP server push to the model. It may fail after ChatGPT UI updates, may be constrained by browser background policies, and automated submissions may be subject to service terms or abuse limits. Do not rely on it for safety-critical execution.

## How addressing works

1. On DevSpace, use `web_identity(action="prepare", id="web-reviewer-01", label="Reviewer")` to create an invite.
2. In the intended ChatGPT conversation, use `web_identity(action="claim",id="web-reviewer-01",invite="...")`, and later verify with `whoami`. **The extension never receives the claim key**. If your ChatGPT MCP connection does not expose stable conversation metadata, keep your own `claimKey` in that ChatGPT conversation for follow-up identity calls.
3. Rename the **ChatGPT conversation** (sidebar menu → Rename) to exactly `web-reviewer-01`. The tab title must visibly equal that name (optionally with the standard ` - ChatGPT` suffix). Open one chat per role; **two matching tabs block delivery**.
4. A trusted server worker or another claimed chat sends a normal Tips message to `to="web-reviewer-01"`. This is a regular message, **not** `wake=true` (which is reserved for `server-controller`).
5. The relay reads the existing Tips state and claimed identity registry. It streams `{id,to}` only. The extension matches the title, pins the *conversation URL ID*, confirms the composer is empty and the assistant isn't visibly generating, and submits a short inbox-check instruction. The Web chat then calls `web_mail(inbox)`, checks that the messages belong to its identity, executes tasks within existing authorization, and ACKs the handled messages.

The browser's title match is **routing, not authentication**; the subsequent MCP tools must verify the Web identity. The relay never returns message contents. Local delivery (`submitted`) does **not** mark a Tips message read or complete; only MCP ACK/resolve does.

**Explicit three-state delivery:** The relay includes unread messages up to 30 days old while the target Web identity lease is still valid. The extension stores `pending` until the browser composer has **confirmed a successful submit**, then moves that message ID to durable `submitted` and **never submits that message again**, even if Web has not ACKed. Only an explicit MCP ACK ID from the relay advances it to `done`; absence from a later snapshot (role expiry, retention window, etc.) is not treated as ACK. Failed attempts before submission remain `pending` and can retry. Previous extension versions used `done` for submission: on upgrade, the old markers migrate to `submitted`, preventing accidental duplicate wake-ups or false ACKs. Web tasks without ACK are handled separately by the Local Sol handoff fallback policy, not by submitting another ChatGPT prompt. See [`../tips/WEB_HANDOFF.md`](../tips/WEB_HANDOFF.md).

## Server installation

### Preferred: single-port integration (no new SSH tunnel or Caddy route)

The checked-in `vendor/devspace/dist/cli.js` supports **opt-in** mounting on the
existing DevSpace HTTP server. Set this environment variable in the DevSpace
launcher and restart that server:

```bash
export DEVSPACE_WEB_WAKE_MODULE=/absolute/path/to/devspace-tips-mcp/web-wake/relay.mjs
devspace serve
```

This attaches the WebSocket Upgrade handler at `/web-wake/ws` to the existing
port (normally 7676). HTTP requests for `/mcp`, `/tips` and other original routes
continue through Express unchanged. The original HTTPS Caddy reverse proxy and
SSH tunnel work for WSS automatically when they forward every URL path.

If using a **separately installed global** DevSpace CLI, deploy the updated
`vendor/devspace/dist/cli.js` to that installation after saving a backup.
No second Relay process is necessary. Leave the existing paired token intact.

### Alternative: separate listener

From the repository root:

```bash
cd web-wake
npm install
npm test

# Use the SAME stateDir as the currently running DevSpace MCP; NOT a fresh demo stateDir.
export TIPS_STATE_DIR="$HOME/.local/share/devspace"
# For legacy installations without private security.json ONLY:
node relay.mjs token-init --state-dir "$TIPS_STATE_DIR"
# Unified installations should configure webWakeToken, not run token-init.
node relay.mjs serve --state-dir "$TIPS_STATE_DIR" --host 127.0.0.1 --port 17679
```

**Current / recommended:** Web Wake reads the plaintext `webWakeToken` from the private `security.json` in the DevSpace configuration directory. To set your own value, edit that JSON file with permission `0600`, or from the repository root:

```bash
read -rs WAKE_KEY; printf '%s' "$WAKE_KEY" | npm run web-wake:key; unset WAKE_KEY
```

Any **non-empty** string is accepted; no fixed minimum length or character rule is imposed. Then enter the exact same value in the extension's Options and click **保存并连接**. The Relay re-reads the key on each *new* socket authentication; previously authenticated sockets remain active until they disconnect. Reconnect the browser / restart the Relay if immediate revocation is needed. Short or predictable tokens are easier to guess.

**Legacy migration:** Older releases saved only a SHA-256 hash at `tips/web-wake-token.json`, which cannot be converted back to plaintext. If `security.json` does not yet have `webWakeToken`, the Relay still supports the old hashed token. Once `webWakeToken` is present, it becomes **authoritative** and old hashed tokens are rejected. `npm run security:unify` generates a new random `webWakeToken` for existing installations, so the browser must be paired once more. Keep the legacy hash file for rollback if necessary; do not commit it. In unified installations `token-init` is disabled to avoid writing another active credential location.

The Web Wake token is an independent Relay credential; **do not confuse it with the native DevSpace OAuth login, Tips write token, or Web administrator key**. The OAuth Token is never part of `security.json`.

### Reverse proxy (example — do not deploy without reviewing your existing Caddyfile)

Inside your existing site's `Caddyfile` block, add a more-specific route that preserves the original `/mcp` and `/tips` paths:

```caddyfile
handle_path /web-wake/* {
    reverse_proxy 127.0.0.1:17679
}
handle {
    reverse_proxy 127.0.0.1:7676
}
```

This exposes `wss://regen.centralus.cloudapp.azure.com/web-wake/ws`; Caddy terminates HTTPS and proxies WebSocket upgrades. The relay itself is **localhost only**. Restrict origins to Chrome/Edge extensions and require the secret handshake. An unauthenticated `/health` route exposes only `{ok:true}` on the localhost relay and is not a mailbox.

For localhost testing, use `ws://127.0.0.1:17679/ws` (the browser extension permits this). Never publish plain `ws://` on the Internet.

## Install in Edge / Chrome

1. Edge: visit `edge://extensions`, enable **Developer mode**, and choose **Load unpacked**; Chrome: `chrome://extensions` → Developer mode → Load unpacked.
2. Select the `web-wake/extension` folder from a **local copy** of this repository. Browser extensions can't load an unpacked directory directly from your remote Linux Git checkout; copy the folder to your computer first.
3. Open the extension Options, fill in the endpoint and the **private wake relay token**, then explicitly enable auto-wake and click **Save and connect**. By default the extension is disabled.
4. Keep the ChatGPT conversation tab open and renamed to the claimed role. When a new Tips message arrives it can submit a prompt if the chat is idle. Check extension status for connection and pending counts.

To change a role's conversation, first **reset its URL binding** in Options and then give the new chat the correct title. A URL pin prevents a second conversation from silently inheriting the old role. No code in this project navigates to a different ChatGPT conversation or manipulates browser tabs beyond reading metadata.

### Updating an existing unpacked installation

Update the files in the **same local folder** that Edge originally loaded, then
open `edge://extensions` and click **Reload** on DevSpace Web Wake. Refresh the
target ChatGPT tabs too, so they load the updated content script. Do not remove
and reinstall the extension: reloading the existing installation preserves its
pairing token, pending/submitted IDs, and URL bindings in `chrome.storage.local`.

Version 0.1.1 fixes `Send form not found`: an empty ChatGPT composer may show
Voice instead of Send. The extension now inserts the wake prompt first, waits
for Send within that composer, and confirms the composer cleared after clicking
before reporting submission. If Send never becomes available, it removes only
its unchanged, unsent draft so the pending wake can retry. If a click cannot be
confirmed, it preserves the draft and pending IDs for manual inspection.

Version 0.1.2 adds a compact status overview, individual identity cards, shortened
conversation IDs (hover for the full ID), per-identity unbind buttons, and
collapsible connection settings. Status and tab matches update automatically
without overwriting settings being edited. Local submitted counts are wake
records, not MCP acknowledgements.

Version 0.1.3 fixes narrow Edge action popups by setting an explicit 380px width
on both the document root and body, without a viewport-relative width limit.

Version 0.1.4 separates **pending → submitted → done (MCP ACK only)**. The
extension will not submit a second prompt for a submitted message, regardless
of whether the Web Agent has ACKed yet. The popup shows all three counts.

Version 0.1.5 updates the *content-script wake notification*: the targeted Web
Agent should inspect its own `web_mail(inbox)`, ACK processed messages, and
**proactively advance research** when warranted (coordinate an existing task,
start/steer an authorized Agent or send a follow-up message). It must check the
current Owner/STOP/GPU gates before dispatching new work. Only role names and
message IDs go into the browser prompt—never remote message bodies or secrets.

Version 0.1.6 shortens the browser-injected prompt to the user's exact compact
Chinese reminder: read via `web_mail(inbox)`, handle authorized work, ACK,
reply or advance research and dispatch Agents when needed. Message IDs and
the destination Web role are interpolated; no message body is included.

### Known issue / planned improvement (not implemented)

The v0.1.6 content script primarily uses the visible **Stop generating** button
to detect an active ChatGPT response. That indicator may temporarily disappear
during a thinking/tool-call/streaming transition, so the extension might submit
a new reminder while the Web Agent is **still working**. Do not assume that an
empty composer or missing Stop button reliably means a finished turn.

The planned fix is **conservative idle detection plus a stable quiet window**,
with another safety check immediately before clicking Send. The Web Main/Sub
research prompt should also perform **one bounded `web_mail(inbox)` check near
its natural end-of-turn**, acknowledging only actually handled messages. Then
the extension should avoid injecting notifications already ACKed by that Web
turn, while keeping unhandled messages pending. This is **not yet active**;
see [`TODO.md`](TODO.md) for implementation steps, browser-proxy inspection,
race-safety requirements and acceptance tests. In the meantime, unattended
browser injection remains best-effort and may interrupt ongoing work.

## Operational and security rules

- **Never put a Tips message body, shell command, invite or claim key into an automated prompt**. Only an ID and recipient identity are sent to the chat.
- Exact claimed Web identities only. No sending to `controller`, `server-controller`, arbitrary users, `sub-*` or unclaimed roles.
- Browser tabs must have a saved `/c/<conversation-UUID>` URL and a **unique, exact title match**. An empty composer and no visible generation are required. Existing drafts are never overwritten.
- WebSocket reconnects and background alarms retry **pending, never-submitted wake attempts** only. After successful submission that message ID remains `submitted`, does not trigger a duplicate browser prompt, and becomes `done` only on explicit Web ACK. The relay may notify about messages up to 30 days old, if their Web role lease remains valid.
- An unprocessed or ignored message stays in Tips until its recipient ACKs. The extension cannot verify model comprehension, tool availability or completion.
- Browser closed, computer asleep, browser policy restricting background execution, expired Web identity lease, and changes to ChatGPT's DOM can all prevent delivery. Browser extension service workers may be terminated and restarted; 30-second alarms and a WebSocket with 20-second ping provide best-effort recovery, **not guaranteed immediate delivery**.
- This is user-consented **UI automation**, not an officially supported model trigger. Review OpenAI's relevant Terms/Usage Policies and browser extension permissions before enabling it; account enforcement outcomes cannot be guaranteed.

## Tests and isolation

`npm test` checks token verification, role filtering, message freshness and WebSocket routing; `node --check extension/*.js` checks syntax. Actual Chrome/Edge → ChatGPT composer submission requires a **manual browser test on a live tab**. The saved HTML snapshot is a structural reference only; it is not a full React runtime.

This prototype lives under `web-wake/`, uses its own npm dependencies and port, does not install/start a service, and does **not** modify the running MCP, Caddy, existing research agents, or live state unless you explicitly run its `token-init`/`serve` commands.
