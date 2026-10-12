#!/usr/bin/env bash
# Update only the globally installed CLI entrypoint, restart existing tmux DevSpace
# on 7676, verify the single-port WSS endpoint and roll back on a failed check.
set -euo pipefail

ROOT=/mnt/disk1/yangzhongcheng/devspace-tips-mcp
CONFIG=/mnt/disk1/yangzhongcheng/devspace-config
LIVE=/mnt/disk1/yangzhongcheng/tools/nvm/versions/node/v22.23.3/lib/node_modules/@waishnav/devspace/dist/cli.js
TMUX=/mnt/disk1/yangzhongcheng/tools/tmux/runtime/usr/bin/tmux
TMUX_SOCKET=/tmp/tmux-1029/default
NODE=/mnt/disk1/yangzhongcheng/tools/nvm/versions/node/v22.23.3/bin/node
PANE=dev:0.0
BACKUP_DIR="$CONFIG/backups"
mkdir -p "$BACKUP_DIR"
LOG="$CONFIG/web-wake-deployment.log"
exec >>"$LOG" 2>&1

echo "$(date -Is) Starting single-port Web Wake rollout"
if [[ ! -f "$CONFIG/serve-codex.sh" || ! -f "$LIVE" ]]; then
  echo 'Missing DevSpace launcher or global CLI';exit 1
fi
if ! grep -Fq 'DEVSPACE_WEB_WAKE_MODULE=' "$CONFIG/serve-codex.sh"; then
  echo 'Launcher missing opt-in integration';exit 1
fi
if ! "$TMUX" -S "$TMUX_SOCKET" has-session -t dev; then
  echo 'DevSpace tmux session missing';exit 1
fi
BACKUP="$BACKUP_DIR/cli.js.before-web-wake.$(date +%Y%m%dT%H%M%S)"
cp -p "$LIVE" "$BACKUP"
cp -p "$ROOT/vendor/devspace/dist/cli.js" "$LIVE"
"$NODE" --check "$LIVE"
echo "Global CLI updated, backup: $BACKUP"

restart_devspace() {
  "$TMUX" -S "$TMUX_SOCKET" send-keys -t "$PANE" C-c
  local ready=0
  for _ in {1..30}; do
    if [[ "$("$TMUX" -S "$TMUX_SOCKET" display-message -p -t "$PANE" '#{pane_current_command}')" == 'bash' ]] &&
      ! curl -fsS --max-time 1 http://127.0.0.1:7676/tips >/dev/null 2>&1; then ready=1;break;fi
    sleep 1
  done
  if [[ "$ready" != 1 ]]; then echo 'DevSpace did not return to the original tmux shell';return 1;fi
  "$TMUX" -S "$TMUX_SOCKET" send-keys -t "$PANE" "$CONFIG/serve-codex.sh" Enter
  for _ in {1..35}; do
    if curl -fsS --max-time 2 http://127.0.0.1:7676/tips >/dev/null 2>&1;then return 0;fi
    sleep 1
  done
  echo 'DevSpace HTTP never returned';return 1
}

rollback() {
  echo "$(date -Is) Rollback triggered"
  cp -p "$BACKUP" "$LIVE"
  # Disable the optional Web Wake integration for the original CLI, safely.
  if [[ -f "$CONFIG/serve-codex.sh" ]]; then
    sed -i '/^export DEVSPACE_WEB_WAKE_MODULE=/d' "$CONFIG/serve-codex.sh"
  fi
  restart_devspace || echo 'Manual intervention: check tmux dev:0.0'
}

check_public_upgrade() {
  # Unlike the Node `ws` probe, curl honors this machine's configured
  # HTTPS_PROXY. Require a real HTTP/1.1 101 upgrade from the public Caddy path.
  local headers
  headers="$(curl --http1.1 -sS -D - -o /dev/null --max-time 7 \
    -H 'Connection: Upgrade' \
    -H 'Upgrade: websocket' \
    -H 'Sec-WebSocket-Version: 13' \
    -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' \
    -H 'Origin: chrome-extension://abcdefghijklmnopabcdefghijklmnop' \
    https://regen.centralus.cloudapp.azure.com/web-wake/ws 2>/dev/null || true)"
  if grep -Eq '^HTTP/1\.1 101 ' <<< "$headers";then
    echo 'Public HTTPS Caddy Upgrade: HTTP/1.1 101 Switching Protocols';return 0
  fi
  echo "Public Upgrade failed: $(grep -E '^HTTP/' <<< "$headers" | tr '\n' ' ')";return 1
}

if ! restart_devspace ||
   ! "$NODE" "$ROOT/web-wake/probe.mjs" ws://127.0.0.1:7676/web-wake/ws ||
   ! check_public_upgrade; then
  rollback;exit 1
fi
echo "$(date -Is) PASS: DevSpace /tips and local/public single-port WebSocket OK"
