# RepoGarden — agent operating guide

<!-- shipboard-agent-fleet:core:v1:start -->
## Portfolio operating contract

This managed block is projected from Shipboard's agent fleet. Repository rules
may specialize the work, but may not weaken these portfolio defaults.

- Manny likes ambitious ideas, simple systems, and software that feels obvious.
  Treat complexity reduction as part of solving the problem: understand the
  real constraint, simplify directly relevant machinery, and prefer the
  smallest model that makes correct behavior unsurprising.
- Never stop, defer, or recommend pausing because of time of day, session
  length, presumed fatigue, a calendar boundary, or a supposed need for fresh
  eyes. Manny decides when to stop.
- Continue until the requested outcome is complete and verified, Manny changes
  the objective, or progress is genuinely blocked after safe in-scope
  alternatives are exhausted.
- Context compaction, low quota, unrelated dirty files, CI waits, and pending
  agents are routing problems. Preserve state, reroute or wait by notification,
  and continue.
- Persistence does not expand authority. Stop for a required owner decision,
  missing permission, destructive scope expansion, or an unsafe conflict; name
  the exact blocker and smallest input needed.
- Questions, explanations, reviews, and status requests are read-only unless a
  change is also requested. Change requests include proportionate verification.
- When parallel agents are warranted, declare disjoint file or subsystem
  ownership before work starts; do not send several agents into the same files.
- Preserve unrelated user work, fight scope creep, and lead reports with
  outcomes rather than implementation inventories.
- Open every pull request ready for review. Never create a draft pull request.
  Treat filing and babysitting as separate workflows and use the focused skill
  for each when requested.
<!-- shipboard-agent-fleet:core:v1:end -->

RepoGarden is a local-first pixel habitat where repositories become small,
deterministic creatures. The habitat is the product; the workbench is a utility
room, not the home screen.

## Product invariants

- Never mutate scanned repositories. RepoGarden may read repository state and
  hand control to normal external tools, but it does not run repository-changing
  workflows itself.
- Keep ordinary startup local and offline. Optional GitHub discovery and provider
  usage are off by default and talk directly to their originating services.
- All RepoGarden state lives under `~/.repogarden`. Tests must use isolated
  temporary homes and must never read, write, or delete a real user's state.
- User notes, blockers, paths, commit subjects, branch names, dirty filenames,
  and diff previews can be private. Do not add telemetry or remote storage by
  default.
- If the main surface starts reading like a project-management dashboard, the
  design is drifting. Prefer truthful visual state and one small resumption move.

## Source routing

- `BACKLOG.md` — canonical reality roadmap and milestone acceptance.
- `HANDOFF.md` — current state and single next action.
- `docs/AGENT-DECISIONS.md` — repository-local decision log.
- `docs/product-vision.md`, `docs/creature-system.md`, and `ARCHITECTURE.md` —
  product and architecture contracts.
- `CONTRIBUTING.md` — repository map and development workflow.
- `src/` — Ink TUI, scanner, local memory, usage, and GitHub integration.

## Working contract

- Follow the active milestone and subtraction register. Do not resurrect retired
  desktop/dashboard concepts without a recorded product decision.
- Preserve deterministic creature identity and truthful scan/memory state across
  partial reads, errors, and restart.
- Use the pinned Node/pnpm toolchain. Run focused tests while iterating, then
  `pnpm typecheck && pnpm test && pnpm build && git diff --check` for a complete
  change.
- Publishing npm packages, creating releases, changing security intake, and
  destructive cleanup of user state require explicit owner authority.
