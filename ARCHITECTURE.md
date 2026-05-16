# TUI Architecture

RepoGarden is a single-process Ink app with a small phase machine at the top
and mostly pure filesystem/git adapters underneath it. The useful mental model
is:

`terminal shell -> App phase -> ready shell or workbench -> lib/* reads/writes local state`

The habitat is the primary surface. The workbench is a deeper per-repo view,
not a second app.

## Runtime stack

- `src/cli.tsx` is the real entrypoint for both `pnpm dev` and the built CLI.
- React 19 + Ink render the UI.
- `ThemeProvider` and `ToastProvider` wrap the whole app.
- `@/*` imports resolve to `src/*`.
- There is no server and no background daemon. Everything runs in one Node
  process and reads/writes local disk directly.

## Top-level flow

`src/cli.tsx` does four things before the UI becomes interesting:

1. Load config from `~/.repogarden/tui.json`.
2. Pick the initial theme and wrap the app in providers.
3. Switch the terminal into alt-screen mode, enable synchronized updates, and
   enable mouse reporting.
4. Wrap `stdin` so SGR mouse sequences are stripped before Ink sees them.

After that, `App` in `src/cli.tsx` owns the phase machine:

- `booting`
- `onboarding`
- `ready`
- `settings`
- `workbench`
- `help`
- `edit-roots`

The boot sequence is simple:

- no scan roots -> `OnboardingScreen`
- roots exist -> progressive scan -> creatures found -> `ReadyShell`
- scan succeeds with zero repos or errors -> back to onboarding with status text

## Render tree

At a high level the tree is:

```text
Root
  ThemeProvider
    ToastProvider
      App
        BootScreen | OnboardingScreen | ReadyShell | SettingsScreen
        | WorkbenchScreen | HelpOverlay
```

Only one top-level screen is mounted at a time.

## Ownership boundaries

The app is easiest to work on when state stays where it already belongs.

### `src/cli.tsx`

Owns session-wide state and cross-screen transitions:

- current phase
- configured scan roots
- current theme id
- current top-level ready view (`garden | shelf | journal`)
- scanned `RepoCreature[]`
- rescan progress/errors
- currently open workbench target

If a change affects more than one screen or changes when scans happen, start
here.

### `src/screens/ReadyShell.tsx`

Owns the main habitat shell once scanning is done:

- focus index and the virtual `home` row
- local filter mode and filter text
- overlay-card visibility
- garden/shelf/journal transition state
- wide-layout sidebar click hit zones

`ReadyShell` is the coordinator for the three ready-state surfaces:

- `GardenView` for the habitat and shelf layouts
- `JournalView` for the event timeline
- sidebar, chrome, footer, toasts, usage bar, and view switching

If a bug is "top-level keyboard/mouse navigation feels wrong", it is usually
here.

### `src/screens/JournalView.tsx`

Owns journal-local interaction state:

- selected event row
- scroll offset
- event-kind filter
- time-range filter
- details open/closed

The parent chooses which repo is in scope via the sidebar. `JournalView`
handles filtering and rendering after that.

### `src/screens/WorkbenchScreen.tsx`

Owns per-repo deep-dive state:

- PORTRAIT vs NOTES mode
- active note/editor buffer
- note creation/rename/delete prompts
- command palette state
- portrait section selection/details state
- note search/goto-line UI state

This screen writes directly to notes/memory storage. On close, `App` only
touches `lastVisitedAt`.

## Data model

There are three important shapes:

- `ScannedRepo` in `src/lib/scanner.ts`: raw repo facts from git/filesystem
- `ProjectMemory` in `src/lib/memory.ts`: small per-repo persisted metadata
- `RepoCreature` in `src/lib/creature.ts`: `ScannedRepo + ProjectMemory + vibe`

Most UI code should consume `RepoCreature`, not re-derive repo state itself.

## Scan and enrich pipeline

The core pipeline is:

```text
scan roots
  -> find repo paths
  -> inspect each repo with git
  -> build ScannedRepo
  -> load ProjectMemory
  -> infer vibe
  -> build RepoCreature
  -> reconcile against scan snapshot
  -> emit journal events
```

Relevant files:

- `src/lib/scanner.ts`
- `src/lib/creature.ts`
- `src/lib/vibe.ts`
- `src/lib/events.ts`

Important behavior:

- Full scans use `scanRootsProgressive()`, which streams repos back into the
  UI while scanning.
- `enrichScans()` is the "make this UI-ready" step. It sorts creatures and, by
  default, reconciles them against the persisted scan snapshot.
- Snapshot reconciliation emits `repo-added`, `commit`, `vibe-changed`, and
  `branch-switched` events into the journal store.
- After boot, a 30s light refresh probes each repo with a cheap
  `git status --porcelain=v2 --branch`. If HEAD changed, that one repo gets a
  full inspect so commit/journal data stay accurate.
- A background observer (`src/lib/observer.ts`) layers on top: `fs.watch`
  on each repo's `.git/logs/HEAD` triggers a single-repo
  `refreshOneCreature` within ~250 ms of any commit / amend / pull / reset;
  a non-recursive watch on each scan root surfaces new repos within
  ~500 ms by running `inspectRepo` + splicing into the registry. Both
  paths flow through `enrichScans`'s snapshot reconcile so the journal
  events still come from the same seam. The 30s light refresh stays
  underneath as a safety net for filesystems where `fs.watch` is
  unreliable (network mounts, `/mnt/c` on WSL2).

If a change affects vibe, commit visibility, branch changes, or what appears in
the garden after rescans, follow this pipeline before touching UI code.

## Persistence layout

Everything lives under `~/.repogarden`.

- `tui.json`: app config from `src/lib/config.ts` (`schemaVersion: 1`)
- `projects/<repo-id>.json`: legacy per-repo memory from `src/lib/memory.ts`
- `projects/<repo-id>/notes.json`: note index from `src/lib/notes.ts`
- `projects/<repo-id>/notes/*.md`: note bodies
- `events.jsonl`: global append-only journal event store
- `events.meta.json`: seeded/backfill marker
- `scan-snapshot.json`: last known vibe/branch/head per repo
- `scan-cache.json`: cached scan details for fast startup
- `update-check.json`: cached npm version check result

This layout is treated as supported local storage while RepoGarden moves toward
a stable release. Schema-less older `tui.json` files are normalized on read and
written back with `schemaVersion: 1` the next time settings are saved. Future
breaking storage changes should add explicit migrations instead of changing
these shapes in place.

Two details matter when editing persistence code:

- Notes are the primary editable long-form store now. `ProjectMemory` is a
  small compatibility layer for fields like `hidden`, `lastVisitedAt`, and the
  blocker mirror.
- The note named `blocker` is mirrored back into `ProjectMemory.currentBlocker`
  so the habitat's vibe inference can stay simple.

## Events and usage polling

Two hooks poll local/external state on intervals:

- `src/hooks/use-events.ts`: re-reads `events.jsonl` on `fs.watch` activity
  with a 30s safety-net poll underneath
- `src/hooks/use-usage.ts`: refreshes Claude/Codex usage roughly every 120s

Repository-side changes are driven by the same pattern: `src/lib/observer.ts`
watches each tracked repo's `.git/logs/HEAD` and each scan-root directory for
new repos, and the existing 30s light refresh covers anything `fs.watch`
misses.

## Input and terminal plumbing

Ink handles keyboard input, but RepoGarden layers its own terminal behavior on
top in `src/cli.tsx` and `src/lib/mouse.ts`.

Important pieces:

- alt-screen enter/leave so the app has a dedicated canvas
- synchronized update mode to reduce whole-frame flicker
- custom mouse parser for xterm SGR mouse sequences
- `useMouse()` subscriptions on top of that parser
- `useInput()` as a thin wrapper over Ink's keyboard hook

Why this exists:

- raw mouse escape sequences confuse Ink's keyboard parser if they are not
  removed first
- several surfaces need absolute row/column hit-testing, which Ink does not
  expose directly

If mouse behavior breaks, inspect `src/lib/mouse.ts` first, then the local
screen hit-testing code.

## Layout model

This TUI is not a free-flowing document. Most screens compute an explicit
container height and deliberately stay under `stdout.rows`.

That pattern exists because Ink can fall back to a clear-terminal repaint path
when the output fully fills the terminal, which causes visible flicker and
half-screen artifacts on some terminals. You will see repeated code like:

- `const containerHeight = Math.max(8, rows - 1);`

`ReadyShell` goes further and measures its chrome so the garden gets the real
remaining height. `GardenView` also relies on absolute origin rows/cols for its
overlay and animation painting.

If a layout change introduces flicker, clipping, or broken click targets, check
height math before assuming the problem is in the component being rendered.

## File map

Use this as the fastest starting point:

- `src/cli.tsx`: app lifecycle, phase changes, terminal setup
- `src/screens/ReadyShell.tsx`: main habitat shell and top-level navigation
- `src/screens/GardenView.tsx`: creature field rendering and placement/hover
- `src/screens/JournalView.tsx`: event timeline
- `src/screens/WorkbenchScreen.tsx`: portrait + notes editor
- `src/lib/scanner.ts`: repo discovery and git inspection
- `src/lib/creature.ts`: creature assembly and snapshot reconciliation
- `src/lib/events.ts`: append/read journal store
- `src/lib/notes.ts`: note persistence and migration from legacy memory fields
- `src/lib/memory.ts`: small per-repo metadata store
- `src/lib/portrait.ts`: workbench portrait model
- `src/components/ui/`: reusable TUI primitives
- `src/hooks/`: terminal size, events, usage, mouse, input glue

## How to trace common changes

### "I want to change what a repo looks like in the habitat"

Start in:

- `src/lib/creature.ts`
- `src/lib/vibe.ts`
- `src/screens/GardenView.tsx`
- `src/lib/garden-layout.ts`
- `src/lib/sprite.ts`

### "I want to change workbench content"

Start in:

- `src/screens/WorkbenchScreen.tsx`
- `src/lib/portrait.ts`
- `src/lib/notes.ts`

### "I want to change journal wording or event behavior"

Start in:

- `src/lib/events.ts`
- `src/lib/event-summary.ts`
- `src/lib/journal.ts`
- `src/screens/JournalView.tsx`

### "I want to change scan behavior"

Start in:

- `src/lib/scanner.ts`
- `src/lib/creature.ts`
- `src/cli.tsx`

## Verification

For architecture-adjacent changes, the minimum useful checks are:

```bash
pnpm typecheck
pnpm test
```

And if the change touches journal/workbench/top-level navigation, run:

- `docs/manual-tests/journal-and-workbench-modes.md`

This repo is still light on integration tests. Pure lib modules carry most of
the automated safety net; screen behavior still needs manual smoke coverage.
