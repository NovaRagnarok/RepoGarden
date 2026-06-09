# Changelog

All notable changes to RepoGarden land here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versioning follows [SemVer](https://semver.org/spec/v2.0.0.html). Earlier history lives in `git log`.

## [Unreleased]

### Added

- **In-garden mood captions + transient emotion cues** — the two top "flagged for recovery" items from `docs/legacy-not-ported.md` (§1.5 / §1.4), in a terminal-native shape. The focused creature now shows one muted caption line adjacent to its focus frame (`✶ excited — 6 unpushed commits stacked up`): prefers the sky row above the frame, falls back below the name row, squeezes into the clear gap next to neighbours with ellipsis truncation, and skips rather than paint over anything. Non-focused creatures occasionally flash their mood glyph above their shoulder on a deterministic seeded schedule (period ~9–15 s, visible ~1.2–1.8 s — same pattern as blink timing), capped at 2 cues per frame with a deterministic tie-break. Both gate on mood confidence ≥ 0.65 (threshold now shared with the portrait chip via `MOOD_DISPLAY_CONFIDENCE_THRESHOLD` in `src/lib/vibe.ts`); `content` renders nothing. Captions are information and stay on under reduced motion; cues are motion and turn off — and never appear in pinned GIF/text exports. New glyph vocabulary (`✶ ★ ◦ ~ ¿ …`) documented in `docs/creature-system.md`; pure model logic in `src/lib/garden-captions.ts`.

## [0.9.2] — 2026-05-17

### Changed

- Minimum Node runtime lowered from 24 to 22. `ink@7` (the heaviest dep) only requires Node ≥22, and `Intl.Segmenter` — the original driver for the Node-24 floor — ships in every Node 22 build, so the bump was stricter than necessary. CI matrix now exercises both Node 22 and 24 on Linux/macOS/Windows. (Pack-smoke job stays on 24.)

## [0.9.1] — 2026-05-17

### Added

- New `<ScrollBar>` component (`src/components/ui/scroll-bar.tsx`) lifted out of the TextArea's inline scroll indicator. Both the notes editor and the journal event list consume it.

### Changed

- Journal view now uses a two-pane focus model. ↑↓ (and `j`/`k` as aliases) scroll whichever pane currently has focus — the sidebar repo list or the event list. Esc toggles between panes (clearing an active filter first). Enter from the sidebar drills into the event pane instead of jumping out to the workbench; workbench access stays one keystroke away via `g` to garden or shelf, where Enter still opens it.
- High Contrast theme's focus ring is now cyan (`#00FFFF`) instead of yellow (`#FFFF00`) so a focused pane border no longer shares its hue with `warning`. Still 16.7:1 on black, well above AA.
- The `★ RepoGarden` Credit footer no longer appends a literal ` (URL)` fallback on terminals without OSC-8 hyperlink support — the brand mark stays on one line on narrow hotbars (Settings, Help, etc.). Hyperlink-capable terminals still get the clickable link.

### Fixed

- **Journal text no longer keeps stale characters after a transition.** `DitherOverlay` was painting "stars" over the journal area via absolute-cursor escape sequences written directly to stdout, then erasing them by writing spaces at the same screen positions. The spaces overwrote whatever Ink had rendered, and Ink's diff cache didn't repaint. Rewritten to render the stars as Ink children so the natural unmount path reconciles the cells back.
- **Single Escape now reliably closes the workbench, help, settings, usage, and edit-roots screens.** The mouse and focus parsers held a trailing `\x1b` in a pending buffer waiting for a follow-up byte that disambiguates it (so split SGR-mouse sequences don't leak as Esc keystrokes). With no follow-up the byte sat forever. A 30 ms timer in `cli-main.tsx` now flushes both parsers' pending buffers after each chunk, so a paused Esc resolves on its own.
- **Workbench overview no longer renders the value on top of the label**, the section tabs no longer fuse with the "1 file changed" alert at small heights, the snapshot / top-actions panels keep their borders, and the help overlay's `┌─┐` key boxes render with full top and bottom borders. Single shared root cause: Yoga's default `flexShrink=1` was letting `overflow="hidden"` ancestors squeeze multi-row bordered children below their natural row count. `flexShrink={0}` applied to Panel, Badge, the workbench section rows, and the KeyboardShortcuts grid.
- **Onboarding scan-path input renders its content row** (prompt + cursor) inside the box instead of on the bottom border. `minHeight={3}` on the bordered wrapper.
- **Toasts sit inside the garden panel** instead of straddling its bottom border. Toaster `marginTop` bumped from `rows - 7` to `rows - 9`; the constant is hoisted to module scope (`TOASTER_MARGIN_TOP`) so the paint mask below reads from one source of truth.
- **Garden engine's direct-stdout star/sprite painter no longer overpaints Ink-rendered toasts.** New `paintExclusions` API on `GardenSceneProps`: a list of canvas-local rects whose cells the renderer marks `transparent`. The diff writer and `setCell` both short-circuit on transparent, and `blockStarsForOverlays` skips star-gen work entirely for excluded cells. `ReadyShell` derives the toast rect from `useToasts().active` and the shared layout constants, in canvas-local coords, and threads it through to both `GardenView` call sites.
- **Journal event-summary no longer leaves a stale tail** (`shipped "Refresh live mobile data on focus"ences"`) when a long previous-frame summary contracts. Variable-length `truncate(eventSummary(...), summaryWidth)` swapped for fixed-width `padTrunc(...)` so the Text length is constant between frames.

### Internal

- `flushPending` / `hasPending` exports on `src/lib/mouse.ts` and `src/lib/focus.ts`; cli-main schedules the 30 ms flush timer.
- Toast layout knobs (`TOASTER_MARGIN_TOP`, `TOAST_MAX_VISIBLE`, `TOAST_ROWS_EACH`, `TOAST_WIDTH_PADDING`) hoisted to module-level constants in `ReadyShell.tsx`.
- `scripts/tui-observe.sh send` now accepts any single printable char, `C-*` chords, `Tab` / `Space` synonyms, and `text:<string>` for literal multi-char input — enough to drive every surface from the harness.
- End-to-end QA report at `docs/manual-qa-report.md` with the inventory, root causes, and verification captures for every bug fixed this release.
- Test count: 491 → 497 (one new regression test covers the bare-Escape flush).

## [0.9.0] — 2026-05-16

### Added

- `REPOGARDEN_REDUCED_MOTION=1` now forces reduced motion for a single run without changing the saved setting.
- CI now runs a real tmux-backed TUI smoke on Ubuntu so first-run/ready-screen regressions get caught outside unit tests.

### Changed

- RepoGarden's user-facing docs now describe the local-first 0.9 release-candidate line, including the supported `~/.repogarden` storage location and migration expectation.
- First-run and creature-system copy now use the current `awake` / `happy` / `stuck` / `sleepy` vocabulary.
- Claude/Codex usage bars are now opt-in for fresh installs. The Settings `u` toggle still turns them on/off persistently, and `REPOGARDEN_DISABLE_USAGE=1` remains a single-run override.
- Shelf dividers now explain what each vibe group means (`active changes`, `flowing`, `blockers to clear`, `quiet lately`) instead of showing only a bare vibe name and count.
- Workbench note-save feedback now distinguishes regular notes, blocker notes, and note-to-future-self notes, including line/character deltas and clearer blocker set/clear/update hints.

### Fixed

- Release builds now clean `dist/` before compiling so local packs cannot include stale ignored artifacts.
- The CLI now exits early with a clear Node 24+ requirement message on unsupported Node versions.
- The live TUI observation harness now accepts the documented `pnpm observe:tui -- start` form and actually submits the disposable `~/repos/root` scan path on first run.

### Internal

- Test count: 483 → 491.

## [0.8.0] — 2026-05-15

### Fixed

- **Drag survives any mid-flight re-render.** `syncGardenModel` used to unconditionally wipe `dragPreviewPlacements` and reset every wander state's `manualOffset` to its last *committed* value. Combined with `engineProps` churning constantly — `cli.tsx` declares `handleCreaturePlacementChange` as a plain function (new ref every render) and ships several inline arrow callbacks down to `GardenView` — every parent re-render invalidated the memo, triggered `setProps` → `syncGardenModel`, and silently undid the in-flight drag. A toast appearing, a 30s background refresh, a focus change from any source, all enough to kill the drag mid-motion. `syncGardenModel` now carries `dragPreviewPlacements` across the sync (pruning entries whose creature is gone) and wander states with an active preview entry skip the `manualOffset` reset. `engine.setProps` gains a `sameSceneProps` fast-path that skips the sync entirely when only callback identities changed.
- **Drag commit math no longer bakes in the wander bob.** Press recorded `grabX = localX - visual.x` where `visual.x` includes `wander.currentOffset`. On commit, that transient bob (up to ±2 cells horizontally, ±1 vertically) got baked into the persisted offset, so single-cell drags landed 1–2 cells off the cursor's release point and felt like the drag didn't take. Press now subtracts `wander.currentOffset` when recording `grabX/Y`, anchoring the grab to the creature's rest position; cursor delta equals committed offset exactly.
- **Two more drag misses: stale chrome measurement and post-tick hit-test gap.** The cached chrome row height was reused after layout shifts that changed it, so the click-to-canvas coordinate translation drifted by a row or two and the press landed on the wrong creature (or nothing). And the 100ms wander tick could move a non-focused creature between when the screen was painted and when the user's click event arrived in Node — `findCreatureDragHandleAtCell` reads model state, not the last-rendered frame, so it missed. Engine now remeasures chrome on every press, and falls back to a hit-test against the last-rendered creature snapshot when the live model misses.
- **Pre-existing scene overlap no longer vetoes unrelated drags.** When two creatures were already clipping (from a prior squishy commit, or a layout reflow), the drag solver's clean-state check refused any new motion until the overlap was resolved — even when the dragged creature was nowhere near the overlapping pair. The solver now ignores body-overlap state for creatures other than the drag's footprint and immediate neighbours.
- **Dismissing the focus card returns the bottom-right corner to the garden.** Pressing `c` to hide the focus card used to leave the bottom-right slot reserved as a dead zone — creatures couldn't wander into it, drag wouldn't accept a release there, and the corner just sat empty. The dead zone now releases when the card is dismissed, so the corner is just garden again until the card comes back.
- **Names no longer disappear near the bottom of the garden.** The wander/drag clamp in `visualPlacementAtOffset` reserved one row below the sprite, but the name strip is `NAME_GAP_ROWS + NAME_H` (two rows). The bottom-most clamp parked the name at row `canvasH` — outside the canvas, in the panel's bottom-padding row — where `setCell` silently dropped it. Visually: any creature that wandered or got dragged to within ~2 rows of the bottom border lost its name. `findNearestClearPlacement` had the same off-by-one in its bounds check. Both now reserve the full name strip.
- **Selection box hugs the visible creature instead of the sprite bounding box.** The focus frame was sized to `charW × charH` (the sprite generator's full grid), but `randomBodyWindow` typically allocates only 54–74% of that height to the body and the contour walk doesn't fill every column either — so the box was puffed up with a row or two of empty cells around the actual creature. Now scans both animation frames for lit sub-pixels and shrinks the box to their union; OR-ing both frames keeps the box steady through the body-bob so it tracks the creature's range of motion rather than bobbing along with it.

### Internal

- Test count: 445 → 462 (regression coverage for the `syncGardenModel` preview-survival path and the wander-bob grab anchoring, plus tests for the corner-release-on-dismiss path).

## [0.7.0] — 2026-05-15

### Changed

- **Creature size now reflects source-file mass, not git activity.** The old mass formula was dominated by `log1p(commitCount)`, so a long-dormant repo with 5k historical commits out-sized a fresh monorepo with 50x the code. Mass is now driven by lines of code + file count, with commit count kept only as a faint 0.08 tiebreaker (and a fallback while the Phase 3 fs walk hasn't populated stats yet). Vitality signals — `recentCommitDays`, ahead/behind, `isDirty` — are dropped from the mass formula entirely; they belong to mood/confidence, not size. `scanRepoTree` replaces the old `detectLanguage` walk: same single depth-2 pass, but it now returns `fileCount` and `sourceLines` alongside the dominant language. Files larger than 1 MB are estimated as `bytes/40` so an accidentally-committed dump can't make the phase crawl. Noise filtering tightened — `*.min.js`, `*.min.css`, `*.map`, `*.d.ts`, `*.generated.*`, `*.gen.*`, plus lockfiles and vendor dirs (`vendor`, `external`, `extern`, `deps`, `third_party`) are excluded from mass. Markdown still counts toward `primaryLanguage` detection but not toward mass, so a docs-heavy repo reports as "Markdown" without inflating its creature.
- **Cohort scaling is now rank-based.** The old normalisation mapped raw mass into `[0,1]` via `(mass - cohort.min) / (cohort.max - cohort.min)`, blending 82% relative + 18% absolute. In a typical personal garden — many small repos plus a few large outliers — the small repos all clustered near `relative=0` even though they were clearly distinct by rank. `CreatureSizeCohort` now carries the full sorted mass list; `normalizedCreatureMass` returns `rank(mass) / (count - 1)` when the cohort has 3+ repos, with the absolute term as a fallback for tiny cohorts. The smallest repo in your garden always lands at 0, the largest at 1, and everyone in between spreads evenly regardless of how raw mass values bunch.
- **Creature size ceiling raised so the top of the cohort can read as chunky.** Under rank-based scaling the biggest few repos all bunched at the 130-cell cap (17x8). Three constants lifted in lockstep: `maxArea` 130 → 180, `charW` clamp 18 → 20, `charH` clamp 9 → 11. The area→dim conversion goes through a sqrt, so the 38% area bump only widens each dim by ~18% on average at the top; mid and small creatures barely move. Re-audited on a 32-repo tree: area ratio 5.67x → 6.43x, unique dim pairs 18/32 → 22/32, biggest creatures spread across 17x10 / 18x10 / 20x9 instead of all crowding at 17x8.
- **Cohort threaded into focus popup and workbench sprite.** `CreatureSprite` was calling `creatureCharSize(repo)` without a cohort, so `ReadyShell`'s focus popup and `WorkbenchScreen`'s sprite both fell through to the absolute-only sizing path. Under rank-based scaling this is a dramatic mismatch — a rank-1/31 repo lands at normalised 0.03 in the garden but mass/13.8 ≈ 0.53 in the popup. Plumbing: `CreatureSprite` gains an optional `cohort` prop, `WorkbenchScreen` gains `sizeCohort`, `ReadyShell` gains `sizeCohort`, and `cli.tsx` computes the cohort once via `useMemo` from the non-hidden creature set and threads it down. Same creature now has the same size whether you see it in the garden, the focus popup, or the workbench.

### Added

- **Wider-than-tall aspect bucket gives some creatures a horizontal silhouette.** The existing three aspect buckets (1.15–1.37 squat, 1.32–1.74 mid, 1.65–2.37 wide-cell) all stayed at or below cell aspect 2.37. Terminal cells are roughly 2:1 tall:wide, so cell aspect <2.0 reads as portrait, ~2.0 reads square, and >2.0 reads wide — under the old buckets only ~20% of creatures crossed 2.0 and none read genuinely horizontal. A new 4th bucket carves 15% of rolls at cell aspect 3.2–4.4 (visual 1.6–2.2), so a meaningful slice of creatures land as sausage cats instead of square cats with a slight tilt. The existing buckets' internal ranges are unchanged, so tall/square creatures look exactly like they did before.

### Fixed

- **Creature drag commits reliably on release.** Two bugs combined to make click-and-drag feel intermittent. `GardenEngine.handleMouse`'s release path only committed strict (zero-overlap) placements, with a fallback to the last strict-clean drag step; when neither succeeded — e.g. dragging onto a packed neighbour — both fell through to null and the squishy preview the user was actively looking at was thrown away. Separately, a missed release event (cursor left the terminal mid-drag) left the drag state live, and the next press cleared it without committing, destroying any successful movement. Release now falls back through strict@release → last strict-clean step → squishy@release → last squishy step before giving up, and a fresh press while a drag is still live commits the prior drag's recoverable state before starting a new one. Closes #33.
- **Wide-aspect creatures fill their grid instead of painting a tall body in a wide frame.** After the wide-aspect bucket landed, a 14x3 sausage rendered with its body squashed into the centre 4–6 cells of a 14-cell-wide grid — wide silhouette, square body. Two compounding causes in `randomContour`: `topWidth`/`bottomWidth` sampled from a tiny `halfW*0.32/0.45` band so even at the high end the body only filled ~60% of a square grid (~30% in a wide grid), and the per-row contour walk + lobes could push width below `minHalf` which then clamped (= 3 sub-pixels = ~6 cells body width), squashing even the lucky high-`topWidth` rolls. Wide-grid detection (`subW > subH * 2`) now bumps the random spread to span `[wideMinHalf, maxHalf]` where `wideMinHalf = halfW * 0.65`, and uses `wideMinHalf` for the per-row clamp so lobes can't shrink mid-walk. Square / portrait grids keep the original spreads. Body fill is also tightened on wide grids: `fillBias` floor 0.86 (was 0.70) and `raggedness` range 0.04–0.16 (was 0.10–0.32), so edge cells of a wide body fill at ~57–80% (was ~28–70%) and the body reads solid rather than moth-eaten.
- **Density no longer silently reshapes creatures.** `buildTiles` used to compute a per-slot `maxCharW`/`maxCharH` and clip each creature's dims down to those bounds, which meant a 14x3 sausage in a dense garden with narrow slots became 7x2 or 6x3 (and the sprite generator then drew it at those compressed dims). Density now only affects pagination (how many creatures fit per page via `PAGE_SLOT_DIMS`) and the placer's packing tightness (`SHELF_EXTRA_PAD`) — never the size or shape of an individual creature. If a creature is genuinely bigger than the placer's available canvas, the existing graceful-degradation path (slot reuse, overlap-packing) handles it. As a related fix, when clipping a creature to its slot bounds is necessary (true overflow), the clip is now uniform-scale (`scale = min(1, maxCharW/rawW, maxCharH/rawH)`) instead of clipping each dim independently — so a horizontal creature in a narrow slot gets smaller but stays horizontal instead of collapsing into a near-square.

### Internal

- **Scan cache schema bumped** to drop stale entries written by pre-source-mass builds. `ScannedRepo` gained `sourceLines`/`fileCount` earlier in this release; old cache entries without them caused `creatureActivityMass` to fall through to `log1p(commitCount) * 0.5` and size every cached repo by its commit count instead of its code mass. High-churn / low-LOC repos rendered dramatically oversized until each happened to get re-scanned. Bumping `CACHE_VERSION` 1 → 2 drops every stale entry on next load; the cost is one slow scan after upgrade.
- Test count: 443 → 445.

## [0.6.1] — 2026-05-15

### Added

- **Optional terminal bell on vibe flips.** New `b` toggle in Settings (and `bellOnVibeChange` in `~/.repogarden/tui.json`, default off) emits a single BEL (`\x07`) when a live scan picks up a vibe transition on a repo that existed before. The diff runs in `cli.tsx` on every creature update and is gated on `phase === "ready"` (so boot-time streaming partials and workbench focus don't bell-storm) and on not currently rescanning; new repos that just appeared don't count. One BEL fires per change-batch regardless of how many repos flipped — the journal still records the per-repo `vibe-changed` events as before for any detail the bell omits.

### Internal

- README gained a "Reduced motion" subsection documenting the existing Settings (`m`) toggle and `NO_MOTION=1` / `CI=true` env detection — the feature shipped earlier (see `theme-provider.tsx:86`, garden tween/wander, dither, boot, spinner, skeleton, privacy scramble) but wasn't called out in the user-facing docs. Stale "reduced-motion mode" entry pruned from `BACKLOG.md` Priority B.
- Settings prefs panel grew a sixth row; `compactMode` threshold bumped from `rows < 33` to `< 34` and non-compact `reservedRows` from 29 to 30 so the new row never clips on short terminals.

## [0.6.0] — 2026-05-14

### Added

- **Share the habitat.** Two new keys in garden / shelf views: `x` exports an animated GIF of the current habitat page to `~/Downloads/repogarden-<ts>.gif`, `t` copies a single plain-UTF-8 frame of the habitat to the system clipboard (wrapped in Markdown code fences with a right-aligned project-URL footer, ready to paste into Discord / Slack / a README). GIF uses native pixel-art rendering — quadrant glyphs unpack into 2×2 sub-pixel blocks, letters render through a bundled hand-designed pixel font (Tamzen 8×16 Bold, MIT), eyes and wander are pinned off (eyes always open, no drift) so labels stay anchored over their static placement and don't clip canvas edges; the body wiggle still animates. Encoder is `gifenc` (pure JS, ~10 KB), no external tools needed. Default output is 1920×1088 at 24 frames / 3 seconds, ~400 KB. Matching CLI subcommands: `repogarden export-gif` and `repogarden export-text`, both accepting `--root`, `--out`, `--scale`, `--seconds`, `--theme`, `--width`, `--height`, `--page`. `export-text` also has `--max-chars <n>` (and `--discord` as an alias for `--max-chars 1999`) which bisects canvas size to fit a paste budget. Pagination uses a labels-aware capacity (`safeGardenCapacity`) that mirrors the placer's slot math, so every exported frame holds a guaranteed-no-overlap subset of creatures.
- **Mood + confidence axes** alongside the 4-state vibe (closes the §5.1 "flagged for recovery" item in `docs/legacy-not-ported.md`). A new `Mood` descriptor — `curious / excited / proud / anxious / confused / lonely / content` — is inferred from blocker text, ahead/behind counts, a 7-day commit burst vs. its own 23-day baseline, fresh-repo heuristics, and visit recency. Each candidate mood scores by signal strength; ties break on a precedence list (`confused > anxious > excited > proud > curious > lonely > content`). Vibe stays the load-bearing shelf bucket; mood is advisory. Surfaces as a chip in the workbench portrait when `confidence ≥ 0.65` (suppressed for the `content` default and for `lonely`-on-sleepy as redundant copy), and as a new `mood-changed` journal event with a 24h per-repo cool-off so transient flickers don't spam the journal. Event-summary phrasing has its own verb table (`perked up`, `got anxious`, `relaxed`, `stood tall`, …) with a `feels <mood>` fallback for unmapped pairs.

### Changed

- **Repo scan is now parallel + cached.** `scanRootsProgressive` rebuilt from a serial git-spawn loop into a four-phase parallel pipeline with a persistent on-disk cache. Phase 0 reads `.git/HEAD` + ref via plain file reads (no git subprocess), handling submodules (`.git` as file), worktrees (commondir for ref lookup), packed-refs, detached HEAD, and empty repos; phase 1 runs `git status --porcelain=v2 --branch` through a bounded worker pool; phase 2 enriches with log, count, sparkline, dirty inventory and diffs in parallel; phase 3 detects primary language via fs walk. Each phase emits its own callback (`onRepoSkeleton`/`onRepoStatus`/`onRepo`/`onRepoExtras`) so the garden paints names within ~150ms cold, and a warm cache lands the full 37-repo scan in ~130ms (a 14× speedup over the prior synchronous path). Cache lives at `~/.repogarden/scan-cache.json`, keyed by repo path and HEAD sha, 30-day expiry, schema-versioned; `REPOGARDEN_SCAN_CACHE` overrides the path (empty string disables). Concurrency is tunable via `REPOGARDEN_SCAN_CONCURRENCY` (default `min(8, cpus().length)`). Stale dirty/ahead/behind on cache hits is the documented trade-off — the existing 30s background refresh and `fs.watch` observer catch up shortly after launch. Closes #21.
- **Settings preference rows are now individually clickable.** Each `m`/`u`/`o`/`p`/`g` row has its own hit zone instead of one panel-wide zone, the on/off (and density value) indicator moved into a 12-column left gutter next to the option name, labels truncate-end at narrow widths so the indicator never wraps. The footer regrouped into themes / prefs / mouse lines and the chrome budget bumped from 13 to 15 rows to fit. Closes #15.

### Fixed

- **NOTES Backspace no longer freezes the editor.** The top-of-handler guard used to sync a clamped cursor and then `return`, eating the keystroke whenever `(cursorLine, cursorCol)` lagged the buffer for a frame (after a selection-delete, paste, or external `setEditor`). Falls through to the keystep after the sync now; Backspace and forward-Delete route through new pure `applyBackspace` / `applyForwardDelete` helpers in `editor-buffer.ts` so the same defence is testable in isolation. Closes #16.
- **Esc-as-quit collision + mouse-sequence Esc leak.** Two related TUI input bugs: ReadyShell treated Esc as a quit alias, colliding with Esc's existing "back out" role (clear filter, close overlay, leave sub-screen); and `parseStdinChunk` only buffered a trailing `\x1b[<` prefix, so an SGR mouse sequence split across two stdin chunks at any earlier boundary leaked its leading `\x1b` into Ink's keyboard parser as a stray Esc — clearing the filter on every click that straddled a chunk boundary. `q` is now the sole quit key; the carryover now holds back every partial SGR-mouse prefix shape. Closes #17.
- **TextArea cursor + scroll survive PORTRAIT ↔ NOTES flips.** Pre-fix, `ctrl+1`/`ctrl+2` between workbench modes unmounted the editor's TextArea and dropped its local cursor + scroll state. The subtree now renders unconditionally and visibility toggles via Ink's `display` prop on the parent Box, so React keeps the state intact. The TextArea's `isActive` is ANDed with the visibility predicate so the hidden editor never steals keystrokes. Closes #23.
- **TextArea cursor math indexes graphemes, not UTF-16 code units.** A 4-byte emoji used to land the caret between its surrogate halves and a single Backspace could leave an orphaned high surrogate persisted to disk. `Position.col` is now a grapheme-cluster index throughout the editor (a ZWJ family, flag pair, or skin-tone modifier counts as one cell). New `splitGraphemes` / `sliceGraphemes` / `graphemeLength` helpers in `editor-buffer.ts` (Node ≥24's `Intl.Segmenter`, with an `Array.from` codepoint fallback) route through `replaceRange`, `clampPosition`, `getSelectedText`, `applyBackspace`, `applyForwardDelete`, `wrapLine`, `cursorToVisual`, and the renderer's segment builder so model and view stay in lock-step. Closes #24.
- **Short-terminal Settings no longer clips preferences.** Compact-mode threshold bumped from `rows < 30` to `rows < 33` (the height at which min pageSize 4 + worst-case narrow chrome fits inside `container = rows - 1`), and compact `reservedRows` bumped from 13 to 18 for the same reason. Below the new threshold a tab bar (`[ themes ] [ prefs ]`) renders only one section at a time and the footer condenses from 4 lines to 2; above it the stacked layout always fits. No height ≥ `MIN_ROWS` (24) clips preferences off the bottom now.
- **README ASCII habitat preview renders correctly on GitHub.** GitHub's code-font fallback was painting the heavy box-drawing chars (`┏━┓┃┗┛`) and pixel-art block elements (`▜▟█▙▛▄▌▐`) at non-uniform widths, drifting borders past 95 columns and forcing a horizontal scrollbar. The lighter `╭─╮│╰╯` swap helped the outer frame; the lasting fix points the `<details>` block at the existing `docs/images/preview.png` — a clean rasterised PNG renders identically everywhere and is a more faithful preview of the actual TUI.

### Internal

- New module `src/lib/scan-cache.ts` (schema-versioned JSON cache, atomic write, age-based expiry, `REPOGARDEN_SCAN_CACHE` override). New module `src/lib/workbench-mode.ts` (centralises the PORTRAIT/NOTES visibility predicate so the hidden subtree consistently skips keystroke handling). New `restartSparkline` / `restartLog` / `dirtyPorcelain` async helpers in `src/lib/scanner.ts` driving the bounded-pool phases. `scripts/bench-scan.ts` provides a runnable perf check against any directory of repos. `cli.tsx` switches its scan accumulator from an array to a `Map<path, ScannedRepo>` so all four phase emissions patch the same row; `scanProgress` tracks phase 2 (enrichment) completion only.
- New `Mood` type and `inferMood` function in `src/lib/vibe.ts` (extends `VibeResult` with `mood`, `confidence`, `moodReason` — additive, no consumer churn). New `MOOD_PRECEDENCE` constant. New `mood-changed` entry in `JOURNAL_EVENT_KINDS`; `SnapEntry` extended with optional `mood?: Mood` and `moodAt?: string` (legacy snapshots round-trip via the existing normalizer). `reconcileWithSnapshot` in `src/lib/creature.ts` gated emission on `confidence ≥ 0.7` AND `now - prev.moodAt ≥ 24h`; snapshot always tracks current mood, `moodAt` advances only on emission. New `moodTransitionVerb` helper + 18 mapped transitions in `src/lib/event-summary.ts`. New `MOOD_CHIP_CONFIDENCE_THRESHOLD` (0.65) + `moodChipSeverity` table in `src/lib/portrait.ts`.
- New `splitGraphemes` / `sliceGraphemes` / `graphemeLength` / `applyBackspace` / `applyForwardDelete` helpers in `src/lib/editor-buffer.ts`. New `text-area.test.ts` covers grapheme boundary stepping and the backspace freeze regression. New `workbench-mode.test.ts` covers the cross-mode visibility predicate.
- `.github/ISSUE_TEMPLATE/friend_alpha_feedback.md` removed (the template was auto-attaching the now-retired `friend-alpha` label to every new issue) along with the `friend-alpha` GitHub label and the friend-alpha mention in the `pack-smoke` CI comment. Demo-capture workflow documented in `CONTRIBUTING.md` with a new "Capturing the README demo" section pointing at `tape/README.md` (closes #10).
- Supported-versions table in `SECURITY.md` advanced from the stale `0.2.x` to `0.6.x`.
- Test count: 356 → 443.

## [0.5.0] — 2026-05-14

### Changed

- **Vibe vocabulary renamed** for clarity: `noisy → awake` (recent local changes — the optimum/most-engaged state) and `blocked → stuck` (user-flagged blocker). `happy` (clean + in sync) and `sleepy` (long quiet) unchanged. Shelf display order flipped so `awake` sits at the top — the shelf reads top-down as "most engaged → least." Existing journals and scan snapshots written under the old vocabulary keep rendering correctly: `loadScanSnapshot` migrates `"noisy"`/`"blocked"` on read, and `event-summary.ts` normalises legacy `from`/`to` payloads before looking up the transition verb.
- **`fakeName` mixes casing styles** alongside word count. Output is now ~50% kebab (`plum-thistle`), ~20% PascalCase (`PlumThistle`), ~20% camelCase (`plumThistle`), ~10% capitalised-kebab (`Plum-thistle`). Reads more like the spectrum of real repo names instead of a visibly templated set. Composition stays grammatical (noun alone, adj+noun, adj+adj+noun) and the 20/60/20 word-count split is unchanged.

### Fixed

- **Wandering creatures no longer overlap a dragged neighbour once it settles.** `resolvePushPlacements` now initialises its simulation from each creature's *rest* position (anchor + persistent/manual offset, with the transient wander bob stripped), so a drag past a wanderer mid-cycle doesn't get certified clear only to collide once the wander envelope returns to zero. `syncVisualPlacements` also gained a Chebyshev-ring nearest-clear-cell search that fires before the bare-anchor fallback, so a wanderer whose anchor was claimed by a manual offset gets nudged out of the way instead of silently landing on top.
- **Shelf vibes no longer bleed into each other when one bucket overflows.** `lineUpCreatures` was rewritten with proportional vertical allocation: each vibe gets `ceil(count / cols)` rows trimmed against the canvas budget, with a min of 1 row per rendered shelf. Tiles beyond the budget collapse into a single `+N more` indicator painted in the shelf's accent colour. Pre-fix, a happy bucket of 30 repos on a tight canvas would wrap past its strip and crash into the next vibe's divider; the bug also masked a `nudgeRow` interaction where dead-zone hops shifted tiles vertically but not the divider plan.
- **Shelf centring drops to left-align when it would clip the focus card.** Partial rows are still centred by default, but the row offset zeroes out when the centred slot's right edge would intersect the bottom-right dead zone. Slots that still collide fold into the same `+N more` tally rather than getting hopped into the next vibe's rows.

### Added

- **Pagination toggle + density setting.** Two new persistent settings in `~/.repogarden/tui.json`:
  - `gardenPaginate` (default `true`) — when off, the whole creature list lands on one page and the placer's graceful-degradation handles dense packing. For users who like seeing every repo at once instead of paging through.
  - `gardenDensity` (`"cozy" | "comfortable" | "dense"`, default `"comfortable"`) — controls per-page slot dims in garden mode and per-cell breathing room in shelf mode. `comfortable` matches the pre-0.5.0 visuals exactly; `cozy` is roomier (fewer per page / row), `dense` is tighter (~50% more before pagination kicks in). Threaded through `gardenPageCapacity` and `lineUpCreatures`.
  - Settings UI: `p` toggles pagination, `g` cycles density. Both render their current state next to `m`/`u`/`o` in the preferences panel.
- **Mask wordlists expanded** with new texture / sound / scent adjectives (`muffled`, `whispery`, `loamy`, `piney`, `peachy`, `sage`, …) and time-of-day / water creature / textile nouns (`gloaming`, `dawnling`, `pollywog`, `eft`, `bobbin`, `darning`, …). `ADJECTIVES` 140 → 206, `NOUNS` 145 → 225. Duplicate `"ember"` deduped from `NOUNS` (it sat in both the lantern group and the kindling group).
- **Demo roster doubled** from 16 to 32 names (`acorn-rs`, `sprout-db`, `mothbot`, `reed-cli`, `driftlog`, `pebble-ci`, `clover-api`, `ripple-cms`, `nestwatch`, `twig-deploy`, `garden-lint`, `puddle-map`, `wrenpress`, `loamkit`, `lichen-sync`, `dawnqueue`). `buildDemoNameMap` now won't hit the `-2` cycle suffix until 33+ creatures, and the settings preview garden fills the shelf with a more populated cast. `DEMO_BRANCHES` 10 → 16, `DEMO_SUBJECTS` 16 → 32, `DEMO_AUTHORS` 6 → 10 to keep per-id hashing variety proportional.

### Internal

- New `restPlacementFor` helper in `src/garden/model.ts` (anchor + `effectivePersistentOffset`, transient `currentOffset` deliberately excluded). New `findNearestClearPlacement` walks Chebyshev rings outward from a base placement, bounded by canvas dimensions. `resolvePushPlacements` initialises its `placements` map via `restPlacementFor` rather than `visualPlacements.get(...)` so push decisions don't rely on transient wander bob.
- New `ShelfOverflow` type in `src/lib/garden-layout.ts`; `ShelfLayout.overflows` carries `{ vibe, canvasRow, canvasCol, slotW, hidden }` per shelf that truncated. `GardenScene` plumbs the array through to `renderGardenFrame`, which paints each `+N more` marker in `dividerLabelColor(vibe)` and clips the label to `slotW`. `placeCreatures` (organic mode) returns `overflows: []` for type compatibility.
- New `migrateLegacyVibe` helper in `src/lib/events.ts` runs in `normalizeSnapEntry` to coerce `"noisy" → "awake"` and `"blocked" → "stuck"` at snapshot read time. New `normaliseLegacyVibe` in `src/lib/event-summary.ts` runs before the `vibeTransitionVerb` switch so historical `vibe-changed` events still hit the right verb (`got busy`, `back in flow`, etc.).
- `Vibe` type is now `"awake" | "happy" | "stuck" | "sleepy"`. `VIBE_ORDER` is `["awake", "happy", "stuck", "sleepy"]`. The canonical creature sort in `src/lib/creature.ts` and the post-save resort in `cli.tsx` mirror that order. `VIBE_WANDER` / `VIBE_WIGGLE` keys, `dividerLabelColor`, `vibeBadgeVariant`, and the per-screen colour ternaries in `ReadyShell.tsx` / `JournalView.tsx` / `SettingsScreen.tsx` were updated in lockstep. `JournalView` keeps the colour mapping permissive against unknown future vibe strings via the `vibeTarget` typed signal alone.
- New `GardenDensity` type exported from `src/lib/garden-layout.ts`; consumed by `gardenPageCapacity`, `lineUpCreatures`, `GardenSceneProps.density`, and the new settings flow. Per-density tables: `SHELF_EXTRA_PAD` and `PAGE_SLOT_DIMS`. `comfortable` matches the pre-0.5.0 constants so the default visual is unchanged.
- New tests: `loadScanSnapshot migrates legacy noisy/blocked vibe strings on read` (events) writes a snapshot file directly with the pre-rename vocab and asserts the loader normalises. `vibe-changed with legacy noisy/blocked payloads still renders a transition verb` (event-summary) exercises the call-site normaliser. `lineUpCreatures emits a +N more overflow indicator` and `lineUpCreatures keeps shelves from overlapping each other vertically` cover the proportional-allocation invariants. `fakeName covers each casing style across many ids` samples 1000 names and asserts each style bucket lands. `gardenPageCapacity returns more creatures per page at dense than at cozy`, `gardenPageCapacity default density matches explicit comfortable`, and `lineUpCreatures dense density fits more creatures per shelf row than cozy` cover the new density knob. Test count: 345 → 356.
## [0.4.0] — 2026-05-13

### Fixed

- **Mask mode now redacts the scan-root paths** shown under the garden and in the multi-root scan progress UI. Pre-fix, hitting `m` to mask names left the configured base directories visible in plaintext, leaking the same path information the per-repo masking was hiding.
- **Journal vibe-change entries read as transitions, not status snapshots.** Each `from → to` pair now picks a verb that describes the change (`back in flow`, `hit a blocker`, `wound down`, `settled`, `back at it`, `stirred`, …) instead of falling through to the destination state. Pre-fix, `blocked → happy` rendered as `happy: clean`, which read like a status line. The reason text gets a small cleanup pass too: the redundant `blocker:` prefix is stripped when the verb already says it, and trailing periods are dropped before the em-dash join.
- **Garden creature labels no longer collide with neighbouring sprites.** Placement now sizes each grid slot to fit the *full* footprint (sprite body + rendered name label), and reserves room for the label row below each sprite. Pre-fix, two sprites whose bodies didn't overlap could still have their name labels painted over each other or into an adjacent sprite, and a long name on row N could clip into the sprite on row N+1.
- **Wandering creatures no longer land on dragged neighbours.** `syncVisualPlacements` now resolves manually-offset creatures first so wanderers iterated before them check against the dragged neighbour's actual visual position, not an anchor footprint that excluded it.

### Added

- **Per-repo activity drives animation cadence.** A continuous 0–1 activity scalar derived from "days since last commit" (7-day half-life exponential decay) now biases each creature's wiggle frame-cycle and wander idle gaps within its vibe-bucket's range. Fresh-commit repos sit at the fast end of their cadence range with full drift radius; long-quiet repos sit at the slow end with ~25% drift. A repo blocked by a current `blocker` note still gets its activity from commit recency, so a freshly-broken build keeps bustling visibly while a stalled-for-a-month one barely moves.
- **Closed eyes + blink animation.** Awake creatures keep their original sub-pixel-derived eye look (the corner-cut quadrant chars from the body grid). Sleepy creatures and the brief blink window for awake creatures paint a face panel: a body-coloured cell with `▂` (lower one-quarter block) cut into it as a closed eyelid. Each awake creature blinks briefly every 3.5–7s (interval shrinks with activity) on a per-identity phase so the swarm doesn't blink in unison. Reduced-motion mode skips the blink entirely. Sleepy creatures hold their body at rest — no bob — so the closed eye sits on a stationary face; awake creatures still bob and the eye cells track the per-frame shift. Sprite generation guarantees at least one cell of body between the two eyes (so closed-eye glyphs read as two distinct eyes, not one connected bar) and at least one cell row of body below the eye row (so the closed-eye glyph sits on a face instead of dangling).
- **Background observer** for live commit + new-repo backfill. `fs.watch` on each repo's `.git/logs/HEAD` catches commits / amends / pulls / resets within ~250 ms; a non-recursive watch on each scan-root catches new repos dropped into a tracked folder within ~500 ms. The existing 30 s safety-net poll still runs underneath so updates arrive on filesystems where `fs.watch` is unreliable. Default-on; the settings screen exposes `o` as a persistent toggle, and `REPOGARDEN_DISABLE_OBSERVER=1` still wins for single-run launches. Closes the §4.1 "flagged for recovery" item in `docs/legacy-not-ported.md`.
- **Pull from the workbench** (fast-forward only). PORTRAIT exposes `u` as a two-press confirm (first arms, second runs); the command palette has a "pull from remote" entry that runs immediately. Result lands as a sticky banner on failure / non-zero and as a transient success banner otherwise. Preflight blocks the action when the tree is dirty, HEAD is detached, the branch has no upstream, or scan errored. Each attempt appends a `pull` event to the journal — payload carries `ok`, `exitCode`, `branch`, `beforeSha`, `afterSha`, `commitsPulled`, `summary`, `durationMs`, `timedOut`. Closes the §7.3 "flagged for recovery" item in `docs/legacy-not-ported.md`.

### Internal

- New `computeActivity` + `ACTIVITY_HALF_LIFE_DAYS` exports in `src/lib/vibe.ts`; `VibeResult` now carries `activity: number`. `buildWiggleProfile` and a new per-creature `WanderProfile` (built once in `createWanderState` and stored on `GardenWanderState`) replace the previous direct `VIBE_WANDER` reads in step functions, so activity-baked timing flows through the whole tick path without re-resolving on every frame.
- `generateCreatureFrames` now returns `eyeCells: { left, right }` alongside frame data. `GardenSpriteInfo` carries those cells plus an `eyesClosed` flag (gated on `vibe === "sleepy"` in `buildScene`) and a per-creature `BlinkProfile` (interval scales with activity, randomised phase). The render loop in `src/garden/render.ts` only short-circuits to a composited face panel (`{ char: "▂", fg: theme.background, bg: info.body }`) when eyes should be shut (sleepy or in the blink window); otherwise the body grid's natural quadrant char paints unchanged. New `blinkClosedAt` helper in `src/garden/model.ts` returns the closed/open state from `(now + phaseMs) % intervalMs`.
- New `spriteFullFootprint` helper in `src/lib/garden-layout.ts` covers the rendered name label below each sprite; `placeCreatures` now sizes slots from `max(maxSpriteCols, maxLabelCols)` horizontally and `maxSpriteRows + NAME_GAP_ROWS + NAME_H` vertically. `syncVisualPlacements` in `src/garden/model.ts` resolves manually-offset placements first so wanderers see their actual visual positions. New `vibeTransitionVerb` + `trimVibeReason` helpers in `src/lib/event-summary.ts` cover all 12 from-to transitions with a defensive fallback for unknown vibe pairs. Test count: 318 → 345.
- New module `src/lib/observer.ts` (per-handle debounce, watch budget cap at 150, error-tolerant per the `subscribeToEventsFile` pattern). New `observer` field on `TuiConfig` and `observerEnabled()` helper honoring the env override. cli.tsx adds one `useEffect` keyed on the *set* of repo paths so commit-driven state updates don't churn the watcher list.
- New module `src/lib/git-pull.ts` (async `git pull --ff-only` with 60 s timeout, line-streaming `onLine` callback, and small sync sha helpers). New event-summary kind `pull`. New single-repo refresh helper `refreshOneCreature` in `src/lib/creature.ts` re-inspects one repo and re-runs `enrichScans` so the snapshot reconcile fires.
- **Contributor workflow migrated from npm to pnpm** (pinned via `packageManager: "pnpm@10.32.1"`). `package-lock.json` removed; `pnpm-lock.yaml` is the lockfile. CI (`.github/workflows/ci.yml`) runs `pnpm install --frozen-lockfile` and pnpm scripts; the pack-smoke job still installs the produced tarball with `npm install -g` so the same path real users hit (`npm install -g @outsideheaven/repogarden`) stays exercised. `prepare` and `prepack` now inline the build command instead of calling `npm run build`, so neither lifecycle hook depends on a particular package manager being present. `chalk@^5.6.2` is now a declared direct dependency (was previously imported by `src/garden/diff.ts` but only available via npm's hoisted layout).

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
