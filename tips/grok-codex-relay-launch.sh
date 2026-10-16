#!/usr/bin/env bash
# Codex 0.160 only speaks Responses. Local bridge translates to the existing
# RunAnytime Chat Completions API. The secret NEVER appears in argv or Git.
set -euo pipefail
KEY_FILE="${HOME}/.config/runanytime/grok.key"
RELAY="/mnt/disk1/yangzhongcheng/tools/codex-relay-grok/bin/codex-relay"

[[ -f "$KEY_FILE" && ! -L "$KEY_FILE" ]] || { echo 'Grok credential file not available' >&2; exit 1; }
[[ "$(stat -c '%u' "$KEY_FILE")" == "$(id -u)" ]] || { echo 'Grok credential owner mismatch' >&2; exit 1; }
[[ "$(stat -c '%a' "$KEY_FILE")" == '600' ]] || { echo 'Grok credential must be chmod 600' >&2; exit 1; }
[[ -x "$RELAY" ]] || { echo 'codex-relay binary is missing' >&2; exit 1; }

# Read first line without echoing it. The relay inherits this only via env.
IFS= read -r CODEX_RELAY_API_KEY < "$KEY_FILE" || [[ -n "${CODEX_RELAY_API_KEY:-}" ]]
[[ -n "${CODEX_RELAY_API_KEY:-}" ]] || { echo 'Grok credential is empty' >&2; exit 1; }
export CODEX_RELAY_API_KEY
export CODEX_RELAY_BIND=127.0.0.1
export CODEX_RELAY_PORT=18741
export CODEX_RELAY_UPSTREAM=https://runanytime.hxi.me/v1
# Only exec_command/write_stdin passed the real Codex tool round-trip test.
# RunAnytime rejects the complete 12-tool schema with upstream_400.
export CODEX_RELAY_DROP_PARAMS='["reasoning_effort","stream_options"]'
export CODEX_RELAY_TOOL_DENYLIST='request_user_input,view_image,multi_agent_v1-close_agent,multi_agent_v1-resume_agent,multi_agent_v1-send_input,multi_agent_v1-spawn_agent,multi_agent_v1-wait_agent,get_goal,create_goal,update_goal'
# Do not record request/response corpora or tool arguments.
unset CODEX_RELAY_RECORD_CORPUS
export CODEX_RELAY_HISTORY_STORE=memory
export RUST_LOG=codex_relay=warn
exec "$RELAY"
