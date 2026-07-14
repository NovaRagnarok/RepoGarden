# Security

## Reporting a vulnerability

Please do not open a public issue for security vulnerabilities.

If GitHub private vulnerability reporting is enabled for this repository, use that flow.

If private vulnerability reporting is not available, open a public issue asking for a security contact, but do not include vulnerability details in the issue.

We aim to respond within a few business days.

## Privacy and data handling

RepoGarden is local-first. It reads only the repository roots you explicitly configure and stores all app state under `~/.repogarden/`. No repository data is sent to any RepoGarden-operated server.

Local app data stored under `~/.repogarden/` includes configured roots, project notes, blockers, event logs, repo paths, commit subjects, branch/vibe snapshots, and optional cached GitHub repository metadata. User-written notes may contain sensitive information and remain local unless the user copies or shares them elsewhere.

For each configured repository, RepoGarden reads:

- repository paths
- branch names
- commit subjects and author names
- dirty (uncommitted) file names
- small diff previews of dirty files for display

## GitHub discovery

GitHub discovery is off by default. Turn it on from Settings (`s`) with `G`.

When enabled, RepoGarden asks the GitHub CLI for an access token via `gh auth token`, then calls `https://api.github.com/user/repos` directly from your machine. It stores normalized repository metadata under `~/.repogarden/github-repos.json`, including repository names, URLs, visibility, default branch, pushed/updated timestamps, language, and clone URLs. It does not store the GitHub token.

RepoGarden uses this metadata to annotate local repos whose `origin` remote points at GitHub and to show unmatched GitHub repos in a catalog. Selecting a catalog repo and pressing Enter runs an explicit local `git clone` into the first configured scan root; RepoGarden does not clone automatically.

For a one-off run that suppresses all GitHub reads regardless of saved settings:

```bash
REPOGARDEN_DISABLE_GITHUB=1 repogarden
```

## Updates

RepoGarden does not perform automatic update checks or contact the npm registry during startup. Installing a newer version is an explicit user action through the user's package manager.

## Provider integrations

### Claude / Codex usage bar

The Claude/Codex usage bar is off by default. Turn it on from Settings (`s`) with `u`.

When the bar is enabled and the ready UI renders (garden, shelf, or journal) or the workbench screen renders, RepoGarden attempts to read local Claude Code and Codex CLI OAuth credentials, refreshes tokens if needed, and calls the providers' usage endpoints directly. Refreshed tokens may be written back to the same local file or macOS Keychain entry used by those CLIs.

RepoGarden does not send these credentials to any RepoGarden-operated server. The credentials are used only to call the originating provider.

The implementation lives in:

- `src/lib/usage.ts`
- `src/hooks/use-usage.ts`

The endpoints used here are not documented public APIs and may change.

To enable or disable the usage bar persistently, open Settings (`s`) and press `u`. The toggle is stored in `~/.repogarden/tui.json` as `usageBarDisabled` and is consulted on every launch.

For a one-off run that bypasses whatever is saved:

```bash
# installed package
REPOGARDEN_DISABLE_USAGE=1 repogarden

# from source
REPOGARDEN_DISABLE_USAGE=1 pnpm dev
```

The env var wins over the saved setting; either path suppresses all reads of the provider CLI credentials.

## Supported versions

RepoGarden 0.9 is the supported release-candidate line. Only the latest 0.9 release receives security fixes until v1 ships.

| Version | Supported |
| ------- | --------- |
| 0.9.x (latest) | yes |
| older | no |
