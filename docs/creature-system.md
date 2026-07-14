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

Actionable git bubbles stay compact and symbolic: `↓` means the repo likely needs an update through the user's normal git workflow outside RepoGarden, while `!` means the remote check failed or the local/remote state needs attention. The older recent-pull `<<` cue is no longer a habitat signal.

## Behavior and motion budget

This is not a game in the traditional sense, but it should borrow game feel.

### Home scene tone
- calm
- alive
- lightly chaotic
- legible in motion
- affectionate

### Creature behavior targets
- awake creatures should look active, not frantic
- happy creatures should look settled, not finished or ignored
- stuck creatures should look like they need a small unblock, not like they are broken
- sleepy creatures should look quiet and recoverable
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
- rooms transition polish
- bubble overlays
- occasional motion in the surrounding chrome (selection, scan progress)

### Captions and emotion cues

Two terminal-native ways mood reaches the garden itself (`src/lib/garden-captions.ts` + `src/garden/render.ts`), both within the budget above — chrome cues, not facial animation:

- **Focus caption.** The focused creature gets one muted line adjacent to its focus frame: `<glyph> <mood> — <moodReason>` (e.g. `✶ excited — 6 unpushed commits stacked up`). At most one caption is ever on screen. It prefers the sky row above the frame, falls back below the name row, squeezes into the clear gap next to neighbours (ellipsis truncation, never wrapping), and skips entirely rather than paint over another creature. It is static information, so it shows under reduced motion too.
- **Transient emotion cues.** Occasionally a creature's mood glyph blinks into the sky-row slack above its shoulder for ~1.2–1.8 s, on a deterministic per-identity schedule (seeded mulberry32, period ~9–15 s with phase jitter — same pattern as blink timing). At most **2** creatures show a cue in any frame (deterministic lowest-identity-hash tie-break), the focused creature never does (its caption owns the signal), and cues are fully disabled under reduced motion and in pinned/export renders.

Both surfaces share the same gate: mood confidence must be ≥ 0.65 (`MOOD_DISPLAY_CONFIDENCE_THRESHOLD` in `src/lib/vibe.ts`, shared with the portrait chip) and `content` — the no-signal mood — renders nothing.

Glyph vocabulary (single-cell, deliberately distinct from the vibe glyphs `!` `•` `✕` `z`, the git bubbles `↓` `!`, and the starfield `·` `*` `+` `✦` `✧` `⋆`):

| mood | glyph | accent |
| --- | --- | --- |
| excited | `✶` | info |
| proud | `★` | success |
| curious | `◦` | info |
| anxious | `~` | warning |
| confused | `¿` | error |
| lonely | `…` | muted |

### Vibes, mood, and confidence
Vibe is the grouping-level state. It decides which room a creature belongs to and which accent color/glyph it carries:

- `awake`: uncommitted changes or unpushed commits
- `happy`: clean working tree, in sync with remote
- `stuck`: user-written `currentBlocker` is present
- `sleepy`: no commits for the sleepy threshold or longer

Vibe precedence is intentionally simple: `stuck` wins first, then long-quiet repos become `sleepy`, then local changes make a repo `awake`, otherwise it is `happy`.

Mood is advisory and layered on top of vibe. It can describe softer signals such as `curious`, `excited`, `proud`, `anxious`, `confused`, `lonely`, or `content`, with a 0–1 confidence score. Nothing branches on mood; renderers may surface it when confidence is high enough and it adds information.

Activity is continuous, not a separate vocabulary. It decays from recent commit time and can influence subtle motion/placement, while the displayed vocabulary stays `awake` / `happy` / `stuck` / `sleepy`.

## Eyes
Two mirrored eyes per creature, picked deterministically from a fixed vocabulary (`src/lib/sprite.ts`). The body stays flat and borderless; the readable stroke comes from the body fill around the hole, not a drawn outline. No painted eye states, no per-frame expression cycling.

Mood reads through placement, bubbles, and chrome cues rather than facial animation.

## Organized mode
Creatures line up into tidy rows.
This is not a separate dashboard; it is a formation behavior.

## Species variation
The seed keeps one coherent invader lineage, with a small deterministic set of species families inside it (`src/lib/sprite.ts`). Family-level variation, not a full taxonomy. Future axes (repo category, language family, maturity, biome) can map into species without breaking identity stability.
