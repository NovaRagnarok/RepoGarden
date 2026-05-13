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

## Provider integrations

### Claude / Codex usage bar

The Claude/Codex usage bar is enabled by default in this alpha build.

When the ready UI renders (garden, shelf, or journal) or the workbench screen renders, RepoGarden attempts to read local Claude Code and Codex CLI OAuth credentials, refreshes tokens if needed, and calls the providers' usage endpoints directly. Refreshed tokens may be written back to the same local file or macOS Keychain entry used by those CLIs.

RepoGarden does not send these credentials to any RepoGarden-operated server. The credentials are used only to call the originating provider.

The implementation lives in:

- `src/lib/usage.ts`
- `src/hooks/use-usage.ts`

The endpoints used here are not documented public APIs and may change.

To disable the usage bar entirely for a run:

```bash
REPOGARDEN_DISABLE_USAGE=1 npm run dev
```

## Supported versions

RepoGarden is alpha software. Only the latest 0.1.x release receives security fixes.

| Version | Supported |
| ------- | --------- |
| 0.1.x (latest) | yes |
| older | no |
