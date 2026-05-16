#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HARNESS="$ROOT_DIR/scripts/tui-observe.sh"

cleanup() {
  "$HARNESS" stop >/dev/null 2>&1 || true
}

command -v tmux >/dev/null 2>&1 || {
  echo "tui-smoke: missing required command: tmux" >&2
  exit 1
}

trap cleanup EXIT

cleanup

REPOGARDEN_OBSERVE_BOOT_WAIT_MS="${REPOGARDEN_OBSERVE_BOOT_WAIT_MS:-2500}" \
REPOGARDEN_OBSERVE_SCAN_WAIT_MS="${REPOGARDEN_OBSERVE_SCAN_WAIT_MS:-6000}" \
  "$HARNESS" start "$ROOT_DIR"

capture="$("$HARNESS" capture ci-smoke)"

if printf '%s\n' "$capture" | grep -Eq "FIRST RUN|choose where your repos live|give at least one folder path"; then
  printf '%s\n' "$capture" >&2
  echo "tui-smoke: app stayed in first-run onboarding instead of scanning ~/repos/root" >&2
  exit 1
fi

if ! printf '%s\n' "$capture" | grep -Eq "RepoGarden|REPOGARDEN|repogarden"; then
  printf '%s\n' "$capture" >&2
  echo "tui-smoke: captured TUI did not contain expected app text" >&2
  exit 1
fi

echo "tui-smoke: real TUI reached a post-onboarding screen"
