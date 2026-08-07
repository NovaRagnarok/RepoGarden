# HANDOFF

Updated: 2026-08-07
Status: ACTIVE

## Outcome

`BACKLOG.md` was re-grounded as the repository's reality roadmap (merged
2026-07-29): responsibility, one observable goal, Real/Good/Usable thresholds,
dated code receipts, five missing capabilities in product order, a subtraction
register, and milestones M0–M5 with runnable acceptance. M0 (real local
habitat) is verified; M1 is the next slice.

## Current state

- `main` is at the merged reality-roadmap change; there are **no open pull
  requests**.
- Published on npm as `@outsideheaven/repogarden`, dist-tag `latest` = `0.9.4`
  (registry last modified 2026-06-10), matching `package.json`. GitHub
  releases lag at `v0.9.1`, so release tags are not a reliable version signal.
- CI (`.github/workflows/ci.yml`) runs `pnpm typecheck`, `pnpm test`,
  `pnpm build`, `node dist/cli.js --help` across ubuntu/macos/windows × Node
  22/24, plus `scripts/tui-smoke.sh` on Linux and a `pack-smoke` job that
  installs the packed tarball globally with npm and runs the bin.
- Toolchain is pinned: Node 22+ (`.nvmrc`, `engines`), pnpm 10.32.1 via
  `packageManager`/Corepack. `pnpm install` runs `prepare` → `build`.
- There is **no `AGENTS.md` and no `CLAUDE.md`**. `BACKLOG.md`,
  `CONTRIBUTING.md` and `ARCHITECTURE.md` are the binding docs;
  `docs/AGENT-DECISIONS.md` is the repo-local decision log.
- Open issues are the M1/M2 evidence: #76 (note bodies unrecoverable when the
  note index is corrupt) and #77 (failed note writes still report save
  success) are M1; #81 (unreadable scan subtrees pruned as if complete) and
  #79 (nested repos missed after dropped root watch events) are M2. #64 is an
  owner-gated security-contact request; #83 is unrelated inbound noise.
- `CHANGELOG.md` carries unreleased work: startup npm update checks removed,
  and the workbench made read-only with respect to scanned repositories (the
  in-app `git pull` path is gone).

## Single next action

Implement issue #76 — recover safe Markdown note bodies when
`projects/<repo-id>/notes.json` is missing, malformed, incompatible or empty —
as the first M1 slice, with tests that never touch a real `~/.repogarden`.

## Definition of ON

For the current slice: no user-authored note body is lost to a corrupt or
unreadable index, and every save path distinguishes durable, partial, failed
and no-op writes in both feedback and journal events — proven by
`pnpm typecheck && pnpm test && pnpm build` plus M1's temporary-state tests.

The product-level threshold stays the roadmap's Usable definition: a fresh
install completes configure → notice → understand → hand off to one local
repository in under five minutes, with no provider setup, no repository
mutation and no false success.

## Blockers or waiting conditions

- Issue #64 needs an owner act: enable GitHub private vulnerability reporting
  or publish a private security contact, then handle the report. Reach is
  security intake only.
- M4 cannot start until the repository owner records a keep/fold/retire
  decision for every row of the `BACKLOG.md` subtraction register. Code
  evidence alone cannot decide those.

## Receipts

- `BACKLOG.md` — reality roadmap, thresholds, M0 receipts, M1–M5 acceptance
- `docs/AGENT-DECISIONS.md` — repo-local decision log
- `.github/workflows/ci.yml` — the verification matrix and pack smoke
- https://github.com/NovaRagnarok/RepoGarden/issues/76
- https://github.com/NovaRagnarok/RepoGarden/issues/77

## Promotion check

- [ ] Repeated operating rules were promoted to `AGENTS.md` (none exists yet).
- [x] Stable identity/relationship/command changes reached `.shipboard/repo.yaml`.
- [x] Repo-local decisions reached `docs/AGENT-DECISIONS.md` and `BACKLOG.md`.
- [ ] Portfolio strategy changes reached Shipboard canon.
