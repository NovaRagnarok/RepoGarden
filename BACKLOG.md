# Backlog

## Current direction

### Immediate target

Polish the daily-use loop: scanning, garden/shelf/journal views, per-repo workbench, mouse + keyboard parity. The core loop (scan → notice → resume) works; what's left is the rough edges around it.

### Active risk

- keep [`ARCHITECTURE.md`](ARCHITECTURE.md) in sync when the top-level flow or storage model changes, or it will drift away from `src/cli-main.tsx`, `src/screens/`, and `src/lib/`

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
<!-- richer SHELF view grouping labels — done: dividers now explain each shelf's role (active changes / flowing / blockers to clear / quiet lately) with narrow fallbacks. -->
<!-- memory editing polish — done: note save feedback now distinguishes regular notes, blocker, and note-to-future-self edits with line/char deltas and blocker shelf-state hints. -->
<!-- workbench mode toggle keybinding — done: ctrl+1 selects portrait, ctrl+2 selects notes (see WorkbenchScreen.tsx, listed in HelpOverlay). -->
<!-- PORTRAIT scrollable container — done in 0.3.2 via per-section PgUp/PgDn paging (see #4). -->
<!-- JOURNAL polish — done: fs.watch in 0.3.3 (#1); vibe-changed phrasing tune below ships separately. -->
<!-- creature placement / overlap handling — done: label-aware footprints + two-pass wander/manual resolution. -->


## Priority B
<!-- reduced-motion mode — done: `reducedMotion` config + Settings toggle, `NO_MOTION=1` / `CI=true` env detection in `theme-provider.tsx`, consumed by garden tween/wander, dither cross-fade, garden↔shelf hold, boot scene, spinner, skeleton, privacy scramble, settings star animation, and blink. -->
<!-- shareable session snapshot — done: `export-text` headless subcommand renders the garden to text, with `--max-chars` / `--discord` greedy bisect + fenced code block + project-URL footer for chat-share. See `runExportTextCli` in `src/lib/gif/cli.ts` and the dispatch in `src/cli-main.tsx`. -->
<!-- /usage overlay — done: `U` from the home scene opens `src/screens/UsageOverlay.tsx` (mounted as the `usage` AppPhase in cli-main). Roomier per-provider view with status line, error message when status !== ok, "resets in Nd Nh" countdowns, and a "last fetched: HH:MM (Nm ago)" footer. Bypasses the persistent `usageBarDisabled` opt-in (opening the overlay is explicit consent) but still honours the `REPOGARDEN_DISABLE_USAGE=1` env kill switch. Backed by a new `includeAll` flag on `useUsage` so error/auth providers reach the overlay even though the chrome row keeps filtering them. `fetchedAt: Date` added to `ProviderUsage`, stamped in `getProvider`. -->
<!-- JOURNAL pruning — done: `pruneEvents({ olderThan })` wired at startup with a 90-day default via `scheduleStartupPrune` in `src/cli-main.tsx`. See `src/lib/startup-prune.ts` and `DEFAULT_RETENTION_DAYS` in `src/lib/events.ts`. A future config knob for the retention window is left for a later sprint. -->
- repo-associated AI session surfacing: future idea: optional repo-associated AI session surfacing from Claude/Codex session files, if users explicitly enable it. Extract a per-repo "recent AI work" summary (subjects / tool calls / files touched) and surface it in PORTRAIT or as a JOURNAL event kind. Inspired by Chronicle's "per-repo AI session" framing.
  - **Deferred, not now.** Three reasons: (1) net-new feature surface during a "polish the daily-use loop" sprint, and edges toward the "do not turn the home scene into a dashboard" line; (2) Claude Code and Codex session formats aren't stable public contracts, so any parser is building on shifting ground; (3) privacy ergonomics are real — even opt-in, surfacing transcript subjects on a screen that gets shared in pair sessions or screencasts is a footgun.
  - **If we do it, do it tight.** JOURNAL-only, metadata-only: "Claude session in this repo, N tool calls, files X/Y/Z touched" with no prompt content. Sidesteps both the privacy issue and the dashboard risk. Even this waits until the polish target is cleared.

## Priority C
- optional terminal-bell on noteworthy events
- local notification hook (e.g. shell out to `notify-send` / `osascript` when a vibe flips)
