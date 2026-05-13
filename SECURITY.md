# Security

## Reporting a vulnerability

Please do not open a public issue for security vulnerabilities.

If GitHub private vulnerability reporting is enabled for this repository, use that flow.

If private vulnerability reporting is not available, open a public issue asking for a security contact, but do not include vulnerability details in the issue.

We aim to respond within a few business days.

## Privacy and data handling

RepoGarden is local-first. It reads only the repository roots you explicitly configure and stores all app state under `~/.repogarden/`. No repository data is sent to any RepoGarden-operated server.

Local app data stored under `~/.repogarden/` includes configured roots, project notes, blockers, event logs, repo paths, commit subjects, and branch/vibe snapshots. User-written notes may contain sensitive information and remain local unless the user copies or shares them elsewhere.

For each configured repository, RepoGarden reads:

- repository paths
- branch names
- commit subjects and author names
- dirty (uncommitted) file names
- small diff previews of dirty files for display

## Update check

Once per launch (cached for 24h under `~/.repogarden/update-check.json`), RepoGarden hits the npm registry at `https://registry.npmjs.org/@outsideheaven/repogarden/latest` to see whether a newer published version is available. If one is, a small toast in the running UI suggests the upgrade — RepoGarden never modifies the user's install.

The check is opt-out via `REPOGARDEN_NO_UPDATE_CHECK=1` and is automatically skipped in demo mode (`REPOGARDEN_DEMO=1`) and on CI runners (`CI=true`).

The implementation lives in `src/lib/update-check.ts`.

## Provider integrations

### Claude / Codex usage bar

The Claude/Codex usage bar is enabled by default in this early beta build.

When the ready UI renders (garden, shelf, or journal) or the workbench screen renders, RepoGarden attempts to read local Claude Code and Codex CLI OAuth credentials, refreshes tokens if needed, and calls the providers' usage endpoints directly. Refreshed tokens may be written back to the same local file or macOS Keychain entry used by those CLIs.

RepoGarden does not send these credentials to any RepoGarden-operated server. The credentials are used only to call the originating provider.

The implementation lives in:

- `src/lib/usage.ts`
- `src/hooks/use-usage.ts`

The endpoints used here are not documented public APIs and may change.

To disable the usage bar persistently, open Settings (`s`) and press `u`. The toggle is stored in `~/.repogarden/tui.json` as `usageBarDisabled` and is consulted on every launch.

For a one-off run that bypasses whatever is saved:

```bash
# installed package
REPOGARDEN_DISABLE_USAGE=1 repogarden

# from source
REPOGARDEN_DISABLE_USAGE=1 npm run dev
```

The env var wins over the saved setting; either path suppresses all reads of the provider CLI credentials.

## Supported versions

RepoGarden is early beta software. Only the latest 0.2.x release receives security fixes.

| Version | Supported |
| ------- | --------- |
| 0.2.x (latest) | yes |
| older | no |
