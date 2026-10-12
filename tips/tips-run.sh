#!/usr/bin/env bash
# Automatically publish job lifecycle to Tips. Usage: tips-run.sh task-id COMMAND args...
set -u
if [ "$#" -lt 2 ]; then
  echo 'Usage: TIPS_TITLE="My job" ./tips/tips-run.sh TASK_ID command [args...]' >&2
  exit 2
fi
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLI="$PROJECT_ROOT/tips/tips-cli.mjs"
NODE="${TIPS_NODE_BIN:-$(command -v node)}"
id="$1"
shift
"$NODE" "$CLI" update "$id" --title "${TIPS_TITLE:-$id}" --status running --progress 0 --message "Started: $*" >/dev/null || true
finish() {
  result=$?
  trap - EXIT
  if [ "$result" -eq 0 ]; then
    "$NODE" "$CLI" update "$id" --status completed --progress 100 --message 'Command exited successfully' >/dev/null || true
  else
    "$NODE" "$CLI" update "$id" --status failed --message "Command exited with code $result" >/dev/null || true
  fi
  exit "$result"
}
trap finish EXIT
"$@"
