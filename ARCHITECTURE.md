# TUI Architecture

RepoGarden is a single-process Ink app with a small phase machine at the top
and mostly pure filesystem/git adapters underneath it. The useful mental model
is:

`terminal shell -> App phase -> ready shell or workbench -> lib/* reads/writes local state`

The habitat is the primary surface. The workbench is a deeper per-repo view,
not a second app.

## Runtime stack

- `src/cli.ts` is the tiny launcher for both `pnpm dev` and the built CLI; it checks the Node version before loading `src/cli-runtime.tsx`, which starts the Ink coordinator from `src/cli-main.tsx`.
- React 19 + Ink render the UI.
- `ThemeProvider`, `PrivacyProvider`, and `ToastProvider` wrap the whole app.
- `@/*` imports resolve to `src/*`.
- There is no server and no background daemon. Everything runs in one Node
  process and reads/writes local disk directly.

## Top-level flow

`src/cli-runtime.tsx` and the `Root` in `src/cli-main.tsx` do four things before
the UI becomes interesting:

1. Load config from `~/.repogarden/tui.json`.
2. Pick the initial theme and wrap the app in providers.
3. Switch the terminal into alt-screen mode, enable synchronized updates, and
   enable mouse reporting.
4. Wrap `stdin` through `src/lib/wrapped-stdin.ts` so split SGR mouse/focus
   sequences are stripped before Ink sees them while a bare Escape is flushed
   through after the ambiguity timeout.

After that, `App` in `src/cli-main.tsx` owns the phase machine:

- `booting`
- `onboarding`
- `ready`
- `settings`
- `workbench`
- `help`
- `usage`
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
    PrivacyProvider
      ToastProvider
        App
          BootScreen | OnboardingScreen | ReadyShell | SettingsScreen
          | WorkbenchScreen | HelpOverlay | UsageOverlay
```

Only one top-level screen is mounted at a time.

## Ownership boundaries

The app is easiest to work on when state stays where it already belongs.

### `src/cli.ts`, `src/cli-runtime.tsx`, and `src/cli-main.tsx`

`src/cli.ts` is intentionally small: it verifies the running Node version,
dynamically imports `src/cli-runtime.tsx`, and calls its explicit `runCli`
entry. The runtime owns argument dispatch, terminal/signal plumbing, and the
final Ink render. Importing `cli-main.tsx` alone has no terminal or signal side
effects, which lets temp-state fixtures render the production `Root`/`App`
coordinator. `Root` accepts an optional initial config and narrow boot-runtime
overrides for that purpose; normal CLI startup supplies neither. Keep
dependency-heavy imports out of the launcher so unsupported Node versions get
a plain error instead of an Ink/runtime failure.

`src/cli-main.tsx` owns session-wide state and cross-screen transitions:

- current phase
- configured scan roots
- current theme id
- current top-level ready view (`garden | rooms | journal | github`)
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
- garden/rooms/journal/GitHub transition state
- wide-layout sidebar click hit zones

`ReadyShell` is the coordinator for the four ready-state surfaces:

- `GardenView` for the habitat and rooms layouts (rooms partitions the canvas
  into per-vibe quadrants via `placeInRooms` in `src/lib/garden-layout.ts`,
  with per-vibe pagination and a compact one-vibe-at-a-time fallback on small
  terminals)
- `JournalView` for the event timeline
- `GitHubCatalogView` for the optional GitHub-backed repository catalog
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
touches `lastVisitedAt`. Those writes stay under `~/.repogarden`; the
workbench only reads scanned repositories and never runs mutating git
commands. Repository updates remain in the user's normal git workflow.

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
  -> optionally fetch GitHub repo metadata
  -> find repo paths
  -> inspect each repo with git
  -> match GitHub metadata by origin remote
  -> build ScannedRepo
  -> load ProjectMemory
  -> infer vibe
  -> build RepoCreature
  -> reconcile against scan snapshot
  -> emit journal events
```

Relevant files:

- `src/lib/scanner.ts`
- `src/lib/github.ts`
- `src/lib/creature.ts`
- `src/lib/vibe.ts`
- `src/lib/events.ts`

Important behavior:

- Full scans use `scanRootsProgressive()`, which streams repos back into the
  UI while scanning.
- GitHub discovery is opt-in. `src/lib/github.ts` fetches and caches repository
  metadata through the user's `gh` CLI authentication before a scan; local git
  data remains authoritative, and remote-only GitHub repos stay in the catalog
  until explicitly cloned into a scan root.
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

- `tui.json`: app config from `src/lib/config.ts` (`schemaVersion: 2`)
- `projects/<repo-id>.json`: legacy per-repo memory from `src/lib/memory.ts`
- `projects/<repo-id>/notes.json`: note index from `src/lib/notes.ts`
- `projects/<repo-id>/notes/*.md`: note bodies
- `events.jsonl`: global append-only journal event store
- `events.meta.json`: seeded/backfill marker
- `scan-snapshot.json`: last known vibe/branch/head per repo
- `scan-cache.json`: cached scan details for fast startup
- `github-repos.json`: cached normalized GitHub catalog metadata

This layout is treated as supported local storage while RepoGarden moves toward
a stable release. Schema-less older `tui.json` files are normalized on read and
written back with the current `schemaVersion` the next time settings are saved.
Future breaking storage changes should add explicit migrations instead of
changing these shapes in place.

Config saves write a temporary sibling and rename it into place so an interrupted
or failed write leaves the previous `tui.json` intact. The config API returns a
discriminated persistence result: the normalized config remains the active
in-session state even when the disk write fails, while the app keeps a keyed,
visible warning until a later save successfully persists that complete session
state.

Two details matter when editing persistence code:

- Notes are the primary editable long-form store now. `ProjectMemory` is a
  small compatibility layer for fields like `hidden`, `lastVisitedAt`, and the
  blocker mirror.
- The note named `blocker` is mirrored back into `ProjectMemory.currentBlocker`
  so the habitat's vibe inference can stay simple.
- Note bodies remain the recovery authority when `notes.json` is missing even
  though bodies already exist, is malformed, or contains no safe indexed
  entries. `src/lib/notes.ts` rebuilds the index from safe regular `notes/*.md`
  files in lexical order, using each file id as its recovered display name and
  stable file timestamps as fallback metadata. An index from a newer schema is
  left untouched: its safe bodies are surfaced in a read-only recovered view
  until a compatible app can interpret the metadata.
- The resolved `~/.repogarden/projects` directory is the notes storage trust
  root, so relocating the whole state/projects directory with a symlink remains
  supported. Per-project, `notes/`, index-file, and body-file symlinks are not
  followed; unsafe names and paths outside that resolved root are never read or
  written. Legacy migration or a fresh scratch note happens only when storage
  is safe and there are no recoverable bodies.

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
top in `src/cli-main.tsx` and `src/lib/mouse.ts`.

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

- `src/cli.ts`: Node-version launcher
- `src/cli-main.tsx`: app lifecycle, phase changes, terminal setup
- `src/screens/ReadyShell.tsx`: main habitat shell and top-level navigation
- `src/screens/GardenView.tsx`: creature field rendering and placement/hover
- `src/screens/JournalView.tsx`: event timeline
- `src/screens/GitHubCatalogView.tsx`: GitHub-backed repository catalog
- `src/screens/WorkbenchScreen.tsx`: portrait + notes editor
- `src/screens/UsageOverlay.tsx`: explicit per-provider usage detail
- `src/lib/github.ts`: optional GitHub discovery and catalog cache
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
- `src/cli-main.tsx`

## Verification

For architecture-adjacent changes, the minimum useful checks are:

```bash
pnpm typecheck
pnpm test
```

And if the change touches journal/workbench/top-level navigation, run:

- `docs/manual-tests/journal-and-workbench-modes.md`

Pure lib modules still carry most of the automated safety net, but the TUI now
also has a fake-TTY Ink harness in `src/__tests__/helpers/ink-harness.tsx` and
three screen-level integration suites. They cover ReadyShell view cycling,
Rooms and Journal behavior, compact 80x24 layout, Workbench Esc and mode
switching, and in-garden caption rendering. Boot, onboarding, settings, help,
usage, and the complete `App` lifecycle still need manual smoke coverage.
