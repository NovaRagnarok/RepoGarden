# Upstream inspirations

Ideas RepoGarden borrows deliberately. Not a clone of any of these.

## nmoya / space-invaders-generator
Used as conceptual inspiration only: mirrored procedural invader silhouettes, eye placement, and runtime pixel rendering. No source code copied.

- mirrored procedural invader silhouettes
- explicit eye placement
- simple runtime pixel rendering

Used here: deterministic per-repo creatures generated from repo identity (`src/lib/sprite.ts`).

## your-project-dashboard
- recursively scan local development directories
- treat "what projects exist?" as a first-class problem
- preserve a quick-resume mindset

Used here: scan roots, multi-repo inventory, "resume this project" framing (`src/lib/scanner.ts`).
