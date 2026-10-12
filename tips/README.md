# tips – DevSpace progress tracking

**vNext:** Black/graphite dashboard with grouping, dependency hints, heartbeat/staleness, persisted status history, per-project summaries, and a durable mailbox shared with web ChatGPT and an optional wake-on-message server Codex controller. See [MCP_INSTRUCTIONS.md](MCP_INSTRUCTIONS.md) and [SERVER_CONTROLLER.md](SERVER_CONTROLLER.md).

**Main mailbox troubleshooting:** See [`MAIN_MAIL_DIAGNOSTICS.md`](MAIN_MAIL_DIAGNOSTICS.md) before treating a message marked unread as a delivery failure. `tracked:true` requests verification; only an explicit authorized `wake:true` starts Local Sol. The Agents/Mail pages distinguish passive Main reports, authorized queued wakes, Web mail, and legacy `controller` messages.

**App Server Subagents:** MCP now exposes `subagent(action=start|list|status|message|stop)`, backed by the `tips-subagent-manager.service` user service, with separate persistent Codex threads and Tips mailbox + in-turn `turn/steer` support. The Board can filter messages by sender and recipient. New research agents should use App Server, while pre-existing `codex exec` workers must transition only at safe checkpoints. See [SUBAGENTS.md](SUBAGENTS.md).

### Automatic blockers (6-hour freshness gate)

The same lightweight server controller scans recent AIR `blocked` tasks every 60 seconds. Only a newly observed, actionable technical blocker, unchanged for 90 seconds and whose **actual Tips `updatedAt` is less than 6 hours old**, may enqueue an automatic Sol diagnosis. Invalid timestamps, future timestamps, explicit human stops, archived tasks, completed tasks, blocked task successors already running and prior blocked history are excluded. The controller **rechecks the 6-hour gate immediately before spawning Codex**, so a queued task expiring in the meantime is skipped. At most 2 such automatic requests per UTC day, with a 24-hour per-task cooldown and fingerprint deduplication. Manual authorized mailbox wake requests are unaffected. State is persisted in private `block-wake-state.json`; normal Tips task data stays untouched. Avoid mass reclassification or artificial `updatedAt` refreshes.

**Trusted-source gate:** Auto wake additionally requires a fresh `blockAttestation` automatically set by the authenticated MCP `tips` tool or by a local CLI/Python client with the separate private dispatch credential. A normal HTTP write-token-only update can still report `blocked` and display it, but cannot authorize automatic full-access Sol execution. Its update clears any prior attestation. Heartbeats never extend the six-hour clock.

## Controller service

`tips/server-controller.mjs` is an always-on lightweight watcher that **does not keep a model running**. An authorized `tips_messages` post addressed to `server-controller` with `wake=true` causes one Codex `gpt-6.1-sol` turn. It replies, resolves the message, and idles. It persists its own Codex thread ID under the private DevSpace state directory; never resumes the web controller's chat or unrelated agent sessions.

The user service template is `tips/tips-server-controller.service`. After installing it as `~/.config/systemd/user/tips-server-controller.service`, run `systemctl --user daemon-reload && systemctl --user enable --now tips-server-controller`. Logs: `journalctl --user -u tips-server-controller -f`. Disable: `systemctl --user disable --now tips-server-controller`.

Only a separate trusted dispatch credential (or authenticated MCP invocation) can authorize wake. A normal HTTPS API writer can post ordinary messages but **cannot** request full-permission Sol execution.

Optional ntfy alerts are configured with `node tips/tips-cli.mjs notify-set https://ntfy.sh/PRIVATE_TOPIC` (remove with `notify-clear`). No notifications are sent until configured.

CLI messages: `node tips/tips-cli.mjs message --from air-agent --to controller --subject 'Review' --body 'Please check the experiment'`. To wake Sol: add `--to server-controller --wake true` (use only one `--to`). Messages are visible in the black dashboard's **主控留言板** tab.

`tips` is a small progress dashboard mounted **inside existing DevSpace port 7676**. It needs no additional daemon, port, database, or Python dependency.

## Browser

Print your private viewer URL: `node tips/tips-cli.mjs url`.

The page at `https://regen.centralus.cloudapp.azure.com/tips` is read-only. The viewer secret is in the URL fragment (`#...`), which is not sent to the HTTP server; JavaScript sends it as a Bearer token to `/tips/api`. The UI refreshes every five seconds. Keep the private link to yourself.

## Card types

Each task ID is a separate dashboard card. `--kind` (or MCP `kind`) selects the display:

| Kind | Fields | Shows |
| --- | --- | --- |
| `progress` (default) | `progress` **or** `current`/`total`, `message` | Percentage bar, steps, description |
| `text` | `message`, optional multiline `details` | Freeform text / agent summary |
| `metric` | `value`, `unit`, `message` | Large numeric/text indicator, e.g. loss, NFE, GPU use |
| `checklist` | `items: [{"text":"...","done":true}]`, `message` | Checklist and auto-computed completion bar |
| `log` | `append`, `message` | Timestamped append-only log (keeps last 40 entries) |
| `table` | `columns: ["Method","Score"]`, `rows: [["AIR",82.3]]` | Sort-free compact result table, max 100 rows x 8 columns |
| `link` | `url: "https://..."` | Safe clickable HTTP(S) artifact / experiment report link |
| `chart` | `points: [0.9,0.7,0.5]`, `xLabel`, `yLabel` | Inline line chart for loss, reward, throughput, etc. |

Every card can use `title`, `status` (`pending`, `running`, `completed`, `failed`, `blocked`), `message` and `details`. Send another `update` with the same ID to change it. The last 100 events are retained in state; the UI displays the latest per-task information.

## CLI

```
node tips/tips-cli.mjs update air-accuracy --title 'AIR accuracy' --status running --progress 30 --message 'Experiment 3/10'
node tips/tips-cli.mjs update air-accuracy --kind progress --current 48 --total 164 --message 'PubMedQA: 48/164 samples'
node tips/tips-cli.mjs update air-notes --kind text --title 'Research notes' --message 'Comparing AIR with EB' --details 'Hypothesis: revisit remasking scheduling.'
node tips/tips-cli.mjs update gpu-usage --kind metric --title 'GPU 0 utilization' --value 82 --unit '%' --status running
node tips/tips-cli.mjs update paper-check --kind checklist --title 'Submission tasks' --items-json '[{"text":"Ablation","done":true},{"text":"Plot figures","done":false}]'
node tips/tips-cli.mjs update agent-log --kind log --title 'Agent messages' --append 'Started baseline comparison'
node tips/tips-cli.mjs update agent-log --append 'Collected 3 candidate variants'
node tips/tips-cli.mjs update scores --kind table --columns-json '["Method","Score"]' --rows-json '[["AIR",82.3],["EB",83.1]]'
node tips/tips-cli.mjs update paper-link --kind link --url 'https://example.com/experiment' --message 'External experiment results'
node tips/tips-cli.mjs update loss-curve --kind chart --points-json '[1.5,1.1,0.85,0.6]' --xLabel 'step' --yLabel 'loss'
echo '{"action":"update","id":"experiment","kind":"checklist","items":[{"text":"Phase 1","done":true},{"text":"Phase 2","done":false}]}' | node tips/tips-cli.mjs json
node tips/tips-cli.mjs update air-accuracy --status completed --message 'Finished all experiments'
node tips/tips-cli.mjs list
node tips/tips-cli.mjs get air-accuracy
node tips/tips-cli.mjs delete air-accuracy
```

Auto-update on process termination:

```
TIPS_TITLE='AIR experiment batch' bash tips/tips-run.sh air-batch python train.py
```

`tips-run.sh` marks the task `running` at start, then `completed` or `failed` when the foreground command exits. For agent runs, call `tips-cli.mjs update` at significant milestones and on completion.

Python jobs can update with the CLI without any Python dependency:

```python
import subprocess

def tips(*args):
    subprocess.run(["/mnt/disk1/yangzhongcheng/tools/nvm/versions/node/v22.23.3/bin/node",
                    "/mnt/disk1/yangzhongcheng/tips/tips-cli.mjs", "update", "my-job", *args], check=True)

tips("--title", "Training", "--kind", "progress", "--status", "running", "--current", "3", "--total", "20")
tips("--current", "20", "--total", "20", "--status", "completed")
```

The CLI sends authenticated HTTP requests to `http://127.0.0.1:7676/tips/api`. Any local script or Agent can call it. External scripts can POST JSON to `/tips/api` with the *write* Bearer token, but do not expose that token to browsers or other untrusted processes.

### Native Python client (including automatic job completion)

No `pip install` required. Import the library from `tips/tips_client.py`:

```python
from tips.tips_client import TipsClient

tips = TipsClient()  # server-local credential auto-discovery
with tips.track("air-exp", title="AIR evaluation", kind="progress", current=0, total=164):
    for i in range(164):
        # run_one_example(i)
        tips.update("air-exp", current=i+1, total=164, message=f"sample {i+1}/164")
```

The block automatically marks `completed` or `failed`. A long-lived agent can simply call `tips.update("agent-A", kind="log", append="Finished phase 2")` when milestones happen. Avoid reporting every GPU step if it would overwhelm the server; update periodically.

### From your laptop / another machine

`tips_client.py` can be copied to any other computer (pure Python standard library), or use `curl`. Set two **private** environment variables on the *client*:

```bash
export TIPS_API_URL='https://regen.centralus.cloudapp.azure.com/tips/api'
export TIPS_WRITE_TOKEN='<write token from server private credentials file>'

python3 tips_client.py update remote-agent '{"kind":"progress","status":"running","current":4,"total":10,"message":"GPU batch 4/10"}'
```

The secret is in `~/.local/share/devspace/tips/credentials.json` under the `writeToken` key **on the server**. Do **not** copy `viewToken` for writing; the two are intentionally separate. Never paste the write token in chat or commit it to Git; set it via a private secret store or protected env file.

Equivalent direct HTTPS API (same 7676 DevSpace port via the existing proxy):

```bash
curl -fsS "$TIPS_API_URL" \
  -H "Authorization: Bearer $TIPS_WRITE_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"action":"update","id":"agent-remote","title":"Remote Agent","kind":"metric","value":91.2,"unit":"%","status":"running"}'
```

## MCP

The `tips` tool supports `action=list|get|update|delete`, and all card fields above (including `kind`, `current`, `total`, `items`, `append`, `columns`, `rows`, `url`). Refresh the ChatGPT MCP plugin/tools after DevSpace restarts so the changed schema becomes discoverable.

## Auth and data

- All state is in `config.stateDir/tips/state.json`.
- Secrets are in `config.stateDir/tips/credentials.json` (private mode 0600).
- Anonymous visitors can load only the dashboard shell, not the API data.
- HTTP updates require a **different write-only API token**; CLI reads it locally. MCP accesses the tool only after existing DevSpace OAuth.
- Never publish the viewer URL or write token in public logs.
- This patch modifies the installed DevSpace `dist/server.js` and adds `dist/tips.js`; a future DevSpace reinstall/upgrade may overwrite the integration. `tips/` docs and helpers remain separate.
