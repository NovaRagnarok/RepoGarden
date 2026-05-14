#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_ROOT="${TMPDIR:-/tmp}/repogarden-tui-observe"
CURRENT_FILE="$STATE_ROOT/current-session"
DEFAULT_COLS="${REPOGARDEN_OBSERVE_COLUMNS:-100}"
DEFAULT_ROWS="${REPOGARDEN_OBSERVE_ROWS:-32}"
DEFAULT_BOOT_WAIT_MS="${REPOGARDEN_OBSERVE_BOOT_WAIT_MS:-2000}"
DEFAULT_SCAN_WAIT_MS="${REPOGARDEN_OBSERVE_SCAN_WAIT_MS:-4000}"

usage() {
  cat <<'EOF'
Usage:
  scripts/tui-observe.sh start [root]
  scripts/tui-observe.sh send <keys...>
  scripts/tui-observe.sh wait <ms>
  scripts/tui-observe.sh capture [label]
  scripts/tui-observe.sh sample <count> <interval-ms> [label-prefix]
  scripts/tui-observe.sh flicker <count> <interval-ms> [label-prefix]
  scripts/tui-observe.sh stop

Examples:
  scripts/tui-observe.sh start
  scripts/tui-observe.sh sample 5 400 idle-garden
  scripts/tui-observe.sh flicker 8 150 idle-garden
  scripts/tui-observe.sh stop
EOF
}

fail() {
  echo "tui-observe: $*" >&2
  exit 1
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "missing required command: $1"
}

ensure_state_root() {
  mkdir -p "$STATE_ROOT"
}

current_session_dir() {
  [[ -f "$CURRENT_FILE" ]] || fail "no active session; run 'start' first"
  local dir
  dir="$(cat "$CURRENT_FILE")"
  [[ -n "$dir" && -d "$dir" ]] || fail "saved session directory is missing; run 'start' again"
  printf '%s\n' "$dir"
}

session_meta() {
  local session_dir="$1"
  local key="$2"
  local file="$session_dir/$key"
  [[ -f "$file" ]] || fail "missing session metadata: $key"
  cat "$file"
}

session_name() {
  session_meta "$1" "session-name"
}

capture_target() {
  printf '%s:0.0\n' "$(session_name "$1")"
}

current_capture() {
  local session_dir="$1"
  tmux capture-pane -p -t "$(capture_target "$session_dir")"
}

save_capture_artifact() {
  local session_dir="$1"
  local label="$2"
  local capture="$3"
  local captures_dir
  captures_dir="$(session_meta "$session_dir" "captures-dir")"
  local stamp
  stamp="$(date +%Y%m%d-%H%M%S)"
  local path="$captures_dir/${stamp}-${label}.txt"
  printf '%s\n' "$capture" > "$path"
  printf '%s\n' "$path"
}

tmux_has_session() {
  local name="$1"
  tmux has-session -t "$name" >/dev/null 2>&1
}

sleep_ms() {
  local ms="$1"
  [[ "$ms" =~ ^[0-9]+$ ]] || fail "wait requires an integer millisecond value"
  local seconds
  seconds="$(awk "BEGIN { printf \"%.3f\", $ms / 1000 }")"
  sleep "$seconds"
}

sanitize_label() {
  local raw="$1"
  local clean
  clean="$(printf '%s' "$raw" | tr -cs 'A-Za-z0-9._-' '-')"
  clean="${clean#-}"
  clean="${clean%-}"
  [[ -n "$clean" ]] || clean="capture"
  printf '%s\n' "$clean"
}

stop_session() {
  ensure_state_root
  if [[ ! -f "$CURRENT_FILE" ]]; then
    echo "no active session"
    return 0
  fi

  local session_dir
  session_dir="$(cat "$CURRENT_FILE")"
  if [[ -n "$session_dir" && -d "$session_dir" ]]; then
    local name=""
    if [[ -f "$session_dir/session-name" ]]; then
      name="$(cat "$session_dir/session-name")"
    fi
    if [[ -n "$name" ]] && tmux_has_session "$name"; then
      tmux kill-session -t "$name" >/dev/null 2>&1 || true
    fi
    rm -rf "$session_dir"
  fi
  rm -f "$CURRENT_FILE"
  echo "stopped"
}

start_session() {
  need_cmd tmux
  ensure_state_root

  if [[ -f "$CURRENT_FILE" ]]; then
    stop_session >/dev/null
  fi

  local root="${1:-$ROOT_DIR}"
  [[ -d "$root" ]] || fail "root does not exist: $root"
  root="$(cd "$root" && pwd)"

  local session_dir
  session_dir="$(mktemp -d "${STATE_ROOT}/session.XXXXXX")"
  local home_dir="$session_dir/home"
  local captures_dir="$session_dir/captures"
  local session="repogarden-observe-$(date +%s)-$$"
  mkdir -p "$home_dir" "$captures_dir"
  ln -s "$root" "$home_dir/repos"

  printf '%s\n' "$session" > "$session_dir/session-name"
  printf '%s\n' "$root" > "$session_dir/root"
  printf '%s\n' "$home_dir" > "$session_dir/home-dir"
  printf '%s\n' "$captures_dir" > "$session_dir/captures-dir"
  printf '%s\n' "$DEFAULT_COLS" > "$session_dir/columns"
  printf '%s\n' "$DEFAULT_ROWS" > "$session_dir/rows"
  printf '%s\n' "$session_dir" > "$CURRENT_FILE"

  tmux new-session -d -s "$session" -x "$DEFAULT_COLS" -y "$DEFAULT_ROWS" \
    "cd '$ROOT_DIR' && HOME='$home_dir' REPOGARDEN_DISABLE_USAGE=1 COLUMNS='$DEFAULT_COLS' LINES='$DEFAULT_ROWS' pnpm dev"

  sleep_ms "$DEFAULT_BOOT_WAIT_MS"
  tmux send-keys -t "$(capture_target "$session_dir")" Enter
  sleep_ms "$DEFAULT_SCAN_WAIT_MS"

  echo "session: $session"
  echo "root: $root"
  echo "home: $home_dir"
}

send_keys() {
  local session_dir
  session_dir="$(current_session_dir)"
  local target
  target="$(capture_target "$session_dir")"

  [[ "$#" -gt 0 ]] || fail "send requires at least one key"

  local key
  for key in "$@"; do
    case "$key" in
      Enter|enter)
        tmux send-keys -t "$target" Enter
        ;;
      Escape|escape|Esc|esc)
        tmux send-keys -t "$target" Escape
        ;;
      Up|up)
        tmux send-keys -t "$target" Up
        ;;
      Down|down)
        tmux send-keys -t "$target" Down
        ;;
      Left|left)
        tmux send-keys -t "$target" Left
        ;;
      Right|right)
        tmux send-keys -t "$target" Right
        ;;
      BSpace|Backspace|backspace)
        tmux send-keys -t "$target" BSpace
        ;;
      g|j|k|h|o|p|q|r|s|t|f|d|c|/|\?)
        tmux send-keys -t "$target" "$key"
        ;;
      *)
        fail "unsupported key: $key"
        ;;
    esac
  done
}

capture_screen() {
  local session_dir
  session_dir="$(current_session_dir)"
  local capture
  capture="$(current_capture "$session_dir")"

  if [[ "${1:-}" != "" ]]; then
    local label
    label="$(sanitize_label "$1")"
    local path
    path="$(save_capture_artifact "$session_dir" "$label" "$capture")"
    echo "saved: $path" >&2
  fi

  printf '%s\n' "$capture"
}

sample_screens() {
  [[ "$#" -ge 2 && "$#" -le 3 ]] || fail "sample requires <count> <interval-ms> [label-prefix]"

  local count="$1"
  local interval_ms="$2"
  local label_prefix="${3:-sample}"
  [[ "$count" =~ ^[0-9]+$ ]] || fail "sample count must be an integer"
  [[ "$count" -gt 0 ]] || fail "sample count must be greater than zero"
  [[ "$interval_ms" =~ ^[0-9]+$ ]] || fail "sample interval must be an integer millisecond value"

  local i
  for ((i = 1; i <= count; i += 1)); do
    capture_screen "${label_prefix}-${i}"
    if [[ "$i" -lt "$count" ]]; then
      printf '\n--- sample %d/%d complete; waiting %sms ---\n\n' "$i" "$count" "$interval_ms"
      sleep_ms "$interval_ms"
    fi
  done
}

analyze_flicker_samples() {
  [[ "$#" -ge 2 && "$#" -le 3 ]] || fail "flicker requires <count> <interval-ms> [label-prefix]"

  local count="$1"
  local interval_ms="$2"
  local label_prefix="${3:-flicker}"
  [[ "$count" =~ ^[0-9]+$ ]] || fail "flicker count must be an integer"
  [[ "$count" -gt 1 ]] || fail "flicker count must be greater than one"
  [[ "$interval_ms" =~ ^[0-9]+$ ]] || fail "flicker interval must be an integer millisecond value"

  local session_dir
  session_dir="$(current_session_dir)"
  local width
  width="$(session_meta "$session_dir" "columns")"
  local height
  height="$(session_meta "$session_dir" "rows")"

  local capture_paths=()
  local i
  for ((i = 1; i <= count; i += 1)); do
    local label
    label="$(sanitize_label "${label_prefix}-${i}")"
    local capture
    capture="$(current_capture "$session_dir")"
    local path
    path="$(save_capture_artifact "$session_dir" "$label" "$capture")"
    capture_paths+=("$path")
    printf 'captured %d/%d: %s\n' "$i" "$count" "$path"
    if [[ "$i" -lt "$count" ]]; then
      sleep_ms "$interval_ms"
    fi
  done

  printf '\n'
  (cd "$ROOT_DIR" && npx tsx src/tools/tui-flicker.ts --width "$width" --height "$height" "${capture_paths[@]}")
}

main() {
  local command="${1:-}"
  case "$command" in
    start)
      shift
      start_session "${1:-$ROOT_DIR}"
      ;;
    send)
      shift
      send_keys "$@"
      ;;
    wait)
      shift
      [[ "$#" -eq 1 ]] || fail "wait requires exactly one argument"
      sleep_ms "$1"
      ;;
    capture)
      shift
      [[ "$#" -le 1 ]] || fail "capture accepts at most one label"
      capture_screen "${1:-}"
      ;;
    sample)
      shift
      sample_screens "$@"
      ;;
    flicker)
      shift
      analyze_flicker_samples "$@"
      ;;
    stop)
      shift
      [[ "$#" -eq 0 ]] || fail "stop does not accept arguments"
      stop_session
      ;;
    ""|-h|--help|help)
      usage
      ;;
    *)
      fail "unknown command: $command"
      ;;
  esac
}

main "$@"
