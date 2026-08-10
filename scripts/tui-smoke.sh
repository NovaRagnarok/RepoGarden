#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HARNESS="$ROOT_DIR/scripts/tui-observe.sh"

cleanup() {
  "$HARNESS" stop >/dev/null 2>&1 || true
}

fail_capture() {
  local message="$1"
  local capture="$2"
  printf '%s\n' "$capture" >&2
  echo "tui-smoke: $message" >&2
  exit 1
}

command -v tmux >/dev/null 2>&1 || {
  echo "tui-smoke: missing required command: tmux" >&2
  exit 1
}

trap cleanup EXIT
cleanup

before_status="$(git -C "$ROOT_DIR" status --porcelain=v1 --untracked-files=no)"

for dimensions in "80 24" "100 32"; do
  read -r columns rows <<< "$dimensions"
  cleanup

  REPOGARDEN_OBSERVE_COLUMNS="$columns" \
  REPOGARDEN_OBSERVE_ROWS="$rows" \
  REPOGARDEN_OBSERVE_AUTO_CONFIGURE=0 \
  REPOGARDEN_OBSERVE_BOOT_WAIT_MS="${REPOGARDEN_OBSERVE_BOOT_WAIT_MS:-2500}" \
    "$HARNESS" start "$ROOT_DIR"

  configure_capture="$("$HARNESS" capture "ci-${columns}x${rows}-configure")"
  if ! printf '%s\n' "$configure_capture" | grep -Eq "FIRST RUN|choose where your repos live|give at least one folder path"; then
    fail_capture "${columns}x${rows} did not show the configure step" "$configure_capture"
  fi

  "$HARNESS" send text:~/repos/root Enter
  "$HARNESS" wait "${REPOGARDEN_OBSERVE_SCAN_WAIT_MS:-6000}" >/dev/null
  garden_capture="$("$HARNESS" capture "ci-${columns}x${rows}-garden-focus")"
  if ! printf '%s\n' "$garden_capture" | grep -Eq "(^|[^[:alnum:]_])root([^[:alnum:]_]|$)"; then
    fail_capture "${columns}x${rows} garden did not contain the scanned repo" "$garden_capture"
  fi
  if ! printf '%s\n' "$garden_capture" | grep -q "↵ resume"; then
    fail_capture "${columns}x${rows} garden did not expose the resume path" "$garden_capture"
  fi

  "$HARNESS" send Enter
  "$HARNESS" wait 500 >/dev/null
  cue_capture="$("$HARNESS" capture "ci-${columns}x${rows}-next-move")"
  if ! printf '%s\n' "$cue_capture" | grep -q "next move"; then
    fail_capture "${columns}x${rows} workbench did not show one next-move cue" "$cue_capture"
  fi
  if ! printf '%s\n' "$cue_capture" | grep -q "p copy path"; then
    fail_capture "${columns}x${rows} workbench did not show the direct handoff" "$cue_capture"
  fi

  "$HARNESS" send p
  "$HARNESS" wait 150 >/dev/null
  handoff_capture="$("$HARNESS" capture "ci-${columns}x${rows}-handoff")"
  if ! printf '%s\n' "$handoff_capture" | grep -q "path copied"; then
    fail_capture "${columns}x${rows} copy-path handoff did not confirm success" "$handoff_capture"
  fi
done

after_status="$(git -C "$ROOT_DIR" status --porcelain=v1 --untracked-files=no)"
if [[ "$after_status" != "$before_status" ]]; then
  echo "tui-smoke: scanned repository changed during resume smoke" >&2
  diff <(printf '%s\n' "$before_status") <(printf '%s\n' "$after_status") >&2 || true
  exit 1
fi

echo "tui-smoke: configure → focus → next move → handoff passed at 80x24 and 100x32"
