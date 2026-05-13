# Demo recording

The README's preview GIF is recorded from `tape/demo.tape` using [`vhs`](https://github.com/charmbracelet/vhs).

## Prerequisites

- `vhs` (v0.11+) — Charm's terminal recorder
- `ttyd` (>= 1.7.4) — pseudo-terminal that vhs drives
- `ffmpeg` — frame encoding

All three are user-local binaries — no system packages required. On Linux x86_64:

```bash
# vhs
curl -sL https://github.com/charmbracelet/vhs/releases/latest/download/vhs_0.11.0_Linux_x86_64.tar.gz \
  | tar xz -C /tmp && mv /tmp/vhs_*/vhs ~/.local/bin/

# ttyd
curl -sL -o ~/.local/bin/ttyd \
  https://github.com/tsl0922/ttyd/releases/latest/download/ttyd.x86_64
chmod +x ~/.local/bin/ttyd

# ffmpeg (static build)
curl -sL https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz \
  | tar xJ -C /tmp
mv /tmp/ffmpeg-*-amd64-static/ffmpeg ~/.local/bin/
```

On macOS: `brew install vhs ttyd ffmpeg`.

## Regenerate the GIF

From the repo root:

```bash
npm run build
vhs tape/demo.tape
```

The output lands at `docs/images/demo.gif`. `setup.sh` is invoked from inside the tape's hidden prologue — it seeds eight empty git repos under `/tmp/repogarden-demo-home/repos` and stages a launcher script, so the recording stays reproducible and never touches the real `~/.repogarden`.

## What the tape does

1. Runs `setup.sh` to build a clean demo environment.
2. Launches RepoGarden in demo mode (`REPOGARDEN_DEMO=1`) with `HOME` pointed at the temp dir.
3. Onboarding pre-fills `~/repos`; a single Enter starts the scan.
4. Boots into the garden, moves the cursor with `↓`, cycles `g` through Shelf and Journal, and ends on the garden so the loop restarts cleanly.

Names visible in the recording (`pocket-cron`, `moss-cms`, `tidepool`, …) come from the demo roster in `src/lib/demo-roster.ts`, not from the seeded repo directory names.
