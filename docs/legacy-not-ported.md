# Legacy desktop features not ported to the TUI

A record of what the original Tauri/Vite/Pixi desktop client did, and which pieces the TUI consciously chose to leave behind, rebuild, or postpone.

The legacy desktop tree is not included in the public CLI line. Entries marked `DROPPED *for now*` or `PARTIAL *for now*` are flagged for recovery — see the "Flagged for recovery" list at the bottom. Other DROPPED items are tied to the desktop / browser substrate (Pixi, SQLite, Playwright, etc.) and aren't expected to return.

For each item: **Was** (legacy desktop behavior + path), **TUI** (PORTED / PARTIAL / DROPPED + closest current file), **Why**.

## 1. Habitat / world rendering (Pixi, WebGL)

### Pixi habitat world
- **Was:** the home scene rendered as a 2D Pixi canvas with creatures placed on shelves and a derived biome backdrop. `legacy/src/components/HabitatWorld.tsx`, `legacy/src/components/habitatWorld/{renderer,surfaces,backdrop}.ts`.
- **TUI:** PARTIAL. The garden is still a 2D scene — creatures occupy terminal cells with organic Garden or vibe-partitioned Rooms placement (`src/screens/GardenView.tsx` + `src/lib/garden-layout.ts`) — but rendered via Ink text cells instead of a Pixi canvas.
- **Why:** The 2D habitat concept survived the move to the terminal; what was dropped was the Pixi/WebGL renderer, not the spatial idea. The product vision (home scene fades into a developer's flow) made a heavy graphical canvas the wrong substrate anyway.

### Biome theming
- **Was:** algorithmic `consoleBlue` biome (speck count + seed) derived from project composition. `legacy/src/components/habitatBiome.ts`.
- **TUI:** PARTIAL. The `consoleBlue` speck biome was dropped, replaced by a starry-sky backdrop with bloom cycles in `src/garden/stars.ts` + `src/garden/render.ts`. The new backdrop is scene-seeded but not derived from project composition.
- **Why:** A composition-derived speck field was visual flavor specific to the Pixi canvas. The starry sky fills the same "the world is alive" role in a way terminals can render natively.

### Spatial habitat layout
- **Was:** ~1k-line layout engine handling shelf grouping (awake / stirring / dozing / sleeping), creature radius, collision avoidance, caption footprint, natural scaling by mass tier. `legacy/src/components/habitatLayout.ts`.
- **TUI:** PARTIAL. `src/lib/garden-layout.ts` keeps vibe grouping as spatial Rooms (awake / happy / stuck / sleepy), sprite footprint/overlap math (`spriteBodyFootprintsOverlap`), dead-zone hopping for the focus card, and cohort-relative sizing via `src/lib/sprite.ts` `buildCreatureSizeCohort`. The legacy mass-tier scaling, caption-footprint reservations, and `awake/stirring/dozing/sleeping` shelves were dropped along with the richer status model.
- **Why:** Spatial grouping by liveliness is the part that answers "what's alive right now?" at a glance; the legacy four-state status model was the part driving Pixi-specific motion/animation.

### Emotion playback + motion model
- **Was:** tween-driven emotion cycles (blink, excited, anxious, confused, proud, lonely) plus per-creature energy / presence / motion-amplitude / cadenceMs derived from heuristics. `legacy/src/components/habitatWorld/emotionPlayback.ts`, `legacy/src/features/inference/projectHeuristics.ts`.
- **TUI:** PARTIAL. The narrow terminal-native subset landed: per-creature blink (`buildBlinkProfile` in `src/garden/model.ts`) and momentary mood-glyph emotion cues (`buildCueProfile`/`cueVisibleAt` in `src/lib/garden-captions.ts`, painted in `src/garden/render.ts`) — deterministic seeded schedules, confidence-gated, capped at 2 cues per frame, off under reduced motion and in exports. The legacy energy / presence / motion-amplitude / cadence axes stay dropped.
- **Why:** Smooth tweened motion has no terminal analog, and the full mood/energy axes were the most "video-game"-shaped part of the desktop client. The subset that earned its keep is the part that reads as chrome cues rather than animation.

### Caption renderer (mood bubbles, quick summary)
- **Was:** in-canvas labels positioned next to each sprite — status, mood, mood confidence, emotion cue, quick summary, bubble text. `legacy/src/components/habitatWorld/captionRenderer.ts`.
- **TUI:** PARTIAL. In-garden mood captions are back in a narrower shape: the *focused* creature gets one `<glyph> <mood> — <moodReason>` line adjacent to its focus frame (`src/lib/garden-captions.ts` + `src/garden/render.ts`), confidence-gated and collision-aware. The fuller per-sprite label set (status, quick summary, free bubble text on every creature) intentionally stays in the workbench portrait — captions on all creatures at once would turn the habitat into a labeled diagram.
- **Why:** The terminal row layout had the slack the legacy renderer exploited; the one-caption-max constraint is what keeps the scene calm where the desktop canvas could afford more.

### Placement persistence
- **Was:** users could drag creatures to specific (xRatio, yRatio) positions in the habitat, persisted via Tauri IPC and localStorage. `legacy/src/components/habitatWorld/placementPersistence.ts`, command `set_creature_habitat_position`.
- **TUI:** PORTED. Creatures can be dragged in the garden and their offset is persisted per-repo as `gardenPlacement.{offsetX, offsetY}` in `src/lib/memory.ts` (under `~/.repogarden/projects/<repo-id>.json`). Cohort sort still drives the default layout; the offset is a user-applied override on top of it.
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
- **TUI:** PORTED. `pickSpriteColors` in `src/lib/sprite.ts` picks a vibe-anchored theme token (happy→success/accent, awake→warning/accent, stuck→error/warning, sleepy→info/accent) and applies a deterministic ±20° hue rotation + lightness jitter in HSL space so repos within the same vibe stay thematically related but stay visually distinct. Seeded by the existing identity hash + mulberry32, so a creature's body color is stable until its vibe shifts. Saturation/lightness floors keep sprites legible against the terminal background even on muted themes.

## 3. Workbench / context menu / per-repo surface

### CreatureContextMenu (right-click)
- **Was:** 14KB pixel-art right-click menu with status label, memory cues, inspiration prompts, latest commit, resume trail, and pull / transform / hide actions positioned with creature clearance. `legacy/src/components/CreatureContextMenu.tsx`.
- **TUI:** PARTIAL. Non-mutating context and navigation actions are reachable via dedicated keys in the garden view and the command palette / portrait actions in `src/screens/WorkbenchScreen.tsx` + `src/lib/portrait.ts`. Repository-changing pull is intentionally dropped (§7.3).
- **Why:** Right-click menus don't belong in a terminal. The workbench is a read-only deep-dive surface for deciding what to do next; repository changes stay in the user's normal git workflow.

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
- **TUI:** PORTED. `src/lib/scanner.ts` is a Node-side walk that queries git directly (`git ls-files`, `git log`, `git status`). The commit observer is now `src/lib/observer.ts`: `fs.watch` on each repo's `.git/logs/HEAD` triggers a single-repo `refreshOneCreature` within ~250 ms of any commit / amend / pull / reset; a non-recursive watch on each scan-root surfaces new repos within ~500 ms. The 30 s light refresh (`refreshCreaturesLight`) stays underneath as a safety net for filesystems where `fs.watch` is unreliable.
- **Why:** The user-invoked CLI model carried the first terminal builds, but live backfill is genuinely useful and the absence was felt. The observer reuses the existing `refreshOneCreature` + `enrichScans` seams so journal events flow through the same path as a manual rescan.

### Project registry state machine
- **Was:** centralized registry with autoscan, refresh, save, hide / restore, pull, position changes, emotion-burst queue. `legacy/src/app/useProjectRegistry{Controller,State,Actions}.ts`, `useDesktopObservers.ts`.
- **TUI:** PARTIAL. `src/cli-main.tsx` keeps local React state and writes per-repo data to filesystem memory (`src/lib/memory.ts`), notes (`src/lib/notes.ts`), and the event journal (`src/lib/events.ts`). Refresh / hide / restore / position changes ported; autoscan-on-commit and new-repo backfill now ride the observer pipeline above. The emotion-burst queue is still dropped (tied to §1.4).
- **Why:** Once the observer landed, the registry got back the autoscan/refresh-on-event behaviors it lost — without the desktop animation queue that wrapped them.

### Hidden projects
- **Was:** hidden-repo IDs persisted via Tauri DB + localStorage fallback.
- **TUI:** PORTED. Stored in per-repo memory (`ProjectMemory.hidden`).

### Active scan roots
- **Was:** persisted list of directories to scan, in SQLite + localStorage.
- **TUI:** PORTED. Stored in `~/.repogarden/tui.json` (`src/lib/config.ts`).

## 5. Inference

### Project heuristics (status + mood + emotion + motion)
- **Was:** ~22KB module deriving ProjectStatus (awake / stirring / dozing / sleeping), ProjectMood (curious / excited / sleepy / anxious / confused / proud / lonely) with confidence, ProjectEmotionCue, ProjectEmotionBurst, plus energy / presenceScale / motionAmplitude / cadenceMs. `legacy/src/features/inference/projectHeuristics.ts`.
- **TUI:** PARTIAL *for now* — flagged for recovery. `src/lib/vibe.ts` now derives four vibe states (awake / happy / stuck / sleepy) from `lastCommitAt`, dirty state, ahead count, and the user's blocker field. It also carries advisory mood (`curious` / `excited` / `proud` / `anxious` / `confused` / `lonely` / `content`) with confidence and a mood reason — now surfaced in-garden via captions and cues (§1.4 / §1.5) — but the richer burst / motion derivation axes remain dropped.
- **Why:** The 4-state vibe is the floor — enough to answer "is this repo alive right now?" — while mood/confidence restores some softer context without bringing back the desktop animation model. Emotion playback still needs a terminal-native shape before it returns.

## 6. Persistence

### SQLite schema + migrations
- **Was:** Rust-side SQLite database with migrations 0001–0004 — `scan_roots`, `projects`, `project_memory`, `project_events`, `project_sessions`, `app_state`, plus columns for incoming / outgoing / push / ship / needs-pull / remote-warning signals and first-commit / total-commit / recent-burst / changed-files / TODO / FIXME counts. `legacy/migrations/`.
- **TUI:** DROPPED. Replaced by JSON-on-disk: per-repo memory + notes under `~/.repogarden/projects/<repo-id>/`, append-only event log at `~/.repogarden/events.jsonl`, app config at `~/.repogarden/tui.json`. Atomic writes via temp-file + rename in `src/lib/notes.ts`.
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
- **TUI:** PORTED. A `reducedMotion` flag lives in `~/.repogarden/tui.json` and is toggled with `m` on the settings screen; when on: star bloom + brightness flicker freeze and the slow starfield origin drift stops (`src/garden/stars.ts`, `src/garden/render.ts`); creature sprite wiggle holds frame A; per-creature wander offsets and the Garden↔Rooms placement tween are suppressed (`src/garden/model.ts`); ReadyShell's habitat↔text-view dither and Garden↔Rooms hold are skipped (`src/screens/ReadyShell.tsx`). `REPOGARDEN_REDUCED_MOTION=1`, `NO_MOTION=1`, and `CI=true` still seed the initial value via `isReducedMotion()` in `src/components/ui/theme-provider.tsx`. Focus captions remain visible, while transient emotion cues are suppressed through the same `useMotion()` context.

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
- **TUI:** DROPPED. PORTRAIT still reports when a branch is behind and directs the user to their normal git workflow, but there is no pull shortcut, command-palette action, or repository-mutating runner. Historical `pull` journal records remain parseable and keep their existing summaries.
- **Why:** RepoGarden promises never to modify scanned repositories. Even an explicit fast-forward-only pull crossed that boundary, so repository updates belong outside the app.

### File-system + clipboard shell integrations
- **Was:** `open_repo_path`, `open_app_data_dir`, clipboard read/write.
- **TUI:** PORTED. `src/lib/system.ts` (open in file browser via xdg-open / `open` / `explorer`) and `src/lib/clipboard.ts` (pbcopy / xclip / wl-copy).

## 8. Testing surface

### Vitest + React Testing Library integration tests
- **Was:** 5 test files exercising the App component end-to-end — `App.continuity.test.ts`, `App.hidden-repos.test.ts`, `App.repo-mass.test.ts`, `App.revive-queue.test.ts`, `App.startup-recovery.test.ts`.
- **TUI:** PARTIAL. The module suite is complemented by a fake-TTY Ink harness in `src/__tests__/helpers/ink-harness.tsx` and three screen-level integration suites. They drive `ReadyShell`, `WorkbenchScreen`, and in-garden caption painting, covering ready-view cycling (including GitHub), Rooms labels, Journal focus and Esc behavior, compact 80x24 layout, Workbench mode switching and Esc handling, and caption thresholds.
- **Note:** The screen-level suite recovers the highest-risk interaction coverage, but the full `App` lifecycle and the boot, onboarding, settings, help, and usage screens remain future integration-test opportunities.

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

1. **Richer project heuristics** (§5.1) — emotion-cue / burst / motion axes beyond the 4-state vibe and current mood layer. (The display side of cues recovered in §1.4 / §1.5 — focus captions + transient mood-glyph cues; what's still missing is the richer *derivation*.)
2. **Broader App-lifecycle integration coverage** (§8.1) — the Ink suite now covers ReadyShell, Workbench, and captions; top-level lifecycle and remaining screens are still future coverage.

### Trade-offs (not coming back)

- **Event log richness.** The legacy schema tracked push / ship / needs-pull / remote-warning signals plus TODO / FIXME counts and a recent-burst window. The TUI journal records commits / blockers / notes / vibe / repo / branch events but not the git-signal subtypes.
- **Tween-driven animation, face cycles, SVG icons, Nerd Fonts, Playwright, SQLite + migrations.** Tied to the desktop / browser substrate; replaced or unneeded.

None of the recovery items block the stable CLI line — they're flagged so future-us doesn't forget they were intentional pauses, not deletions.
