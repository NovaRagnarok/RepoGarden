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

if ! command -v node >/dev/null 2>&1; then
  echo "node is required to launch RepoGarden." >&2
  exit 1
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 24 ]; then
  echo "RepoGarden requires Node 24+. Current node is $(node -v)." >&2
  exit 1
fi

# Provision pnpm via corepack if it isn't already on PATH. corepack ships
# with Node 16.10+, and the shim it installs reads `packageManager` from
# package.json, so this gives us the pinned pnpm version with no manual
# `corepack enable` step from the user.
if ! command -v pnpm >/dev/null 2>&1 && command -v corepack >/dev/null 2>&1; then
  corepack enable >/dev/null 2>&1 || true
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm is required to launch RepoGarden from source. Run 'corepack enable' once to provision the pinned version, then retry." >&2
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "RepoGarden dependencies are missing. Run 'pnpm install' in $ROOT_DIR first." >&2
  exit 1
fi

exec pnpm dev
