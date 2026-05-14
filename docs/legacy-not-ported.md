# Legacy desktop features not ported to the TUI

A record of what the original Tauri/Vite/Pixi desktop client did, and which pieces the TUI consciously chose to leave behind, rebuild, or postpone.

The legacy desktop tree is not included in the public alpha. Entries marked `DROPPED *for now*` or `PARTIAL *for now*` are flagged for recovery — see the "Flagged for recovery" list at the bottom. Other DROPPED items are tied to the desktop / browser substrate (Pixi, SQLite, Playwright, etc.) and aren't expected to return.

For each item: **Was** (v1 behavior + path), **TUI** (PORTED / PARTIAL / DROPPED + closest current file), **Why**.

## 1. Habitat / world rendering (Pixi, WebGL)

### Pixi habitat world
- **Was:** the home scene rendered as a 2D Pixi canvas with creatures placed on shelves and a derived biome backdrop. `legacy/src/components/HabitatWorld.tsx`, `legacy/src/components/habitatWorld/{renderer,surfaces,backdrop}.ts`.
- **TUI:** PARTIAL. The garden is still a 2D scene — creatures occupy terminal cells with organic or shelf placement (`src/screens/GardenView.tsx` + `src/lib/garden-layout.ts`) — but rendered via Ink text cells instead of a Pixi canvas.
- **Why:** The 2D habitat concept survived the move to the terminal; what was dropped was the Pixi/WebGL renderer, not the spatial idea. The product vision (home scene fades into a developer's flow) made a heavy graphical canvas the wrong substrate anyway.

### Biome theming
- **Was:** algorithmic `consoleBlue` biome (speck count + seed) derived from project composition. `legacy/src/components/habitatBiome.ts`.
- **TUI:** PARTIAL. The `consoleBlue` speck biome was dropped, replaced by a starry-sky backdrop with bloom cycles in `src/garden/stars.ts` + `src/garden/render.ts`. The new backdrop is scene-seeded but not derived from project composition.
- **Why:** A composition-derived speck field was visual flavor specific to the Pixi canvas. The starry sky fills the same "the world is alive" role in a way terminals can render natively.

### Spatial habitat layout
- **Was:** ~1k-line layout engine handling shelf grouping (awake / stirring / dozing / sleeping), creature radius, collision avoidance, caption footprint, natural scaling by mass tier. `legacy/src/components/habitatLayout.ts`.
- **TUI:** PARTIAL. `src/lib/garden-layout.ts` keeps shelf grouping (now by the 4 vibes: happy / noisy / blocked / sleepy, with the blocked shelf always shown), sprite footprint/overlap math (`spriteBodyFootprintsOverlap`), dead-zone hopping for the focus card, and cohort-relative sizing via `src/lib/sprite.ts` `buildCreatureSizeCohort`. The legacy mass-tier scaling, caption-footprint reservations, and `awake/stirring/dozing/sleeping` shelves were dropped along with the richer status model.
- **Why:** Shelf grouping by liveliness is the part that answers "what's alive right now?" at a glance; the legacy four-state status model was the part driving Pixi-specific motion/animation.

### Emotion playback + motion model
- **Was:** tween-driven emotion cycles (blink, excited, anxious, confused, proud, lonely) plus per-creature energy / presence / motion-amplitude / cadenceMs derived from heuristics. `legacy/src/components/habitatWorld/emotionPlayback.ts`, `legacy/src/features/inference/projectHeuristics.ts`.
- **TUI:** DROPPED *for now*. The TUI has a 4-state vibe (happy / blocked / noisy / sleepy) in `src/lib/vibe.ts` and a single sprite per creature. Selectively bringing some emotion cues back is on the table — not committed, no concrete design yet.
- **Why:** Smooth tweened motion has no terminal analog, and the full mood/energy axes were the most "video-game"-shaped part of v1. A narrower terminal-native subset (e.g., blink, momentary excited/anxious cues) might still earn its keep.

### Caption renderer (mood bubbles, quick summary)
- **Was:** in-canvas labels positioned next to each sprite — status, mood, mood confidence, emotion cue, quick summary, bubble text. `legacy/src/components/habitatWorld/captionRenderer.ts`.
- **TUI:** PARTIAL *for now*. The same information lives in the workbench portrait (`src/lib/portrait.ts`, `src/screens/WorkbenchScreen.tsx`), not floating next to the sprite. Bringing some in-garden captions/bubbles back is on the table — pending design.
- **Why:** Floating labels next to terminal-cell sprites are tractable (the row layout has slack), so this isn't a permanent drop — it's a "the workbench earns its keep first, garden captions come back once they have a concrete shape."

### Placement persistence
- **Was:** users could drag creatures to specific (xRatio, yRatio) positions in the habitat, persisted via Tauri IPC and localStorage. `legacy/src/components/habitatWorld/placementPersistence.ts`, command `set_creature_habitat_position`.
- **TUI:** PORTED. Creatures can be dragged in the garden and their offset is persisted per-repo as `gardenPlacement.{offsetX, offsetY}` in `src/lib/memory.ts` (under `~/.repogarden/repos/<id>/memory.json`). Cohort sort still drives the default layout; the offset is a user-applied override on top of it.
- **Why:** Default ordering is still data-driven (no manual upkeep required), but users who want to arrange the garden can.

### Pointer / drag interaction
- **Was:** pointer hit-testing on sprites, drag-to-reposition, context-menu positioning that respected creature clearance. `legacy/src/components/habitatWorld/interaction.ts`.
- **TUI:** PORTED. Mouse click / select / scroll / drag-to-reposition via `src/lib/mouse.ts` + `src/hooks/use-mouse.ts` + `src/garden/engine.ts`. Context-menu clearance specifics (legacy positioned right-click menus around creature radius) don't apply — the TUI uses the workbench instead.

## 2. Creatures

### Pixel-art Invader sprite generator
- **Was:** 2-frame pixel sprites from 8 families (compact / broad / towering / spiky), mass-tier-driven, with mirrored symmetry, probabilistic carving / feet / antennae / crests. `legacy/src/features/creatures/invaderGenerator.ts` + `palette.ts` + `size.ts` + `spriteVariant.ts`.
- **TUI:** PARTIAL. Rebuilt in `src/lib/sprite.ts` as a sub-pixel contour pipeline with 8 named species (beetle / bell / crab / moth / mantis / drop / shield / jelly) using ▟▛▞▚ to compose sloped shoulders, curved heads, tapered bottoms. The mulberry32 RNG + FNV-1a hash from `legacy/src/features/creatures/hash.ts` carried over verbatim. Mass-tier scaling carried over; faces / palettes / dual-frame variants did not.
- **Why:** Terminal cells are coarse, so anatomy now reads at the macro silhouette level rather than at the pixel level. Dual-frame animation has no terminal analog.

### Face expressions, blink + mood cycles
- **Was:** per-creature blink (220ms, every 4.8–7.2s) and mood cycles (3.6s, every 7.6–11.2s), face cutout rectangles, eye footprint, guard pixels. `legacy/src/features/creatures/faceExpression.ts`.
- **TUI:** DROPPED. Faces are static glyph picks (eye / mouth from a fixed vocabulary).
- **Why:** Animation tied to a Pixi ticker; no equivalent in Ink.

### Sprite color palette
- **Was:** per-creature palette selection for the canvas. `legacy/src/features/creatures/palette.ts`.
- **TUI:** PORTED. `pickSpriteColors` in `src/lib/sprite.ts` picks a vibe-anchored theme token (happy→success/accent, noisy→warning/accent, blocked→error/warning, sleepy→info/accent) and applies a deterministic ±20° hue rotation + lightness jitter in HSL space so repos within the same vibe stay thematically related but stay visually distinct. Seeded by the existing identity hash + mulberry32, so a creature's body color is stable until its vibe shifts. Saturation/lightness floors keep sprites legible against the terminal background even on muted themes.

## 3. Workbench / context menu / per-repo surface

### CreatureContextMenu (right-click)
- **Was:** 14KB pixel-art right-click menu with status label, memory cues, inspiration prompts, latest commit, resume trail, and pull / transform / hide actions positioned with creature clearance. `legacy/src/components/CreatureContextMenu.tsx`.
- **TUI:** PARTIAL. The same actions are reachable via dedicated keys in the garden view and the command palette / portrait actions in `src/screens/WorkbenchScreen.tsx` + `src/lib/portrait.ts`.
- **Why:** Right-click menus don't belong in a terminal. The workbench is the right surface for "do something to this repo."

### Pixel SVG icon set
- **Was:** 8 hand-drawn SVG icons (open-folder, visibility on/off, git-pull, copy-path, chevrons, close, transform). `legacy/src/components/PixelIcon.tsx`.
- **TUI:** DROPPED. Replaced by Unicode symbols where needed.
- **Why:** SVG doesn't render in a terminal.

### Inspiration prompts (curated action list)
- **Was:** ~20–30 hard-coded prompts ("Start here", "Fix a bug", "Write a test", ...) shown in the context menu. `legacy/src/features/inference/inspiration.ts`.
- **TUI:** DROPPED in favor of vibe- and blocker-derived action hints in `src/lib/portrait.ts` (`buildPortraitActions`).
- **Why:** A generic curated list rotted faster than a derivation. The TUI version says "you have an open blocker, X file changed today" instead of "Write a test."

### Resume trail breadcrumb
- **Was:** "last action" hint extracted from the continuity log. `legacy/src/features/inference/resumeTrail.ts`.
- **TUI:** PARTIAL. Equivalent hints come from the portrait actions, the per-repo `note-to-future-self`, and the journal timeline (`src/lib/journal.ts`, `src/screens/JournalView.tsx`).

## 4. Project registry & scanning

### Tauri scan + observer pipeline
- **Was:** Rust-side recursive repo discovery + commit observer for backfilling new repos, exposed via `scan_projects`, `load_projects`, `observe_visible_commits`, `recover_from_scan`. `legacy/src-tauri/src/scanner.rs`, `legacy/src-tauri/src/commands.rs`.
- **TUI:** PARTIAL. `src/lib/scanner.ts` is a Node-side walk that queries git directly (`git ls-files`, `git log`, `git status`). Manual rescan only; the commit observer that backfilled new repos is *pending* — a long-lived watcher (or a daemon mode) is on the table once the CLI lifecycle has a clear story for it.
- **Why:** The user-invoked CLI model is enough for the alpha, but live backfill of new commits / new repos is genuinely useful and the absence is felt — flagged for recovery, not a permanent drop.

### Project registry state machine
- **Was:** centralized registry with autoscan, refresh, save, hide / restore, pull, position changes, emotion-burst queue. `legacy/src/app/useProjectRegistry{Controller,State,Actions}.ts`, `useDesktopObservers.ts`.
- **TUI:** PARTIAL. `src/cli.tsx` keeps local React state and writes per-repo data to filesystem memory (`src/lib/memory.ts`), notes (`src/lib/notes.ts`), and the event journal (`src/lib/events.ts`). Refresh / hide / restore / position changes ported; autoscan + observer + emotion-burst queue did not, and the first two are tied to the pending observer work above.
- **Why:** Journal-as-source-of-truth + manual refresh is the right alpha shape; once the observer pipeline lands, the registry will grow back the autoscan/refresh-on-event behaviors it lost.

### Hidden projects
- **Was:** hidden-repo IDs persisted via Tauri DB + localStorage fallback.
- **TUI:** PORTED. Stored in per-repo memory (`ProjectMemory.hidden`).

### Active scan roots
- **Was:** persisted list of directories to scan, in SQLite + localStorage.
- **TUI:** PORTED. Stored in `~/.repogarden/config.json` (`src/lib/config.ts`).

## 5. Inference

### Project heuristics (status + mood + emotion + motion)
- **Was:** ~22KB module deriving ProjectStatus (awake / stirring / dozing / sleeping), ProjectMood (curious / excited / sleepy / anxious / confused / proud / lonely) with confidence, ProjectEmotionCue, ProjectEmotionBurst, plus energy / presenceScale / motionAmplitude / cadenceMs. `legacy/src/features/inference/projectHeuristics.ts`.
- **TUI:** PARTIAL *for now* — flagged for recovery. `src/lib/vibe.ts` collapses to four states (happy / blocked / noisy / sleepy) derived from `lastCommitAt`, dirty state, ahead count, and the user's blocker field. Bringing back richer mood / emotion-cue / confidence axes is wanted, paired with the emotion-playback recovery in §1.4.
- **Why:** The 4-state vibe is the floor — enough to answer "is this repo alive right now?" — but the richer inference model carries information the alpha is losing. Re-introducing mood + confidence (without the motion/animation cost) is on the roadmap.

## 6. Persistence

### SQLite schema + migrations
- **Was:** Rust-side SQLite database with migrations 0001–0004 — `scan_roots`, `projects`, `project_memory`, `project_events`, `project_sessions`, `app_state`, plus columns for incoming / outgoing / push / ship / needs-pull / remote-warning signals and first-commit / total-commit / recent-burst / changed-files / TODO / FIXME counts. `legacy/migrations/`.
- **TUI:** DROPPED. Replaced by JSON-on-disk: per-repo memory + notes under `~/.repogarden/repos/<id>/`, append-only event log at `~/.repogarden/events.jsonl`, app config at `~/.repogarden/config.json`. Atomic writes via temp-file + rename in `src/lib/notes.ts`.
- **Why:** SQLite required Tauri and a migration runner. Plain files are inspectable, diffable, and survive corruption by definition. Signal columns and session tracking were observability for the desktop animation loop — without that loop, they had no consumer.

### Startup recovery (DB corruption fallback)
- **Was:** `recoveryRequired` state that detected DB corruption and triggered a filesystem rescan. `legacy/src/app/useStartupRecoveryController.ts`, command `recover_from_scan`.
- **TUI:** DROPPED. With no DB there's nothing to recover from; a missing or malformed JSON file is handled in-line by the reader.
- **Why:** The whole class of failure went away with SQLite.

### Persistent options
- **Was:** tiny on / off / blocked / unavailable label map for desktop UI controls. `legacy/src/lib/persistentOptions.ts`.
- **TUI:** DROPPED. Superseded by the config + settings screen.

### `prefers-reduced-motion`
- **Was:** honored the OS-level CSS media query to disable animations. `legacy/src/app/usePrefersReducedMotion.ts`.
- **TUI:** PORTED. A `reducedMotion` flag lives in `~/.repogarden/tui.json` and is toggled with `m` on the settings screen; when on: star bloom + brightness flicker freeze and the slow starfield origin drift stops (`src/garden/stars.ts`, `src/garden/render.ts`); creature sprite wiggle holds frame A; per-creature wander offsets and the garden↔shelf placement tween are suppressed (`src/garden/model.ts`); the ReadyShell garden/shelf/journal view-transition dither and the garden↔shelf hold are skipped (`src/screens/ReadyShell.tsx`). `NO_MOTION=1` and `CI=true` still seed the initial value via `isReducedMotion()` in `src/components/ui/theme-provider.tsx`. Future emotion cues will read the same `useMotion()` context.

## 7. Tauri IPC / desktop chrome / native integrations

### 30+ Tauri commands
- **Was:** `scan_projects`, `refresh_git_status`, `observe_visible_commits`, `save_project_memory`, `set_project_hidden_state`, `set_creature_habitat_position`, `get_project_continuity`, `pull_project_updates`, `install_agent_notes_instructions`, `agent_notes_bridge_status`, `open_repo_path`, `open_app_data_dir`, `recover_from_scan`, etc. `legacy/src/lib/tauri.ts`, `legacy/src-tauri/src/commands.rs`.
- **TUI:** PARTIAL. The IPC layer itself is gone — the TUI runs as a Node process and calls git / xdg-open directly. Individual capabilities are tracked per-entry above and below (scan/observer §4.1, registry/memory/hide/position §4.2–§4.3, pull §7.3, .agents bridge §7.2, open paths / clipboard §7.4, recovery §6.2).

### Agent-notes bridge (`.agents` scaffold installation)
- **Was:** desktop command that installed `.agents/` + `.notes` scaffolding and `.gitignore` entries into scanned repos to support Claude instructions. `legacy/src-tauri/src/integrations/`.
- **TUI:** DROPPED. Users manage `.agents` themselves.
- **Why:** A desktop app could justify "I'll set up your repo for you"; a CLI invoked inside that repo should not silently mutate it.

### Pull updates from inside the app
- **Was:** `pull_project_updates` command that ran `git pull` on a target repo via the Tauri shell.
- **TUI:** PORTED (fast-forward only). The PORTRAIT view exposes `u` as a two-press confirm (first press arms, second press runs); the command palette has a "pull from remote" entry that runs immediately because the palette gesture is already deliberate. Pulls run `git pull --ff-only` via `src/lib/git-pull.ts` with a 60 s timeout, surface the result as a sticky banner on failure / non-zero, and append a `pull` event to the journal (`{ ok, exitCode, branch, beforeSha, afterSha, commitsPulled, summary, durationMs, timedOut }`). Preflight blocks the action when the working tree is dirty, HEAD is detached, the branch has no upstream, or scan errored — the user sees a warning banner instead of a half-state pull.
- **Why:** Read-only stayed the alpha default until the path back was an explicit, confirmed action with visible output. `--ff-only` is the conservative starting point — divergent histories fail with the real git message instead of dropping the user into a merge state they can't see from inside the TUI. Rebase / merge strategies are deferred; non-ff-only flows belong on a follow-up slice if they earn their keep.

### File-system + clipboard shell integrations
- **Was:** `open_repo_path`, `open_app_data_dir`, clipboard read/write.
- **TUI:** PORTED. `src/lib/system.ts` (open in file browser via xdg-open / `open` / `explorer`) and `src/lib/clipboard.ts` (pbcopy / xclip / wl-copy).

## 8. Testing surface

### Vitest + React Testing Library integration tests
- **Was:** 5 test files exercising the App component end-to-end — `App.continuity.test.ts`, `App.hidden-repos.test.ts`, `App.repo-mass.test.ts`, `App.revive-queue.test.ts`, `App.startup-recovery.test.ts`.
- **TUI:** PARTIAL. The TUI has 21 unit / module test files under `src/__tests__/` (sprite, garden-layout, garden-runtime, mouse, journal, portrait, notes, editor, scanner, clipboard, vibe, …) but no Ink-level App-shell integration suite that drives the rendered TUI end-to-end.
- **Note:** App-shell / Ink integration coverage is the explicit gap; a future slice could add Ink-level integration tests on top of the existing unit suite.

### Smoke harnesses (`DenseSceneSmokeHarness`, `MenuCompositeSmokeHarness`)
- **Was:** isolated harnesses for stress-testing the Pixi habitat and context menu positioning.
- **TUI:** PORTED. `src/__tests__/garden-runtime.test.ts`, `garden-layout.test.ts`, and `responsive-layout.test.ts` cover the equivalent dense-scene / layout failure modes for the terminal renderer. Menu-composite smoke didn't carry over because the right-click menu is gone (§3.1) — its positioning failure mode has no analog in the workbench.

### Playwright config
- **Was:** headless-browser config left in place after Tauri.
- **TUI:** DROPPED. No browser surface to test.

## 9. Misc

### Nerd Fonts subset
- **Was:** `legacy/third_party/nerd-fonts-symbols-only-v3.4.0/` shipped a font for desktop icon glyphs.
- **TUI:** DROPPED. The TUI uses whatever the user's terminal font provides.

### App-shell screens (`AppShellHeader`, `AppRailPanels`, `AppReadyShell`, `AppScreens`, `AppLoadingScreens`, `AppHabitatSurface`)
- **Was:** React component hierarchy for the desktop layout — header, left rail, canvas surface, loading state machine.
- **TUI:** PARTIAL. Rebuilt as modal screens in `src/screens/` (BootScreen, OnboardingScreen, ReadyShell, GardenView, JournalView, WorkbenchScreen, SettingsScreen, HelpOverlay).

### App interaction state (tooltips, drag, transform mode)
- **Was:** centralized UI state hook for tooltips, drag, creature transform mode. `legacy/src/app/useAppInteractionState.ts`.
- **TUI:** DROPPED. The legacy hook's state shape is gone. Drag came back independently (see §1.6 / §1.7) inside `src/garden/engine.ts` rather than via a single shared hook; tooltips and transform mode have no analog and stayed dropped.

## Notable gaps worth tracking

Items the TUI is missing today. Split between **flagged for recovery** (we want these back, design pending) and **trade-offs** (intentional differences from the desktop model).

### Flagged for recovery

1. **Emotion / motion cues** (§1.4) — narrower terminal-native subset of mood + emotion-cue + confidence, paired with §5.1.
2. **In-garden captions / bubbles** (§1.5) — some sprite-adjacent info, not just workbench-only.
3. **Richer project heuristics** (§5.1) — mood / confidence axes beyond the 4-state vibe.
4. **Background observer** (§4.1) — live backfill of new commits / new repos; ties into §4.2 (autoscan, refresh-on-event).
5. **App-shell / Ink integration tests** (§8.1) — end-to-end coverage on top of the existing unit suite.

### Trade-offs (not coming back)

- **Event log richness.** The legacy schema tracked push / ship / needs-pull / remote-warning signals plus TODO / FIXME counts and a recent-burst window. The TUI journal records commits / blockers / notes / vibe / repo / branch events but not the git-signal subtypes.
- **Tween-driven animation, face cycles, SVG icons, Nerd Fonts, Playwright, SQLite + migrations.** Tied to the desktop / browser substrate; replaced or unneeded.

None of the recovery items block the alpha — they're flagged so future-us doesn't forget they were intentional pauses, not deletions.
