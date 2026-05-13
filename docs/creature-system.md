# Creature system

## Base identity
Each repository becomes one deterministic invader creature.

## Generation rules
- generated from repo identity seed
- mirrored silhouette
- exactly two eyes
- monochrome body with eye cutouts

## Why deterministic generation
- no asset pack dependency
- no PNG pipeline
- new repos get instant creatures
- the same repo keeps the same base creature across restarts

## Why not use raw repo size as the body size
Repo size changes over time and many new repos would start invisible.
Instead:
- species shape is stable
- base creature size comes from seed
- maturity only nudges display scale inside a tight band

## Behavior channels
Visual state should come from position, bubble overlays, slight scaling, and organized placement — not from regenerating the sprite.

Actionable git bubbles stay compact and symbolic: `↓` means the repo likely needs a clean fast-forward pull, while `!` means the remote check failed or the local/remote state needs attention. The older recent-pull `<<` cue is no longer a habitat signal.

## Behavior and motion budget

This is not a game in the traditional sense, but it should borrow game feel.

### Home scene tone
- calm
- alive
- lightly chaotic
- legible in motion
- affectionate

### Creature behavior targets
- awake creatures should look eager, not frantic
- stirring creatures should look a little restless, not noisy
- dozing creatures should look slower and more withdrawn, not broken
- sleeping creatures should look safe and recoverable
- blocker overlays should read as a small `?` pulse, not a separate creature state
- organized mode should feel like creatures politely lining up, not being teleported into a spreadsheet

### Randomness budget

Use randomness for:
- tiny offsets
- phase differences
- idle frame timing
- habitat placement

Do not use randomness for:
- changing core identity
- making names unreadable
- making the scene impossible to scan

### Animation budget

A single static sprite per creature is enough. Terminal cells can't fake smooth animation; don't try. Charm comes from:
- timing of state changes
- creature placement and spacing
- shelf transition polish
- bubble overlays
- occasional motion in the surrounding chrome (selection, scan progress)

### Time-based states
- 0–1 days since activity: awake
- 2–4 days: stirring
- 5–10 days: dozing
- 11+ days: sleeping
- `currentBlocker` present: blocker-specific summary plus `?` bubble overlay

## Eyes
Two mirrored eyes per creature, picked deterministically from a fixed vocabulary (`src/lib/sprite.ts`). The body stays flat and borderless; the readable stroke comes from the body fill around the hole, not a drawn outline. No painted eye states, no per-frame expression cycling.

Mood reads through placement, bubbles, and chrome cues rather than facial animation.

## Organized mode
Creatures line up into tidy rows.
This is not a separate dashboard; it is a formation behavior.

## Species variation
The seed keeps one coherent invader lineage, with a small deterministic set of species families inside it (`src/lib/sprite.ts`). Family-level variation, not a full taxonomy. Future axes (repo category, language family, maturity, biome) can map into species without breaking identity stability.
