# Changelog

All notable changes to RepoGarden land here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versioning follows [SemVer](https://semver.org/spec/v2.0.0.html). Earlier history lives in `git log`.

## [Unreleased]

### Fixed

- **Journal vibe-change entries read as transitions, not status snapshots.** Each `from → to` pair now picks a verb that describes the change (`back in flow`, `hit a blocker`, `wound down`, `settled`, `back at it`, `stirred`, …) instead of falling through to the destination state. Pre-fix, `blocked → happy` rendered as `happy: clean`, which read like a status line. The reason text gets a small cleanup pass too: the redundant `blocker:` prefix is stripped when the verb already says it, and trailing periods are dropped before the em-dash join.
- **Garden creature labels no longer collide with neighbouring sprites.** Placement now sizes each grid slot to fit the *full* footprint (sprite body + rendered name label), and reserves room for the label row below each sprite. Pre-fix, two sprites whose bodies didn't overlap could still have their name labels painted over each other or into an adjacent sprite, and a long name on row N could clip into the sprite on row N+1.
- **Wandering creatures no longer land on dragged neighbours.** `syncVisualPlacements` now resolves manually-offset creatures first so wanderers iterated before them check against the dragged neighbour's actual visual position, not an anchor footprint that excluded it.

### Added

- **Per-repo activity drives animation cadence.** A continuous 0–1 activity scalar derived from "days since last commit" (7-day half-life exponential decay) now biases each creature's wiggle frame-cycle and wander idle gaps within its vibe-bucket's range. Fresh-commit repos sit at the fast end of their cadence range with full drift radius; long-quiet repos sit at the slow end with ~25% drift. A repo blocked by a current `blocker` note still gets its activity from commit recency, so a freshly-broken build keeps bustling visibly while a stalled-for-a-month one barely moves.
- **Composited eyes + blink animation.** Each creature's two eye cells now render as a *face panel*: a body-coloured cell with an eye glyph painted on top (`•` open, `_` closed). Sleepy creatures hold the closed glyph; awake creatures blink briefly every 3.5–7s (interval shrinks with activity), with a per-creature phase so the swarm doesn't blink in unison. The sub-pixel body grid is unchanged across vibe flips — only the composited paint differs — so silhouette stays stable. Reduced-motion mode locks the open glyph (no blinking).
- **Background observer** for live commit + new-repo backfill. `fs.watch` on each repo's `.git/logs/HEAD` catches commits / amends / pulls / resets within ~250 ms; a non-recursive watch on each scan-root catches new repos dropped into a tracked folder within ~500 ms. The existing 30 s safety-net poll still runs underneath so updates arrive on filesystems where `fs.watch` is unreliable. Default-on; the settings screen exposes `o` as a persistent toggle, and `REPOGARDEN_DISABLE_OBSERVER=1` still wins for single-run launches. Closes the §4.1 "flagged for recovery" item in `docs/legacy-not-ported.md`.
- **Pull from the workbench** (fast-forward only). PORTRAIT exposes `u` as a two-press confirm (first arms, second runs); the command palette has a "pull from remote" entry that runs immediately. Result lands as a sticky banner on failure / non-zero and as a transient success banner otherwise. Preflight blocks the action when the tree is dirty, HEAD is detached, the branch has no upstream, or scan errored. Each attempt appends a `pull` event to the journal — payload carries `ok`, `exitCode`, `branch`, `beforeSha`, `afterSha`, `commitsPulled`, `summary`, `durationMs`, `timedOut`. Closes the §7.3 "flagged for recovery" item in `docs/legacy-not-ported.md`.

### Internal

- New `computeActivity` + `ACTIVITY_HALF_LIFE_DAYS` exports in `src/lib/vibe.ts`; `VibeResult` now carries `activity: number`. `buildWiggleProfile` and a new per-creature `WanderProfile` (built once in `createWanderState` and stored on `GardenWanderState`) replace the previous direct `VIBE_WANDER` reads in step functions, so activity-baked timing flows through the whole tick path without re-resolving on every frame.
- `generateCreatureFrames` now returns `eyeCells: { left, right }` alongside frame data. `GardenSpriteInfo` carries those cells plus an `eyesClosed` flag (gated on `vibe === "sleepy"` in `buildScene`) and a per-creature `BlinkProfile` (interval scales with activity, randomised phase). The render loop in `src/garden/render.ts` paints eye cells as `{ char: glyph, fg: theme.background, bg: info.body }` — a face panel composited on top of the quadrant grid. New `blinkClosedAt` helper in `src/garden/model.ts` returns the closed/open state from `(now + phaseMs) % intervalMs`.
- New `spriteFullFootprint` helper in `src/lib/garden-layout.ts` covers the rendered name label below each sprite; `placeCreatures` now sizes slots from `max(maxSpriteCols, maxLabelCols)` horizontally and `maxSpriteRows + NAME_GAP_ROWS + NAME_H` vertically. `syncVisualPlacements` in `src/garden/model.ts` resolves manually-offset placements first so wanderers see their actual visual positions. New `vibeTransitionVerb` + `trimVibeReason` helpers in `src/lib/event-summary.ts` cover all 12 from-to transitions with a defensive fallback for unknown vibe pairs. Test count: 318 → 345.
- New module `src/lib/observer.ts` (per-handle debounce, watch budget cap at 150, error-tolerant per the `subscribeToEventsFile` pattern). New `observer` field on `TuiConfig` and `observerEnabled()` helper honoring the env override. cli.tsx adds one `useEffect` keyed on the *set* of repo paths so commit-driven state updates don't churn the watcher list.
- New module `src/lib/git-pull.ts` (async `git pull --ff-only` with 60 s timeout, line-streaming `onLine` callback, and small sync sha helpers). New event-summary kind `pull`. New single-repo refresh helper `refreshOneCreature` in `src/lib/creature.ts` re-inspects one repo and re-runs `enrichScans` so the snapshot reconcile fires.

## [0.3.3] — 2026-05-13

### Added

- **Journal updates land via `fs.watch`** (#1). New writes to `~/.repogarden/events.jsonl` now propagate in ~100 ms instead of waiting up to 5 s. A 30 s safety-net poll still runs so updates arrive on filesystems where `fs.watch` is unreliable (network mounts, some WSL-mounted Windows paths).
- **Persistent usage-bar disable toggle** (#5). New `u` keypress in Settings flips `usageBarDisabled` in `~/.repogarden/tui.json`; `useUsage` short-circuits on it (no credential reads, no network). `REPOGARDEN_DISABLE_USAGE=1` still wins for single-run launches.
- **PORTRAIT pages with PgUp/PgDn** (#4). Long actions / notes / activity / changes / commits lists no longer clip off the bottom of short terminals. Each list section paginates by its slice limit (the same one `d` toggles), and shows a dim "showing N–M of T · PgUp/PgDn to scroll" indicator when more remains.

### Internal

- Test count: 280 → 283. New helpers `sectionPageSize` and `sectionItemCount` in `src/lib/portrait.ts`; new `subscribeToEventsFile` in `src/lib/events.ts`.

## [0.3.2] — 2026-05-13

### Fixed

- **Demo mode roster collisions** (#7). Eight scanned repos would frequently end up with two creatures sharing a name (e.g. two `salt-and-paper` entries) because the per-id resolver was a hash modulo into a 16-name pool. Replaced with a without-replacement assignment over the active id set, with `-2`/`-3` suffixes once the roster is exhausted. Refreshed `docs/images/demo.gif`.
- **Reduced-motion polish** (#6) on three sites that previously animated regardless of the setting: the privacy mode-toggle scramble (now lands settled instantly), `Spinner` (holds the first frame), and `Skeleton` (renders the static dot field with no shimmer).

### Closed without changes

- #2 (PgUp/PgDn → selection): already wired in `JournalView`; updated the BACKLOG and the journal manual-test doc to stop describing the old decoupled-scrolling intent.
- #3 (workbench mode keybinding): `ctrl+1` / `ctrl+2` already select portrait/notes and are listed in the help overlay; updated the BACKLOG to stop calling it mouse-only.

## [0.3.1] — 2026-05-13

### Added

- `repogarden --version` (alias `-v`) prints the running package version and exits.

## [0.3.0] — 2026-05-13

### Added

- macOS-friendly **focus-event recovery**: the TUI now listens for xterm focus events (mode 1004) and, on focus-in, defensively releases the DEC 2026 Synchronized Update Mode bracket the kernel can leave half-open across a Space swipe. Fixes the "fullscreen terminal froze after swiping to another Space" symptom.
- Quiet **npm update check** on startup. Hits `registry.npmjs.org` once per launch, cached for 24h under `~/.repogarden/update-check.json`. Surfaces a single info toast when a newer version is published — never blocks boot, never modifies the install. Opt out with `REPOGARDEN_NO_UPDATE_CHECK=1`; auto-skipped in demo mode and on CI.
- In-app **first-run privacy notice**: two dim lines on the onboarding screen noting that scans stay local and that `~/.repogarden` is safe to delete.
- Animated **README demo GIF**, reproducible from `tape/demo.tape` via `vhs`. Boot → onboarding → garden → shelf → journal, ending on the garden for a clean loop.
- README **"First 5 minutes"** walkthrough using real key bindings sourced from the help overlay.
- Expanded `--help` text covering env vars (`REPOGARDEN_DISABLE_USAGE`, `REPOGARDEN_NO_UPDATE_CHECK`, `REPOGARDEN_DEMO`, `NO_MOTION`), requirements, data path, and reset.
- New PR template with a habitat-first check and a typecheck/test/build/manual-smoke list.

### Fixed

- **macOS Space-swipe freeze** (#8): fullscreen terminal swiping to another Space and back left the TUI visually frozen until relaunch. Root cause was the synchronized-update bracket landing without its matching close after a mid-write process suspension.

### Changed

- "Alpha" → "early beta" across `README.md`, `SECURITY.md`, and `--help`. Supported-versions table now tracks `0.2.x → 0.3.x` instead of the stale `0.1.x`.
- `REPOGARDEN_DISABLE_USAGE` examples now show both installed (`repogarden`) and from-source (`npm run dev`) forms side by side.
- Bug-report template asks for TUI-specific context: which screen, terminal size, install method, and whether `REPOGARDEN_DISABLE_USAGE=1` changes the symptom.
- `CONTRIBUTING.md` gained a short "Good first issues" pointer to the labeled tracker.
- Journal manual-test doc synced with `j/k` cursor and arrow-driven repo-picker behavior.

### Internal

- New module `src/lib/focus.ts` (focus-event parser, mirrors `mouse.ts`).
- New module `src/lib/update-check.ts` (pure logic, injectable I/O).
- 8 new tests for focus parsing, 13 new tests for update-check. Test count: 247 → 268.
- Tape scripts under `tape/` regenerate the README GIF deterministically against an isolated `/tmp/repogarden-demo-home`.
- Five new issue labels: `journal`, `workbench`, `accessibility`, `privacy`, `demo`, `friend-alpha`, `macos`.
