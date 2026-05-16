# Contributing

RepoGarden is a local-first habitat-first app. The constraints that shape every change:

- the habitat is the main product surface
- the workbench stays secondary
- local-first beats cloud-style orchestration
- generated creatures stay procedural and deterministic

## Run the project

This repo uses [pnpm](https://pnpm.io/) (pinned via `packageManager` in `package.json`). The simplest way to get the right version is via [Corepack](https://nodejs.org/api/corepack.html), which ships with Node:

```bash
corepack enable
pnpm install
pnpm dev
```

Useful checks:

```bash
pnpm test
pnpm typecheck
```

## Repo map

- `src/` — Ink-based terminal client (the product)
- `docs/product-vision.md` — product intent
- `docs/creature-system.md` — creature identity, behavior, and motion rules
- `ARCHITECTURE.md` — how the TUI is put together
- `BACKLOG.md` — current direction and live TODO list

## Good first issues

If you're new to the repo, the friendliest entry points are open
issues labeled [`good first issue`](https://github.com/NovaRagnarok/RepoGarden/issues?q=is%3Aopen+label%3A%22good+first+issue%22). Each has acceptance criteria and pointers to
the right files. For terminal bugs, the [`bug_report` template](.github/ISSUE_TEMPLATE/bug_report.md) asks for OS,
terminal app, shell, Node version, install method, and terminal size —
filling that in up front saves a round trip.

## Choosing a safe slice

Start with [`BACKLOG.md`](BACKLOG.md) instead of inventing a slice from
scratch. Read the `Current direction` section first, then pull from Priority A.
Right now the safest useful work is:

- `ARCHITECTURE.md` and other navigation docs that help newcomers orient
- Priority A polish from `BACKLOG.md` that stays inside an existing screen or component
- small interaction fixes in `src/screens/SettingsScreen.tsx`, `src/screens/WorkbenchScreen.tsx`, or `src/components/ui/`
- bounded behavior changes with tests in pure modules under `src/lib/`

Examples of safe current slices:

- tighten or extend `ARCHITECTURE.md` as the code evolves
- add the workbench mode-toggle keybinding
- make the portrait panel scroll on short terminals
- improve SHELF grouping labels or copy without changing the habitat-first layout

Higher-risk slices:

- startup, boot, or recovery flow in `src/cli-main.tsx` and `src/screens/BootScreen.tsx`
- persistence format changes in `src/lib/config.ts`, `src/lib/notes.ts`, `src/lib/memory.ts`, or `src/lib/events.ts`
- import/integration behavior, token reads, or external CLI credential handling
- changes that make the home habitat read like a dashboard or promote the workbench into the main surface

If you touch one of those higher-risk areas, keep the slice small and run:

```bash
pnpm test
pnpm typecheck
```

Then run the manual smoke in [`docs/manual-tests/journal-and-workbench-modes.md`](docs/manual-tests/journal-and-workbench-modes.md).

## Read order

Start with:

1. [`README.md`](README.md)
2. [`docs/product-vision.md`](docs/product-vision.md)
3. [`docs/creature-system.md`](docs/creature-system.md)
4. [`ARCHITECTURE.md`](ARCHITECTURE.md)
5. [`BACKLOG.md`](BACKLOG.md)

## Where to look next

- Source is canon: `src/cli.ts`, `src/cli-main.tsx`, `src/screens/`, `src/lib/`, `src/components/` — [`ARCHITECTURE.md`](ARCHITECTURE.md) gives the high-level map, but the code is still the final authority.
- Product context: [`docs/product-vision.md`](docs/product-vision.md), [`docs/creature-system.md`](docs/creature-system.md)
- Manual verification: [`docs/manual-tests/`](docs/manual-tests)
- What didn't survive v1: [`docs/legacy-not-ported.md`](docs/legacy-not-ported.md)

## Capturing the README demo

The README's preview GIF is recorded from [`tape/demo.tape`](tape/demo.tape). For full setup instructions, see [`tape/README.md`](tape/README.md).

**Prerequisites:** `vhs`, `ttyd`, and `ffmpeg` — all user-local binaries.

**Quick regenerate:**
```bash
pnpm build
vhs tape/demo.tape
```

The output lands at `docs/images/demo.gif`. The recording runs against a seeded `/tmp/repogarden-demo-home` (via `setup.sh`) so it never touches your real `~/.repogarden` directory.

## Contributions

By contributing to RepoGarden, you agree that your contributions will be licensed under the MIT License (see LICENSE).
