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
- PR: `#65`, merged through the protected branch as
  `3c666a70181235cd208eee86de95e55df687468a`; it closed `#59`.
- Changed behavior: ordinary startup no longer calls the npm registry or
  reads/writes `update-check.json`; the obsolete opt-out and client/tests were
  removed. `--version` still reads local package metadata.
- Verification: Node 24.15.0 full gate passed with 528/528 remaining tests;
  focused CLI help/version tests and source help/version smoke passed; diff
  check passed.
- Review: two focused independent reviews of the exact head reported no
  findings.
- Merge queue: the central runner reconfirmed head
  `dd93838a5ed19be1e1083d4f66a534ceeaa68384`, built disposable integration
  result `08bf5dfc5d4fc355af9f28bd761b6bba9e47d8f9`, reran the full 528-test gate,
  confirmed all required platform and pack-smoke checks, and merged normally
  without bypass. The repository lead did not execute the merge.
- Decisions/blockers: existing stale cache files are harmless and intentionally
  left untouched. No deployment is involved and no owner judgment is needed.
- Discovery refresh: the ready issue queue still contains more than twice the
  three-slot floor, so no refill was required at this checkpoint. Active/next
  candidates are #58, #63, #60, #61, and #62.

## 2026-07-14 — Checkpoint: issue #58 / PR #66

- Task: remove repository-mutating pull actions from the workbench (`#58`).
- Branch/head: `codex/58-read-only-workbench` at
  `4287828fa1ef1827422ee948c8dcd562e2f5ca1f`, rebased onto current `main`
  after PR #68 advanced the base.
- PR: `#66`, merged normally through the protected branch as
  `8eabddbd2913062227087158763d583a60a8c464`; it closed `#58`.
- Changed behavior: the workbench no longer offers a `u` shortcut, command
  palette pull action, confirmation flow, or `git pull --ff-only` runner.
  Behind-state guidance points to the user's normal external git workflow,
  while historical `pull` journal records remain readable.
- Verification: the final rebased exact head passed the Node 24.15.0 full gate
  with 517/517 tests, typecheck, and build. Earlier heads also passed their full
  gate and 86 focused workbench/portrait/events tests. Gates use an ignored
  workspace `TMPDIR` because the shared host `/tmp` filesystem is
  inode-exhausted.
- Review: independent exact-head reviews found no blocker and confirmed patch
  equality. The first rebase only placed the changelog entry alongside #59;
  the final #68 rebase was conflict-free and preserved the complete #60 config
  persistence composition. Static reference and child-process scans found no
  executable pull path.
- Merge queue: after PR #68 advanced the base, the runner reconfirmed the final
  exact head, built disposable integration result
  `f9389cb2ed389c749a394667e1e398483fed2d05`, and reran the 517-test full
  gate. Once every required check completed, it reconfirmed the unchanged
  integration tree `6498158231619e60cf3f14dd60cace30462b38df` and merged
  normally without bypass. The repository lead did not execute the merge; no
  deployment occurred.
- Decisions/blockers: this is classified high risk because it restores the
  central repository-integrity boundary, even though it removes rather than
  adds mutation. No deployment or owner judgment is involved.
- Discovery refresh: the ready issue queue still contains more than twice the
  three-slot floor. Active/next candidates are #63, #60, #61, and #62; the
  next refresh will also reconcile the newly observed stale manual-smoke
  terminology with the existing documentation issue before filing anything.

## 2026-07-14 — Checkpoint: issue #63 / PR #67

- Task: synchronize binding docs and the public site with the current runtime
  (`#63`).
- Branch/head: `codex/63-sync-current-docs` at
  `8c111f5ea30d1608a7975e3c1008c3a663eb78a5`.
- PR: `#67`, merged normally through the protected branch as
  `74f35e3e7b5713e3f84be64b83e2ac0a297dbeee`; it closed `#63`.
- Changed behavior: documentation now records the shipped captions/emotion
  milestone, the issue-backed live queue, current providers/phases/storage,
  four ready views, Rooms layout, optional GitHub catalog, current Ink
  coverage, and updated manual-smoke terminology.
- Verification: Node 24.15.0 full gate passed with 528/528 tests, typecheck,
  and build; diff checks and factual cross-checks against the phase machine,
  ReadyShell, storage paths, package engine, and integration suites passed.
- Review: final lead review found and corrected residual README, public-site,
  legacy-map, and manual-smoke drift. No blockers remain in the exact head.
- Merge queue: after PR #65 merged, the central runner reconfirmed exact head
  `8c111f5ea30d1608a7975e3c1008c3a663eb78a5`, built disposable integration
  result `212a0a5c04bf243237406bef3194e9f31ab45de5`, reran the 528-test full gate,
  confirmed all required checks, and merged normally without bypass. The
  repository lead did not execute the merge.
- Decisions/blockers: issue-specific changes are low-risk factual
  documentation, not a product-positioning decision. No deployment is
  involved.
- Discovery refresh: the #66/#67 trigger was fulfilled by the unseeded export
  and terminal-lifecycle audit recorded below.

## 2026-07-14 — Checkpoint: issue #60 / PR #68

- Task: report configuration persistence failures truthfully (`#60`).
- Branch/head: `codex/60-config-persistence` at
  `f86e6e2a84d7fddcbed8b6294b1fce129902869b`, rebased conflict-free onto
  current `main` after PR #67 merged.
- PR: `#68`, merged normally through the protected branch as
  `1cd7879e377d60f48eaa3230b1bb00230ce372ea`; it closed `#60`.
- Changed behavior: config writes now return a persistence result and replace
  `tui.json` through a temporary sibling. Failed changes stay active in one
  complete session snapshot, suppress success claims, and keep a keyed warning
  visible across Settings, Onboarding, and ReadyShell until a later successful
  save persists the accumulated state.
- Verification: after the current-main rebase, the Node 24.15.0 full gate
  passed with 530/530 tests, typecheck, and build. Twenty focused config and
  ReadyShell tests, exact range-diff equality to the previously approved
  patch, and the final diff check passed.
- Review: lead review and one independent exact-SHA persistence/trust review
  found no blockers.
- Merge queue: the central runner reconfirmed the refreshed exact head, built
  disposable integration result
  `a6062d4630b6fc69460df3eba2b15fa88f904fea`, and reran the 530-test full
  gate. After every required platform and pack-smoke check completed, it
  reconfirmed that current main and the integration tree were unchanged and
  merged normally without bypass. The repository lead did not execute the
  merge; no deployment occurred.
- Decisions/blockers: the change is medium-risk local-persistence and
  cross-screen status wiring, with no schema change, deployment, or product
  judgment.
- Discovery refresh: completed and persisted as issues #69–#71 below. #61 and
  #62 remain in the current implementation wave.

## 2026-07-14 — Recurring unseeded discovery refresh

- The refresh deliberately ignored dated seeds and open issues, then inspected
  text/GIF export and terminal lifecycle from first principles. No repository
  or real user state was modified.
- `confirmed` — budgeted text export currently scans and reconciles on every
  width probe, assumes monotonic output despite layout/pagination
  discontinuities, and can return an oversized result for an impossible
  budget. The bounded single-scan correction is tracked as `#69`.
- `confirmed` — export numeric options accept invalid/unbounded values and GIF
  frame count does not match the encoder's default frame delay, so requested
  duration is inaccurate. Strict parsing, safety bounds, and duration coverage
  are tracked as `#70`.
- `confirmed` — terminal teardown is not an idempotent disposable session,
  common termination signals are incomplete, and signal exits are not
  truthful. This is tracked as `#71`, dependent on the runtime seam in `#62`
  to avoid duplicate/conflicting extraction.
- `misleading` — a blanket claim that Discord export currently exceeds its
  normal budget. The demo roster fits; the confirmed issue is the search and
  impossible-budget contract.
- `already_fixed` — headless export paths dirtying the terminal. Argument
  dispatch exits before TTY setup on those paths.
- Queue decision: file only the three separable, falsifiable cards above.
  `#69` is ranked first and started in an isolated worktree; `#70` follows
  because it shares export paths, and `#71` waits for `#62`'s runtime boundary.

## 2026-07-14 — Checkpoint: issue #61 / PR #72

- Task: serialize GitHub clone actions and expose bounded actionable failures
  (`#61`).
- Branch/head: `codex/61-serialize-clones` at
  `996289ee83e993dd079b7565281131a6db4fc914`, rebased conflict-free onto
  current main `8eabddbd2913062227087158763d583a60a8c464` after #66 merged.
- PR: `#72`, merged normally by the central runner as
  `4ef5e486257c99ffa429caf79e6e030fab841db7`; it closed `#61`.
- Changed behavior: clone requests are coordinated per target. Repeated actions
  share one in-flight operation, different targets may proceed independently,
  and an existing destination is never modified. Child output is piped,
  bounded, and stripped of terminal/bidirectional controls; timeout handling
  retains the reservation until child termination or a bounded kill-grace
  window, and the habitat exposes truthful in-flight/failure state.
- Verification: the final rebased exact head passed the Node 24.15.0 full gate
  with 527/527 tests, typecheck, and build. Focused clone/config/ReadyShell tests,
  diff checks, and exact range-diff equality also passed; tests use only temp
  destinations and injected child processes.
- Review: lead review and independent reviews found no blockers. One earlier
  review caught a real timeout race where single-flight state could clear
  before the child terminated; the implementation was fixed and re-reviewed.
  The final current-stack review confirmed that the #61 patch is unchanged.
- Merge queue: the central runner built disposable integration result
  `36cec7cd58a491072a8a32a888ceb30c2f81dd4f`, passed the Node 24 full gate,
  then reconfirmed the exact head, unchanged current base, identical
  integration tree, clean mergeability, and every required platform,
  pack-smoke, and review check before merging without bypass. The repository
  lead did not execute the merge; no deployment occurred.
- Decisions/blockers: medium-risk local child-process coordination, no product
  judgment and no deployment. The operation may create a new clone only at the
  user-selected empty destination; it does not mutate an existing scanned
  repository.
- Discovery refresh: #69 and #70 are implementing in parallel; #71 is active
  on #62's reviewed runtime seam. PR #73 is now in the central runner.

## 2026-07-14 — Checkpoint: issue #62 / PR #73

- Task: exercise the real App lifecycle and wrapped-stdin production seam
  (`#62`).
- Branch/head: `codex/62-app-lifecycle` at
  `3e7a789868bb9552cec1bed4d2bef829c8b97836`, stacked on refreshed PR #72
  head `996289ee83e993dd079b7565281131a6db4fc914`.
- PR: `#73`, merged normally by the central runner as
  `1b0ed2f4fbbc62ca2d23b980fbfa02002ec0b054`; it closed `#62`.
- Changed behavior: process/terminal startup now has an explicit `runCli()`
  boundary while the production Root/App coordinator is import-safe. A shared
  disposable stdin wrapper filters split mouse/focus reports and flushes a
  genuine bare Escape. The Ink harness can opt into that exact input path, and
  a temp-state lifecycle test drives boot, onboarding, synthetic demo-ready,
  Help, Settings, and Usage while asserting stale screens disappear.
- Verification: the final rebased exact head passed the Node 24.15.0 full gate
  with 528/528 tests, typecheck, and build. Focused current-stack
  config/clone/lifecycle/ReadyShell tests passed 31/31, and the final diff
  check was clean. The fixture uses temp HOME, zero roots, synthetic creatures,
  and disables GitHub, observer, usage, update, and prune activity.
- Review: lead and independent reviews found no blocker. A non-blocking stale
  harness comment was corrected before the final commit. The independent
  exact-head conflict audit confirmed that #59's phone-home removal, #60's
  sticky persistence state, and #61's clone coordinator all remain intact.
- Merge queue: after #72 merged, the central runner built the conflict-free
  disposable integration result
  `322b01e01f8c08212fe1c304a57b05ec2e8921d8` on exact current main, passed
  the Node 24 full gate, and reconfirmed the exact head plus required
  Ubuntu/macOS/Windows Node 24 and pack-smoke checks before a normal merge.
  The repository lead did not execute the merge; no deployment occurred.
- Decisions/blockers: medium-risk terminal/runtime extraction, no product
  judgment and no deployment. The test seam is narrow and optional; production
  startup supplies no fixture overrides.
- Discovery refresh: #69/#70 have been rebased patch-identically onto this
  mainline and #69 is in its full gate. #71 passed independent review and was
  rebased patch-identically onto this mainline.

## 2026-07-14 — Checkpoint: issue #69 / PR #74

- Task: make budgeted text export single-scan and correct across layout
  discontinuities (`#69`).
- Branch/head: `codex/69-text-budget-export` at
  `331106fee2106d249fd8594148d5158a00daa7e4`, rebased conflict-free and
  patch-identically onto main `1b0ed2f4fbbc62ca2d23b980fbfa02002ec0b054`.
- PR: `#74`, merged normally by the central runner as
  `8bbc273a86803cd854e2de7d9e502f66ac658264`; it closed `#69`.
- Changed behavior: budgeted text export scans/enriches once, evaluates every
  candidate width instead of assuming pagination is monotonic, selects the
  widest actual fit, preserves/clamps an explicit page, and returns an
  actionable failure with no stdout or output file when no layout can fit.
- Verification: the refreshed exact head passed the Node 24.15.0 full gate
  with 532/532 tests, typecheck, and build. Focused export regressions, final
  diff check, exact range-diff equality, and stable patch-id comparison passed.
- Review: lead and independent review approved the final patch. An earlier
  review caught a requested-page regression; it was fixed, covered, and
  re-reviewed before publication.
- Merge queue: the central runner built disposable integration result
  `2bd790286f9d23e24af13a016c7f37d52d35419f`, reran the 532-test full gate,
  and reconfirmed the exact head, clean mergeability, and required
  Ubuntu/macOS/Windows Node 24 plus pack-smoke checks before merging normally.
  The repository lead did not execute the merge; no deployment occurred.
- Decisions/blockers: medium-risk headless export control flow, no product
  judgment. Tests use synthetic scans and temporary output; scanned
  repositories remain read-only.
- Discovery refresh: the bounded follow-up queue is now tracked as #76–#79;
  #76 and #78 started in isolated worktrees while #70/#71 finish.

## 2026-07-14 — Recurring recovery and observer discovery refresh

- The lead inspected note persistence/recovery on current main while an
  unseeded scout independently mapped observer, cache, and snapshot behavior.
  The refresh ignored the dated mission seeds and used only source, tests,
  docs, temp-fixture reasoning, and tracker deduplication.
- `confirmed` — a malformed, incompatible, or structurally empty note index
  is treated as a missing first-run index. `loadNotes` writes a new
  legacy/scratch index without indexing existing safe Markdown bodies, hiding
  them from subsequent workbench loads. Recovery is tracked as `#76`.
- `confirmed` — note mutation APIs do not expose persistence outcomes clearly
  enough for the workbench. Manual and idle save paths can show success even
  when a body write failed and the editor remains dirty. Truthful feedback is
  tracked as `#77` and serialized behind #76 because their owned paths overlap.
- `confirmed` — a failed-root full scan initially preserves absent snapshot
  entries, but the next single-repo/new-repo incremental reconcile uses the
  pruning default. A recovered repo can therefore generate a phantom
  `repo-added` event. Snapshot preservation is tracked as `#78`.
- `confirmed` — full scans discover nested repositories, while root watchers
  are non-recursive and the 30-second fallback refreshes only known repos.
  Nested or missed-event repos remain absent until a manual rescan/restart.
  Bounded root reconciliation is tracked as `#79`.
- Queue decision: file only these four separable, high-confidence cards in
  this refresh. All are medium-risk local engineering work with falsifiable
  temp-state verification and no owner/product judgment. #76 and #78 are the
  first independent implementation lanes; #77 follows #76 and #79 follows
  after the snapshot contract is stable.

## 2026-07-14 — Checkpoint: issue #71 / PR #75

- Task: harden terminal-session teardown and signal semantics (`#71`).
- Branch/head: `codex/71-terminal-session` at
  `985587e97bf0742e2a529e8527ea05112131f972`, rebased conflict-free and
  patch-identically onto main `8bbc273a86803cd854e2de7d9e502f66ac658264`.
- PR: `#75`, merged normally by the central runner as
  `0c5b24c8f77ad38a2fb13b41670bc0a5f71d1073`; it closed `#71`.
- Changed behavior: an idempotent terminal session now owns frame wrapping,
  focus subscription, stdout restoration, terminal-mode teardown, process
  listeners, and truthful conventional SIGHUP/SIGINT/SIGQUIT/SIGTERM exits.
  Teardown handles short synchronous fd writes and waits for the original
  writer callback when synchronous output is unavailable, while repeated
  signals remain guarded until cleanup completes.
- Verification: the refreshed current-stack Node 24.15.0 full gate passed
  typecheck, 543/543 tests, and build; focused lifecycle/focus/mouse/terminal
  coverage passed 32/32, range-diff equality and final diff checks passed.
- Review: lead and independent failure/trust review approved the final patch.
  Earlier reviews found Windows callback truncation, cleanup-failure,
  repeated-signal, and partial-write defects; all were fixed and re-reviewed.
  The GitHub review-feedback workflow later found zero reviews and zero inline
  threads behind a failed non-required Mira check; its only comment remained
  a content-free “reviewing” placeholder, so no code response was warranted.
- Merge queue: the central runner built disposable integration result
  `37f8bbfa89d0ecd918549e473da88486d881c693`, passed the 543-test full gate,
  and verified the exact integration tree. Strict required contexts were
  Ubuntu/macOS/Windows Node 24 and pack-smoke, all successful. Mira was not a
  required context; the normal non-admin merge was permitted without bypass.
  The repository lead did not execute the merge; no deployment occurred.
- Decisions/blockers: medium-risk process and terminal plumbing, no product
  judgment. Headless commands still return before terminal setup and non-TTY
  output remains a no-op.
- Discovery refresh: #70 is refreshed onto this mainline; #76 and #78 remain
  active, with #77 and #79 queued behind their overlapping paths.

## 2026-07-14 — Checkpoint: issue #70 / PR #80

- Task: validate export CLI options and honor requested GIF duration (`#70`).
- Branch/head: `codex/70-export-cli-validation` at
  `12f592043e11ec2b68dcabf4543513d65b7f70da`, rebased conflict-free and
  patch-identically onto main `0c5b24c8f77ad38a2fb13b41670bc0a5f71d1073`.
- PR: `#80`, merged normally by the central runner as
  `f5e4d60191b94eb17e5e9ee6ac17c40b58ab615d`; it closed `#70`.
- Changed behavior: export parsing is strict and command-aware, rejects
  missing/unknown/duplicate/unsafe numeric options before scanning or
  allocation, and enforces documented raster/frame caps. GIF timing now uses
  coherent centisecond frame plans whose encoded delays match the requested
  duration while preserving default and legacy programmatic options.
- Verification: the final current-stack Node 24.15.0 full gate passed
  typecheck, 551/551 tests, and build. Twenty-three focused export/help tests,
  exact range-diff equality after each strict-base refresh, and final diff
  checks passed.
- Review: lead and independent review approved. Direct default, legacy, and
  explicit-delay compatibility tests were added after a non-blocking review
  suggestion. A thread-aware GitHub audit found zero reviews/inline threads
  behind the non-required Mira failure, so no code response was warranted.
- Merge queue: the central runner built disposable integration result
  `456984a20848032d16af212b2c1b9b09c4f9702a`, passed the 551-test full gate,
  and confirmed the exact integration tree. Required Ubuntu/macOS/Windows
  Node 24 and pack-smoke contexts passed; Mira was non-required and had no
  finding. Normal non-admin merge succeeded without bypass. The repository
  lead did not execute the merge; no deployment occurred.
- Decisions/blockers: medium-risk CLI validation/allocation/timing, no product
  judgment. Direct internal callers retain legacy timing flexibility; every
  user-reachable CLI path is bounded before work begins.
- Discovery refresh: #76 is in independent review. #78's independent review
  found two broader reconciliation holes; its owner is fixing scoped-export
  pruning and failed incremental inspection before re-review. #77 and #79
  remain the next non-conflicting tracker slices.

## 2026-07-14 — Review-derived scanner follow-up

- `confirmed` — `findRepos` silently skips a descendant when `readdirSync`
  fails, but the synchronous/progressive scan result carries no partial-inventory
  signal. A nominally complete scan can therefore prune a temporarily
  unreadable subtree and later emit phantom `repo-added` history.
- This is distinct from #78's incremental/scoped authority and #79's live
  nested discovery. It is deduplicated and tracked as `#81`, dependent on
  #78's complete-vs-incremental contract. Verification must inject traversal
  failure rather than relying on chmod behavior under privileged CI.

## 2026-07-14 — Checkpoint: issue #78 / PR #82

- Task: preserve snapshot truth across partial and incremental refreshes
  (`#78`).
- Branch/head: `codex/78-preserve-partial-snapshots` at
  `4599fdf1ed71482cc20a505b89878e1169ebd079`, based directly on main
  `f5e4d60191b94eb17e5e9ee6ac17c40b58ab615d`.
- PR: `#82`, merged normally as
  `c50ffe81ec9c5380949fc96b50ee6fc9d5c24706`; it closed `#78`.
- Changed behavior: absent snapshot entries survive partial root scans,
  scoped exports, new-repository refreshes, and single-repository refreshes.
  Only a successful complete inventory may prune missing repositories, and
  incomplete incremental Git inspections retain the known-good baseline.
- Verification: the exact reviewed head passed the Node 24 full gate with
  typecheck, 556/556 tests, and build. The merge tree is identical to that
  reviewed head. Post-merge CI passed on Ubuntu, macOS, and Windows with Node
  22 and 24, including the package smoke test; the repository Pages workflow
  also completed successfully.
- Review: independent medium-risk review approved the exact three-commit
  patch, post-rebase range-diff confirmed it was unchanged, and the final Mira
  review reported no specific issue with 4/5 confidence.
- Merge queue: the interrupted session left this as the sole open central
  merge candidate. Recovery reconfirmed the exact head and base, reran the
  Node 24 gate, waited for current checks, and merged without bypass. The
  feature branch was removed after the merge.
- Decisions/blockers: medium-risk snapshot and journal persistence semantics,
  no product judgment. No package or application release occurred; the normal
  documentation Pages publication did.
- Discovery refresh: `#81` is now unblocked by this snapshot-authority
  contract. The remaining automatic queue is `#81`, `#76`, `#77`, and `#79`;
  note-store work `#76` then `#77` must remain serialized, and observer work
  `#79` should coordinate with scanner work `#81`.

## 2026-07-14 — Interrupted-session closeout

- Every published implementation candidate from this mission is merged and
  there are no open pull requests.
- The durable automatic queue remains intentionally open rather than being
  restarted during closeout: scanner completeness (`#81`), note-index
  recovery (`#76`), truthful note-save feedback (`#77`), and nested/missed
  observer reconciliation (`#79`).
- Security coordination `#64` remains owner-only and contains no sensitive
  findings. Unsolicited issue `#83` is not part of the engineering queue.
- Local and remote `main` are synchronized at the final merge, required CI and
  package smoke are green, and no implementation branch remains in flight.
