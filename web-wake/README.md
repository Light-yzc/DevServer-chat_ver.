# DevSpace Web Wake — ordinary ChatGPT Web prototype

This is an **opt-in, experimental Chrome/Edge Manifest V3 extension** plus a **read-only, separately hosted WebSocket relay**. It wakes an open, manually named ChatGPT conversation by submitting **only an instruction to read its own Tips MCP mailbox**. This is **not** an official ChatGPT wake API and is **not** MCP server push to the model. It may fail after ChatGPT UI updates, may be constrained by browser background policies, and automated submissions may be subject to service terms or abuse limits. Do not rely on it for safety-critical execution.

## How addressing works

1. On DevSpace, use `web_identity(action="prepare", id="web-reviewer-01", label="Reviewer")` to create an invite.
2. In the intended ChatGPT conversation, use `web_identity(action="claim",id="web-reviewer-01",invite="...")`, and later verify with `whoami`. **The extension never receives the claim key**. If your ChatGPT MCP connection does not expose stable conversation metadata, keep your own `claimKey` in that ChatGPT conversation for follow-up identity calls.
3. Rename the **ChatGPT conversation** (sidebar menu → Rename) to exactly `web-reviewer-01`. The tab title must visibly equal that name (optionally with the standard ` - ChatGPT` suffix). Open one chat per role; **two matching tabs block delivery**.
4. A trusted server worker or another claimed chat sends a normal Tips message to `to="web-reviewer-01"`. This is a regular message, **not** `wake=true` (which is reserved for `server-controller`).
5. The relay reads the existing Tips state and claimed identity registry. It streams `{id,to}` only. The extension matches the title, pins the *conversation URL ID*, confirms the composer is empty and the assistant isn't visibly generating, and submits a short inbox-check instruction. The Web chat then calls `web_identity(whoami)` / `web_mail(inbox)` to inspect and ACK the real message.

The browser's title match is **routing, not authentication**; the subsequent MCP tools must verify the Web identity. The relay never returns message contents. Local delivery (`submitted`) does **not** mark a Tips message read or complete; only MCP ACK/resolve does.

## Install on the server (prototype, no live deployment yet)

From the repository root:

```bash
cd web-wake
npm install
npm test

# Use the SAME stateDir as the currently running DevSpace MCP; NOT a fresh demo stateDir.
export TIPS_STATE_DIR="$HOME/.local/share/devspace"
node relay.mjs token-init --state-dir "$TIPS_STATE_DIR"
# Save the displayed secret privately in the extension Options; don't paste into chats or Git.
node relay.mjs serve --state-dir "$TIPS_STATE_DIR" --host 127.0.0.1 --port 17679
```

`token-init` refuses to replace an existing token. The token is an independent read-only relay credential; **do not reuse the Tips write token, MCP OAuth token, or claim key**. It is stored hash-only as `tips/web-wake-token.json` in the real runtime state directory. Avoid running `token-init` during automated tests on production data.

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

## Operational and security rules

- **Never put a Tips message body, shell command, invite or claim key into an automated prompt**. Only an ID and recipient identity are sent to the chat.
- Exact claimed Web identities only. No sending to `controller`, `server-controller`, arbitrary users, `sub-*` or unclaimed roles.
- Browser tabs must have a saved `/c/<conversation-UUID>` URL and a **unique, exact title match**. An empty composer and no visible generation are required. Existing drafts are never overwritten.
- WebSocket reconnects and background alarms retry pending **local wake attempts**. After a prompt is submitted, that message ID is persisted as submitted and is not repeatedly spammed. Existing mailbox entries older than six hours are not woken automatically.
- An unprocessed or ignored message stays in Tips until its recipient ACKs. The extension cannot verify model comprehension, tool availability or completion.
- Browser closed, computer asleep, browser policy restricting background execution, expired Web identity lease, and changes to ChatGPT's DOM can all prevent delivery. Browser extension service workers may be terminated and restarted; 30-second alarms and a WebSocket with 20-second ping provide best-effort recovery, **not guaranteed immediate delivery**.
- This is user-consented **UI automation**, not an officially supported model trigger. Review OpenAI's relevant Terms/Usage Policies and browser extension permissions before enabling it; account enforcement outcomes cannot be guaranteed.

## Tests and isolation

`npm test` checks token verification, role filtering, message freshness and WebSocket routing; `node --check extension/*.js` checks syntax. Actual Chrome/Edge → ChatGPT composer submission requires a **manual browser test on a live tab**. The saved HTML snapshot is a structural reference only; it is not a full React runtime.

This prototype lives under `web-wake/`, uses its own npm dependencies and port, does not install/start a service, and does **not** modify the running MCP, Caddy, existing research agents, or live state unless you explicitly run its `token-init`/`serve` commands.
