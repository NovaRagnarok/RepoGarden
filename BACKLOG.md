# RepoGarden reality roadmap

_Canonical product roadmap · updated 2026-07-29_

This is the repository-owned product plan. GitHub issues are evidence and
execution records, not a second source of product priority.
[`docs/legacy-not-ported.md`](docs/legacy-not-ported.md) is a migration
inventory, not a recovery queue.

## Responsibility, beneficiary, and goal

RepoGarden is responsible for a delightful, dependable, local-first habitat
that helps a solo builder notice, remember, and resume **one local
repository**. It may read configured repositories and write its own local
memory; it does not manage a portfolio or change a scanned repository.

**Observable goal:** from a fresh supported install, a person can configure a
local root, notice one repository in the habitat, recover a truthful “where I
left off / what next” cue, and hand off to that repository within five
minutes, without enabling a provider or network feature.

The next meaningful upgrade is not another view. It is making that single
resume path trustworthy, obvious, and shorter.

## Outcome thresholds

### Real

A supported package launches, scans only configured roots, renders each found
repository as a stable creature in the Garden, opens focused local context,
and never modifies scanned repositories. The flow is runnable, but its resume
handoff may still be indirect and its app-owned memory may still fail
untruthfully.

### Good

The Real loop preserves notes and scan continuity through expected local
failures, never reports an undurable save, presents one evidence-backed next
move for the focused creature, and makes the external handoff unmistakable.
Garden remains the primary surface; provider and aggregate views do not
interrupt the default loop.

### Usable

A fresh-install usability run at each supported terminal tier repeatedly
completes configure → scan → notice → understand → handoff within five
minutes, with no provider setup, no repository mutation, no lost local
writing, and no false success. Package installation, reset, privacy, and
failure recovery match the documentation.

## Current code reality

Receipts below were collected on **2026-07-29 UTC** from commit `d2da58e`
(`main` at inspection time), using Node 24.15.0 and the pinned pnpm 10.32.1
after a frozen-lockfile install.

- `pnpm build` passed and `node dist/cli.js --help` described the local TUI,
  Node 22+ requirement, `~/.repogarden` storage, and the no-repository-write
  boundary.
- `scripts/tui-smoke.sh` passed against an isolated temporary home: the real
  Ink TUI completed onboarding, scanned this worktree, and reached a
  post-onboarding habitat containing the expected repository.
- `pnpm pack --dry-run` passed and listed the CLI entrypoint, runtime screens,
  libraries, README, license, security notice, and third-party notices in the
  `@outsideheaven/repogarden@0.9.4` package.
- The app currently has four peer ready views—Garden, Rooms, Journal, and
  GitHub—cycled by `g` (`src/screens/ReadyShell.tsx`). Enter opens an internal
  Workbench; opening the repository folder is a separate `o` action from the
  ready shell. This makes “resume” a split handoff.
- The Workbench builds actions from git state, blocker memory, notes, and
  recent events (`src/lib/portrait.ts`) and edits app-owned Markdown notes
  (`src/screens/WorkbenchScreen.tsx`, `src/lib/notes.ts`). Notes are the
  richest resume memory, but blocker data is also mirrored through legacy
  project memory.
- Scanning, snapshots, cache, observers, and journal events are local
  (`src/lib/scanner.ts`, `src/lib/scan-cache.ts`, `src/lib/observer.ts`,
  `src/lib/events.ts`). Open issues document two continuity holes: unreadable
  descendants can look like complete scans
  ([#81](https://github.com/NovaRagnarok/RepoGarden/issues/81)), and live
  discovery can miss nested repositories
  ([#79](https://github.com/NovaRagnarok/RepoGarden/issues/79)).
- Open issues also demonstrate that corrupt note indexes can hide existing
  Markdown bodies
  ([#76](https://github.com/NovaRagnarok/RepoGarden/issues/76)) and failed
  writes can still produce save-success feedback
  ([#77](https://github.com/NovaRagnarok/RepoGarden/issues/77)). Therefore the
  current release-candidate claim is not yet evidence of the Good threshold.
- GitHub discovery/clone and Claude/Codex usage are implemented, optional, and
  off by default. They add provider credentials, network behavior, settings,
  and top-level chrome that are not required to resume one local repository.
- On inspection there were five substantive open issues, no open pull
  requests, and releases through `v0.9.1`; `package.json` is `0.9.4`. A public
  security coordination request remains owner-blocked
  ([#64](https://github.com/NovaRagnarok/RepoGarden/issues/64)).

## Missing capabilities, in product order

1. **Truthful, recoverable local memory.** Recover safe note bodies when the
   index is corrupt, and distinguish durable, partial, failed, and no-op
   writes in every save path. This protects user-authored resume context.
2. **Truthful repository presence.** Treat unreadable scan descendants as
   partial inventory and reconcile roots deeply enough to recover missed
   watcher events. This protects the habitat and journal from disappearance
   and phantom rediscovery.
3. **One explicit resume handoff.** For the focused creature, consolidate a
   short evidence-backed next move with an obvious open-folder/copy-path
   handoff. It depends on truthful memory and scan state; it adds no view and
   performs no git mutation.
4. **A quieter default habitat.** Decide which secondary surfaces support the
   one-repo loop, then remove them from the default path or fold them under
   the focused creature. This follows measured resume-loop evidence, not
   feature preference.
5. **Fresh-install proof.** Exercise the packed CLI across supported terminal
   tiers and the documented reset/failure paths with provider features off.
   This depends on the preceding behavior being stable.

## Subtraction and consolidation register

This is a **manual-review register**. It authorizes no deletion. Each candidate
needs a separate owner decision and implementation PR with focused migration
and test evidence.

| Candidate | Current evidence | Consolidation question |
| --- | --- | --- |
| Rooms as a peer view | `ReadyView` and `g` make Rooms a second habitat layout beside Garden. | Should Rooms become a Garden layout/filter instead of a destination? |
| Aggregate Journal | It includes cross-repo totals, busiest-repo data, a sparkline, filters, and tabular event history. | Which history directly restores context for the focused repo, and what aggregate dashboard information can retire? |
| GitHub catalog/clone | An optional top-level view lists unmatched remote repos and can clone into a root. | Should remote acquisition leave the default view cycle—and possibly the product—until local resume is Usable? |
| Claude/Codex usage | A footer and overlay read provider credentials and call undocumented usage endpoints when opted in. | Does account monitoring help resume one repo enough to justify this privacy and chrome surface? |
| Duplicated project memory | Named notes are user-authored memory; blocker content is mirrored into `ProjectMemory`, with events and snapshots as further projections. | Can notes become canonical, with derived one-way vibe/event projections and no legacy mirror? |
| Navigation motion | Habitat/text transitions and the Garden/Rooms transition can add roughly 1.4 seconds; reduced motion bypasses them. | Which motion communicates creature state, and which motion merely delays context recovery? |
| Delight and diagnostic chrome | Demo input, GIF/text exports, manual placement, density/pagination, bell, usage, observer, and provider controls share the main settings/interaction surface. | Which controls are core, delight, or diagnostic, and which can be grouped or moved out of the daily path? |
| Legacy recovery pressure | Richer heuristics, burst/motion axes, desktop event signals, face cycles, SVG/Nerd Fonts, SQLite, and Playwright survive in migration prose. | Keep migration facts, but retire desktop parity as a reason to add product surface. |
| Speculative integrations | AI-session parsing and OS notifications were active backlog ideas. | Retire both; reconsider only with observed local resume need, stable contracts, and explicit privacy policy. |

## Outcome milestones

Milestones are ordered by user impact and dependency. Acceptance commands use
the pinned package manager and Node 22+.

### M0 — Real local habitat (verified)

**Outcome:** a fresh local state can scan a configured root, show the
repository habitat, and open focused context without provider setup.

Acceptance:

```bash
pnpm install --frozen-lockfile
pnpm build
node dist/cli.js --help
scripts/tui-smoke.sh
pnpm pack --dry-run
```

Verified 2026-07-29 by the dated receipts above. This proves Real, not Good or
Usable.

### M1 — Resume memory tells the truth

**Outcome:** app-owned writing remains recoverable and every save message
matches durable state. Implements the outcomes evidenced by #76, then #77.

Acceptance:

```bash
pnpm test -- --test-name-pattern="notes|workbench"
pnpm typecheck
pnpm test
pnpm build
```

Temporary-state tests must cover missing, malformed, incompatible, and empty
indexes; existing safe Markdown bodies; body-write failure; index-write
failure; autosave; explicit save; mode/tab/close transitions; event and
blocker feedback. No test may read or write the real `~/.repogarden`.

### M2 — Habitat membership tells the truth

**Outcome:** transient local filesystem failures do not erase creatures or
fabricate rediscovery, and missed watcher events eventually find supported
nested repositories. Implements #81 and #79.

Acceptance:

```bash
pnpm test -- --test-name-pattern="scanner|observer|snapshot|lifecycle"
pnpm typecheck
pnpm test
pnpm build
```

Injected, permission-independent fixtures must prove partial-inventory
preservation, later complete-scan pruning, nested discovery, missed/null/error
watch recovery, deduplication, bounded status, and idempotent disposal.

### M3 — One-repository resume loop is obvious

**Outcome:** the focused creature shows one concise, evidence-backed next move
and one direct external handoff; the user does not have to infer that Enter
means internal context while `o` elsewhere means resume.

Acceptance:

```bash
pnpm test -- --test-name-pattern="ready|workbench|portrait|integration"
scripts/tui-smoke.sh
pnpm typecheck
pnpm test
pnpm build
```

An isolated tmux run must capture configure → Garden focus → next-move cue →
open-folder or copy-path handoff at 80×24 and 100×32. The path must make no
network request, mutate no scanned repository, and add no top-level view.

### M4 — Habitat regains the foreground

**Outcome:** owner-reviewed subtraction leaves Garden as the unmistakable
default and moves, folds, or retires secondary information that does not
advance the focused-repo loop.

Acceptance:

```bash
pnpm test -- --test-name-pattern="ready|garden|journal|github|usage|settings"
scripts/tui-smoke.sh
pnpm typecheck
pnpm test
pnpm build
```

Before implementation, record one keep/fold/retire decision for every row in
the register. After implementation, README key paths, help, settings,
configuration migration, privacy text, and tests must describe the same
default flow. Existing local data must remain readable.

### M5 — Usable fresh-install release

**Outcome:** an unfamiliar user can reliably resume one repo in under five
minutes from the packed CLI.

Acceptance:

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
pnpm pack --dry-run
scripts/tui-smoke.sh
git diff --check
```

Additionally, install the generated tarball into an isolated prefix and use a
temporary home to run first start, scan, notice, context recovery, handoff,
restart continuity, malformed-memory recovery, partial-scan recovery, and
documented reset at every supported layout tier. Record elapsed time and
captures. Provider toggles remain off. Usable requires all runs to preserve
user writing, avoid false success, avoid repository writes, and finish the
core loop within five minutes.

## External and owner acts

These acts are deliberately narrow; none is permission for broader provider,
publishing, merge, or product changes.

- **Repository owner:** choose keep/fold/retire for each subtraction-register
  row before M4 changes behavior. Provenance: the habitat-first product vision
  and the current four-view/provider-heavy code leave policy choices that code
  evidence alone cannot decide. Reach: only the named current surfaces.
- **Repository owner/security maintainer:** enable GitHub private
  vulnerability reporting or provide a private security contact, then handle
  the private report. Provenance:
  [issue #64](https://github.com/NovaRagnarok/RepoGarden/issues/64) and
  `SECURITY.md`. Reach: security intake only; no public vulnerability detail
  or provider credential use.
- **Maintainer:** review and merge milestone PRs in order after their listed
  gates pass. Provenance: repository pull-request policy and dependency order
  above. Reach: one milestone PR at a time; no automatic merge.
- **Release owner:** decide whether a verified M5 artifact warrants a version
  and publication. Provenance: `package.json`, npm `publishConfig`, and GitHub
  releases currently lagging the package version. Reach: the already-reviewed
  artifact only; publication is not part of roadmap implementation.

## Non-goals and retired assumptions

- No portfolio dashboard, provider hub, repo marketplace, kanban, ticketing,
  scoring, or cross-repository management system.
- No repository mutation: no pull, commit, branch, install, scaffold, or
  automatic remediation inside scanned repositories.
- No cloud account, telemetry, surveillance, or provider credentials in the
  minimal resume loop.
- No new top-level view to solve resume; consolidate before adding.
- No desktop-parity program. SQLite, browser/Pixi rendering, face cycles,
  SVG/Nerd Font assets, Playwright, rich git-signal schemas, and
  animation-oriented heuristic axes remain retired.
- AI-session parsing and OS notification hooks are retired assumptions, not
  backlog items.
- “More metadata produces better context” is retired. Prefer the smallest
  truthful cue that helps the person act.
- “The issue label chooses the roadmap” is retired. Issues support milestones;
  this file owns product order.
