#!/usr/bin/env bash
# Prepare an isolated, deterministic demo environment for vhs.
# Called from tape/demo.tape inside the recording's hidden prologue.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEMO_HOME="${1:-/tmp/repogarden-demo-home}"

rm -rf "$DEMO_HOME"
# Onboarding pre-fills the input with "~/repos" on first run (see cli.tsx
# seedPath fallback). Naming the dir "repos" lets the tape just press
# Enter — no typing, no backspacing to clear the prefilled value.
mkdir -p "$DEMO_HOME/repos"

# A handful of empty git repos. Demo mode renames them via the roster in
# src/lib/demo-roster.ts, so the visible names will be "pocket-cron",
# "moss-cms", "tidepool", etc. — not whatever we use here.
NAMES=(alpha beta gamma delta epsilon zeta eta theta)

for name in "${NAMES[@]}"; do
  repo="$DEMO_HOME/repos/$name"
  mkdir -p "$repo"
  git -C "$repo" -c init.defaultBranch=main init -q
  git -C "$repo" -c user.email=demo@repogarden.local -c user.name=demo \
    commit --allow-empty -q -m "seed"
done

# Seed the TUI config so the GIF shows the dense, no-pagination layout —
# every demo creature lands on a single screen instead of paging through.
# `gardenPaginate: false` + `gardenDensity: "dense"` are the two 0.5.0
# settings that drive this. Other defaults are left for the app to fill in.
mkdir -p "$DEMO_HOME/.repogarden"
cat > "$DEMO_HOME/.repogarden/tui.json" <<EOF
{
  "themeId": "high-contrast",
  "scanRoots": [],
  "view": "garden",
  "reducedMotion": false,
  "usageBarDisabled": false,
  "observer": { "enabled": true },
  "gardenPaginate": false,
  "gardenDensity": "dense"
}
EOF

# Stage a launcher inside the demo home so the tape can invoke RepoGarden
# without hardcoding the absolute repo path. The tape runs `~/launch`.
cat > "$DEMO_HOME/launch" <<EOF
#!/usr/bin/env bash
exec node "$REPO_ROOT/dist/cli.js" "\$@"
EOF
chmod +x "$DEMO_HOME/launch"

echo "demo env ready at $DEMO_HOME/repos (${#NAMES[@]} repos)"
