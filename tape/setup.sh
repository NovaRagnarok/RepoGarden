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

# Eight empty git repos. Demo mode renames them via the roster in
# src/lib/demo-roster.ts, so the visible names will be "pocket-cron",
# "moss-cms", "tidepool", etc. — not whatever we use here.
#
# We give the repos a deliberate spread of states so all four vibes
# from inferVibe (src/lib/vibe.ts) appear on screen:
#   awake  — dirty working tree (untracked scratch.md)
#   happy  — clean, recent commit
#   stuck  — clean + currentBlocker note in memory
#   sleepy — backdated commit older than SLEEPY_DAYS (14)
NAMES=(alpha beta gamma delta epsilon zeta eta theta)
# 0,1=awake  2,3=happy  4,5=stuck  6,7=sleepy
STATES=(awake awake happy happy stuck stuck sleepy sleepy)

# Memory dir mirrors src/lib/memory.ts: $HOME/.repogarden/projects/<id>.json
MEMORY_DIR="$DEMO_HOME/.repogarden/projects"
mkdir -p "$MEMORY_DIR"

# Repo id derivation matches src/lib/scanner.ts inspectRepo():
#   `${basename(repoPath)}-${base64url(repoPath).slice(-8)}`
repo_id() {
  local path="$1"
  local name
  name="$(basename "$path")"
  local b64
  b64="$(printf '%s' "$path" | base64 -w0 | tr '/+' '_-' | tr -d '=')"
  printf '%s-%s' "$name" "${b64: -8}"
}

for i in "${!NAMES[@]}"; do
  name="${NAMES[$i]}"
  state="${STATES[$i]}"
  repo="$DEMO_HOME/repos/$name"
  mkdir -p "$repo"
  git -C "$repo" -c init.defaultBranch=main init -q

  case "$state" in
    sleepy)
      # Backdate commit past SLEEPY_DAYS (14) — 30 days lands well inside.
      OLD_DATE="$(date -d '30 days ago' --iso-8601=seconds)"
      GIT_AUTHOR_DATE="$OLD_DATE" GIT_COMMITTER_DATE="$OLD_DATE" \
        git -C "$repo" \
          -c user.email=demo@repogarden.local -c user.name=demo \
          commit --allow-empty -q --date="$OLD_DATE" -m "seed"
      ;;
    *)
      git -C "$repo" \
        -c user.email=demo@repogarden.local -c user.name=demo \
        commit --allow-empty -q -m "seed"
      ;;
  esac

  case "$state" in
    awake)
      # Untracked scratch file → isDirty=true → awake.
      echo "wip" > "$repo/scratch.md"
      ;;
    stuck)
      # currentBlocker note → vibe.ts short-circuits to "stuck".
      id="$(repo_id "$repo")"
      cat > "$MEMORY_DIR/$id.json" <<JSON
{
  "currentBlocker": "waiting on review"
}
JSON
      ;;
  esac
done

# Seed the TUI config so the demo recording paginates and renders the
# garden with breathing room. `gardenPaginate: true` plus
# `gardenDensity: "comfortable"` together give creatures enough cell
# spacing that names sit cleanly under their bodies and sprites don't
# overlap each other on the canvas. "dense" + pagination still crams
# 16 sprites onto the page; "comfortable" is the sweet spot for 1200x720.
mkdir -p "$DEMO_HOME/.repogarden"
cat > "$DEMO_HOME/.repogarden/tui.json" <<EOF
{
  "themeId": "high-contrast",
  "scanRoots": [],
  "view": "garden",
  "reducedMotion": false,
  "usageBarDisabled": false,
  "observer": { "enabled": true },
  "gardenPaginate": true,
  "gardenDensity": "comfortable"
}
EOF

# Seed a synthetic journal so the Journal view in the recording shows
# real-looking activity instead of the empty-state copy. Demo creature
# ids are `demo:<name>` (see src/lib/demo-roster.ts buildDemoCreatures);
# events that target those ids will appear in the journal because the
# JournalView reads events.jsonl via readEvents (src/lib/events.ts).
NOW="$(date --iso-8601=seconds)"
H1="$(date -d '1 hour ago'  --iso-8601=seconds)"
H4="$(date -d '4 hours ago' --iso-8601=seconds)"
D1="$(date -d '1 day ago'   --iso-8601=seconds)"
D2="$(date -d '2 days ago'  --iso-8601=seconds)"
D5="$(date -d '5 days ago'  --iso-8601=seconds)"
cat > "$DEMO_HOME/.repogarden/events.jsonl" <<EOF
{"ts":"$NOW","repoId":"demo:driftlog","repoName":"driftlog","kind":"commit","payload":{"subject":"tighten the dither overlay paint mask","author":"demo"}}
{"ts":"$H1","repoId":"demo:moss-cms","repoName":"moss-cms","kind":"vibe-changed","payload":{"from":"stuck","to":"happy"}}
{"ts":"$H4","repoId":"demo:tidepool","repoName":"tidepool","kind":"note-edited","payload":{"title":"refresh live mobile data on focus"}}
{"ts":"$D1","repoId":"demo:pinecone-press","repoName":"pinecone-press","kind":"branch-switched","payload":{"from":"main","to":"feat/theme-lab"}}
{"ts":"$D1","repoId":"demo:nestwatch","repoName":"nestwatch","kind":"blocker-added","payload":{"text":"waiting on review"}}
{"ts":"$D2","repoId":"demo:lantern-rs","repoName":"lantern-rs","kind":"commit","payload":{"subject":"cache repo colors between paints","author":"demo"}}
{"ts":"$D2","repoId":"demo:reed-cli","repoName":"reed-cli","kind":"pull","payload":{"commits":3}}
{"ts":"$D5","repoId":"demo:salt-and-paper","repoName":"salt-and-paper","kind":"mood-changed","payload":{"from":"flowing","to":"resting"}}
EOF

# Stage a launcher inside the demo home so the tape can invoke RepoGarden
# without hardcoding the absolute repo path. The tape runs `~/launch`.
cat > "$DEMO_HOME/launch" <<EOF
#!/usr/bin/env bash
exec node "$REPO_ROOT/dist/cli.js" "\$@"
EOF
chmod +x "$DEMO_HOME/launch"

echo "demo env ready at $DEMO_HOME/repos (${#NAMES[@]} repos)"
