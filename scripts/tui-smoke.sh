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

capture_when_visible() {
  local pattern="$1"
  local label="$2"
  local attempts="${REPOGARDEN_OBSERVE_READY_ATTEMPTS:-40}"
  local interval_ms="${REPOGARDEN_OBSERVE_READY_INTERVAL_MS:-250}"
  local capture=""

  for ((attempt = 1; attempt <= attempts; attempt += 1)); do
    capture="$("$HARNESS" capture)"
    if printf '%s\n' "$capture" | grep -Eq "$pattern"; then
      "$HARNESS" capture "$label" >/dev/null
      printf '%s\n' "$capture"
      return 0
    fi
    if [[ "$attempt" -lt "$attempts" ]]; then
      "$HARNESS" wait "$interval_ms" >/dev/null
    fi
  done

  printf '%s\n' "$capture"
  return 1
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

  if ! configure_capture="$(capture_when_visible \
    "FIRST RUN|choose where your repos live|give at least one folder path" \
    "ci-${columns}x${rows}-configure")"; then
    fail_capture "${columns}x${rows} did not show the configure step" "$configure_capture"
  fi

  "$HARNESS" send text:~/repos/root Enter
  if ! garden_capture="$(capture_when_visible \
    "↵ resume" \
    "ci-${columns}x${rows}-garden-focus")"; then
    fail_capture "${columns}x${rows} garden did not expose the resume path" "$garden_capture"
  fi
  if ! printf '%s\n' "$garden_capture" | grep -Eq "(^|[^[:alnum:]_])root([^[:alnum:]_]|$)"; then
    fail_capture "${columns}x${rows} garden did not contain the scanned repo" "$garden_capture"
  fi

  "$HARNESS" send Enter
  if ! cue_capture="$(capture_when_visible \
    "next move" \
    "ci-${columns}x${rows}-next-move")"; then
    fail_capture "${columns}x${rows} workbench did not show one next-move cue" "$cue_capture"
  fi
  if ! printf '%s\n' "$cue_capture" | grep -q "p copy path"; then
    fail_capture "${columns}x${rows} workbench did not show the direct handoff" "$cue_capture"
  fi

  "$HARNESS" send p
  if ! handoff_capture="$(capture_when_visible \
    "path copied" \
    "ci-${columns}x${rows}-handoff")"; then
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
