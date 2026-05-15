# RepoGarden

RepoGarden is a local-first pixel habitat where your repositories become tiny deterministic invader creatures.

The product is intentionally not dashboard-first. The default experience is a living scene that helps you notice projects, recover context, and resume with a small next move.

## Early beta

RepoGarden is in early beta. The core loop works, but the UI, storage shape, and provider integrations may still change. Bug reports are very welcome.

RepoGarden:

- scans only the roots you configure
- stores app state under `~/.repogarden`
- never modifies your git repositories
- may read branch names, commit subjects, dirty file names, and small diff previews for display in the habitat
- can be reset with `rm -rf ~/.repogarden`

The Claude/Codex usage bar reads local provider CLI credentials to call those providers' usage endpoints directly. Disable it for a run with `REPOGARDEN_DISABLE_USAGE=1 repogarden`. Details: [SECURITY.md](SECURITY.md).

## Install

```bash
npm install -g @outsideheaven/repogarden
repogarden
```

## Preview

![RepoGarden TUI — onboarding, then a starry habitat fills with pixel-art repo creatures, then cycles through shelf and journal views](docs/images/demo.gif)

Each repo becomes a tiny pixel creature whose look reflects branch state, recency, and dirty files. Pick one and press `↵` to drop into a per-repo workbench. (Regenerate the recording with `vhs tape/demo.tape` — see [`tape/README.md`](tape/README.md).)

<details>
<summary>Static preview</summary>

![RepoGarden TUI — a wide starry habitat populated with pixel-art repo creatures, a creatures sidebar on the left, and a workbench card for the selected repo on the right](docs/images/preview.png)

</details>

## First 5 minutes

After `npm install -g @outsideheaven/repogarden`:

1. Run `repogarden`.
2. When asked, give it a folder that contains git repos — e.g. `~/repos` or `~/code`. Multiple paths work too (comma- or newline-separated).
3. The garden fills with one creature per repo. Use `↑` / `↓` to move between them.
4. Press `g` to cycle Garden → Shelf → Journal — three lenses on the same set of repos.
5. Press `↵` on a creature to drop into its workbench (portrait, notes, recent commits).
6. Press `?` for the full keymap, `s` for settings, `q` to quit.

If anything looks off, `REPOGARDEN_DISABLE_USAGE=1 repogarden` runs without the provider usage bar, and `rm -rf ~/.repogarden` resets local state.

## Requirements

- Node 24+
- `git` on `PATH`
- a terminal at least 80×24

End users install the published CLI with `npm install -g @outsideheaven/repogarden` (see top of README). For local development the repo uses **pnpm** (pinned via `packageManager` in `package.json`); the easiest way to get the right pnpm version is via [Corepack](https://nodejs.org/api/corepack.html), which ships with Node.

## Quick start (from source)

```bash
git clone https://github.com/NovaRagnarok/RepoGarden.git
cd RepoGarden
corepack enable
pnpm install
pnpm dev
```

That runs the Ink-based terminal UI: scan, garden/shelf/journal views, per-repo workbench, mouse + keyboard. `pnpm install` runs the `prepare` script automatically (which builds `dist/`), so `node dist/cli.js` and the `repogarden` bin work right after install.

## Product guardrails

- The habitat is the product.
- The workbench is a utility room, not the main surface.
- If the home screen starts reading like a dashboard, the work is drifting.

## Privacy

RepoGarden is local-first. No repository contents are sent to any RepoGarden-operated server.

RepoGarden stores local app data under `~/.repogarden`, including configured roots, project notes, blockers, event logs, repo paths, commit subjects, and branch/vibe snapshots.

During normal operation the app reads repo paths, branch names, commit subjects and authors, dirty file names, and small diff previews for display in the habitat.

User-written notes, blockers, and journal content may contain private information. RepoGarden keeps that data local unless you explicitly copy or share it elsewhere.

### Reset local data

All local app state lives under `~/.repogarden`. To wipe it and start fresh:

```bash
rm -rf ~/.repogarden
```

The next launch will re-run onboarding and rebuild the journal/snapshot from a clean slate. RepoGarden never modifies your git repos themselves — this only clears the app's own files.

### Claude / Codex usage bar

The Claude/Codex usage bar is enabled by default in this early beta build.

When the ready UI renders (garden, shelf, or journal) or the workbench screen renders, RepoGarden attempts to read local Claude Code and Codex CLI OAuth credentials, refreshes tokens if needed, and calls the providers' usage endpoints directly. Refreshed tokens may be written back to the same local file or macOS Keychain entry used by those CLIs.

RepoGarden does not send these credentials to any RepoGarden-operated server. The credentials are used only to call the originating provider.

The implementation lives in:

- `src/lib/usage.ts`
- `src/hooks/use-usage.ts`

The endpoints used here are not documented public APIs and may change.

To disable the usage bar persistently, open Settings (`s`) and press `u` — the toggle is saved to `~/.repogarden/tui.json`.

For a single run without changing the saved setting:

```bash
# installed package
REPOGARDEN_DISABLE_USAGE=1 repogarden

# from source
REPOGARDEN_DISABLE_USAGE=1 pnpm dev
```

The env var takes precedence; either path suppresses the network call entirely.

### Reduced motion

The garden tween, dither cross-fade, creature wander, blink, spinner, skeleton, and the boot scene all respect a reduced-motion setting. Open Settings (`s`) and press `m` to toggle it persistently, or set `NO_MOTION=1` (or `CI=true`) for a single run:

```bash
NO_MOTION=1 repogarden
```

## Choose your path

### Human collaborator

Read [`CONTRIBUTING.md`](CONTRIBUTING.md) for the short repo map, common commands, and how to pick a safe slice.

### Product and architecture context

Read these core docs as needed:

1. [`docs/product-vision.md`](docs/product-vision.md)
2. [`docs/creature-system.md`](docs/creature-system.md)
3. [`ARCHITECTURE.md`](ARCHITECTURE.md)
4. [`BACKLOG.md`](BACKLOG.md) — current direction and live TODO list
5. [`docs/legacy-not-ported.md`](docs/legacy-not-ported.md) — what survived the v1→TUI cutover

## Common commands

```bash
pnpm dev             # run the TUI
pnpm typecheck       # tsc --noEmit
pnpm test            # node --test
pnpm build           # emit dist/
node dist/cli.js --help
```

## Support

If RepoGarden makes exploring your repos a little more delightful, a star helps other people find it.

If RepoGarden is useful to you, you can support it via [GitHub Sponsors](https://github.com/sponsors/NovaRagnarok) or Ko-fi:

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/outsideheaven)
