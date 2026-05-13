#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$ROOT_DIR"

export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  # Windows-side launch uses a non-interactive shell, so load nvm explicitly.
  . "$NVM_DIR/nvm.sh"
  nvm use --silent 24 >/dev/null 2>&1 || true
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required to launch RepoGarden." >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "node is required to launch RepoGarden." >&2
  exit 1
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 24 ]; then
  echo "RepoGarden requires Node 24+. Current node is $(node -v)." >&2
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "RepoGarden dependencies are missing. Run 'npm install' in $ROOT_DIR first." >&2
  exit 1
fi

exec npm run dev
