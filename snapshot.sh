#!/usr/bin/env bash
# Usage: SNAPSHOT=ready WIDTH=80 ./snapshot.sh
# Or: ./snapshot.sh boot 60
set -euo pipefail
cd "$(dirname "$0")"

screen="${1:-${SNAPSHOT:-ready}}"
width="${2:-${WIDTH:-80}}"
height="${3:-${HEIGHT:-30}}"
theme="${THEME:-high-contrast}"

export COLUMNS="$width"
export LINES="$height"
export REPOGARDEN_DISABLE_USAGE="${REPOGARDEN_DISABLE_USAGE:-1}"

# Use `script` to give Ink a fake PTY; pipe through cat to capture.
out=$(script -q -c "stty cols $width rows $height; SNAPSHOT=$screen THEME=$theme COLUMNS=$width LINES=$height npx tsx src/snapshot.tsx" /dev/null 2>&1 || true)
# Strip carriage returns and the trailing "Script started/done" markers.
strip_ansi=${STRIP_ANSI:-1}
if [[ "$strip_ansi" == "1" ]]; then
  echo "$out" | sed -E $'s/\x1b\\[[0-9;?]*[A-Za-z]//g; s/\x1b\\][^\x07]*\x07//g' | sed 's/\r$//' | grep -v -E "^(Script (started|done))"
else
  echo "$out" | sed 's/\r$//' | grep -v -E "^(Script (started|done))"
fi
