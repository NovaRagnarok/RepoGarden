# Backlog

## Current direction

### Immediate target

Polish the daily-use loop: scanning, garden/shelf/journal views, per-repo workbench, mouse + keyboard parity. The core loop (scan → notice → resume) works; what's left is the rough edges around it.

### Active risk

- keep [`ARCHITECTURE.md`](ARCHITECTURE.md) in sync when the top-level flow or storage model changes, or it will drift away from `src/cli.tsx`, `src/screens/`, and `src/lib/`

### Not now

- do not expand the workbench into a primary surface
- do not turn the home scene into a dashboard, grid, or metrics board
- do not resurrect legacy v1 features inside the TUI without a clear case for them (and a glance at [`docs/legacy-not-ported.md`](docs/legacy-not-ported.md))

### One-line product test

Open `pnpm dev` from the repo root and the terminal should read like a little local habitat where your repos live, not a status board with creature decoration.

## Current top slices

1. Keep [`ARCHITECTURE.md`](ARCHITECTURE.md) in sync when the top-level flow or storage model changes.
2. Pick the highest-value polish slice in Priority A.

## Priority A
- richer SHELF view grouping labels (active vibe-divider strings already exist; copy/affordance pass)
- memory editing polish — better diff/feedback when notes/blocker/note-to-future-self change
<!-- workbench mode toggle keybinding — done: ctrl+1 selects portrait, ctrl+2 selects notes (see WorkbenchScreen.tsx, listed in HelpOverlay). -->
<!-- PORTRAIT scrollable container — done in 0.3.2 via per-section PgUp/PgDn paging (see #4). -->
<!-- JOURNAL polish — done: fs.watch in 0.3.3 (#1); vibe-changed phrasing tune below ships separately. -->
<!-- creature placement / overlap handling — done: label-aware footprints + two-pass wander/manual resolution. -->


## Priority B
- more creature sprite variants beyond the current procedural pool
- accessible reduced-motion mode in the TUI: skip the star wipe + creature tween when set, mirror `prefers-reduced-motion`
- per-repo or per-root colour biomes layered over the existing theme set
- shareable session snapshot (printable ASCII / text export of the current garden)
- usage-bar follow-ups: `/usage` overlay with reset countdowns + provider-by-provider breakdown; optional plan-limit config for Claude so its windows can render a real bar instead of raw counts; opt-out flag in `src/lib/config.ts` for users who don't want the row at all
<!-- JOURNAL pruning — done: `pruneEvents({ olderThan })` wired at startup with a 90-day default via `scheduleStartupPrune` in `src/cli.tsx`. See `src/lib/startup-prune.ts` and `DEFAULT_RETENTION_DAYS` in `src/lib/events.ts`. A future config knob for the retention window is left for a later sprint. -->
- repo-associated AI session surfacing: future idea: optional repo-associated AI session surfacing from Claude/Codex session files, if users explicitly enable it. Extract a per-repo "recent AI work" summary (subjects / tool calls / files touched) and surface it in PORTRAIT or as a JOURNAL event kind. Inspired by Chronicle's "per-repo AI session" framing.

## Priority C
- optional terminal-bell on noteworthy events
- world backgrounds per workspace (per-root star palette / glyph set)
- local notification hook (e.g. shell out to `notify-send` / `osascript` when a vibe flips)
