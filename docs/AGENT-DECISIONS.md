# Agent decisions

This file records consequential decisions for mission 12. It is deliberately
limited to public-safe engineering context; security-sensitive evidence is not
recorded here or in public issues.

## 2026-07-14 — Initial discovery and operating baseline

- The assigned checkout did not exist, so the lead cloned
  `NovaRagnarok/RepoGarden` into the only authorized path,
  `/home/debian/codex-blitz/work/RepoGarden`. No alternate checkout was used.
- The baseline is clean `main` at `32ea77c7e055e7310ce38462e95d83d676658111`.
  There is no repository `AGENTS.md` or `CLAUDE.md`; `BACKLOG.md`,
  `CONTRIBUTING.md`, and `ARCHITECTURE.md` are binding.
- The host default is unsupported Node 20. Verification therefore prepends
  `/opt/nodejs/node-v24.15.0-linux-x64/bin` and uses the pinned pnpm 10.32.1.
- Baseline full gate passed: typecheck, 540/540 tests, and build. Node's test
  coverage report measured 84.22% lines, 74.53% branches, and 76.01%
  functions across loaded files.
- GitHub had no open issues at discovery time. `main` is protected by required
  Node 24 checks on Linux/macOS/Windows plus pack smoke. CI has no deploy job;
  central-runner merge authority remains in force.

### Dated-seed classifications

- `already_fixed` — in-garden captions and transient terminal-native emotion
  cues shipped in PR #54 and have unit plus Ink integration coverage.
- `already_fixed` — the first Ink behavior integration harness shipped in PR
  #53 and covers transitions, Esc behavior, compact layout, and workbench mode
  changes. A narrower real-`App`/wrapped-stdin lifecycle gap is separately
  `confirmed`.
- `stale` as a blanket coverage claim — scanner (93.92% lines), scan cache
  (97.56%), events (97.46%), memory (99.04%), and garden engine (92.44%) now
  have substantial coverage. GIF orchestration (for example `gif/export.ts` at
  59.02%) and several screens remain genuine gaps, so follow-up cards use the
  current report rather than dated counts.
- `confirmed` — top-level flow or storage-model changes require synchronized
  `ARCHITECTURE.md` updates.
- `confirmed` — a local notification hook remains in Priority C. It is not
  selected: the higher-ranked queue contains safety, integrity, and current
  behavior defects, and any future test must keep notifications mocked.
- `confirmed` — dependency audits are report-only unless behavior is broken.
  No dependency change was selected and no dependency-audit mutation was made.

### Scope and authority decisions

- Current workbench code runs `git pull --ff-only` inside scanned repositories,
  conflicting with the mission and the product's own read-only promise. The
  mission is higher authority, so removal is the first slice. Historical
  `pull` journal records remain readable; no migration is needed.
- Startup performs an automatic opt-out npm registry update request. That
  conflicts with the mission's no-phone-home boundary. Remove the automatic
  request; a future explicitly initiated update check would be a separate
  product decision.
- Several security-sensitive findings were confirmed. Repository private
  vulnerability reporting is disabled, so details are withheld from public
  files/issues. The only public tracker entry will request a private security
  contact, following `SECURITY.md`; the findings are not part of the automatic
  public queue until a private channel exists.
- GitHub discovery's place in the primary habitat navigation is a product
  positioning choice. Route it as `needs-owner`; do not auto-queue a design
  answer.

### Evidence-ranked public queue

1. Restore the never-modify guarantee by removing in-app pull behavior.
2. Stop the automatic update-check request.
3. Surface configuration persistence failures instead of claiming success.
4. Serialize GitHub clone actions and expose bounded actionable failures.
5. Cover the actual App lifecycle and wrapped-stdin production seam.
6. Resynchronize binding docs and objective public-site runtime/Rooms facts.
7. Preserve notes across corrupt or incompatible indexes and report write
   failures truthfully.
8. Bring nested-repository and worktree observer coverage in line with scanner
   support.
9. Validate scan-cache entries and refresh volatile details to full fidelity.

The first wave selects items 1, 2, and 6: the two contract breaches plus a
separate low-conflict documentation slice that makes the binding queue usable
again. Items 3–5 remain the next public candidates; items 7–9 will be filed in
bounded refresh batches as earlier issues leave the queue.

## 2026-07-14 — Checkpoint: issue #59 / PR #65

- Task: stop the automatic npm update-check request (`#59`).
- Branch/head: `codex/59-disable-auto-update` at
  `dd93838a5ed19be1e1083d4f66a534ceeaa68384`.
- PR: `#65`, open and ready for review; `Fixes #59` on merge.
- Changed behavior: ordinary startup no longer calls the npm registry or
  reads/writes `update-check.json`; the obsolete opt-out and client/tests were
  removed. `--version` still reads local package metadata.
- Verification: Node 24.15.0 full gate passed with 528/528 remaining tests;
  focused CLI help/version tests and source help/version smoke passed; diff
  check passed.
- Review: two focused independent reviews of the exact head reported no
  findings.
- Merge queue: an exact-SHA candidate record was posted to PR #65 for the
  central runner. The repository lead did not merge it.
- Decisions/blockers: existing stale cache files are harmless and intentionally
  left untouched. No deployment is involved and no owner judgment is needed.
- Discovery refresh: the ready issue queue still contains more than twice the
  three-slot floor, so no refill was required at this checkpoint. Active/next
  candidates are #58, #63, #60, #61, and #62.
