# Product vision

RepoGarden is a local-first habitat for side projects.

The home screen is not a dashboard. It is a little retro world where each repository appears as a tiny monochrome creature whose behavior reflects momentum, neglect, blockers, and personality.

## Emotional goal

The user should feel:
- curiosity
- affection toward neglected projects
- fast context recovery
- reduced shame around abandonment
- renewed momentum from very small restart actions

## Core promise

Without requiring heavy manual upkeep, the app should help the user answer:

- what projects are alive right now?
- which ones are sleeping?
- where did I leave off?
- what is blocking me?
- what is the smallest useful next move?
- which project is secretly worth reviving?

## Target user

A solo builder or small creative technical operator who:
- starts new repositories frequently
- abandons things sometimes
- forgets where progress stopped
- wants local-first tooling
- dislikes corporate project-management software
- responds well to visual whimsy

## Product fantasy

Open the app and see your repos wandering around like tiny Space Invader creatures.
Some are bouncy and awake.
Some are dozing off.
Some are pacing because they are blocked.
Some gather together.
A click opens a pixel context menu with just enough intelligence to help you re-enter the work.

## Anti-fantasy

This is not:
- a prettier Jira
- a kanban board with sprites taped on top
- a charts-and-metrics monitor
- a productivity guilt engine
- a cloud-first surveillance tracker

## Design principles

### Habitat first
The habitat is the main product surface. Everything else supports it.

### Motion is meaning
Use movement, spacing, and idle behavior to communicate state before text does.

### The creatures are beings, not icons
Each project should feel persistent and recognizable.

### Use data softly
Inference should feel suggestive, not authoritarian. Avoid fake certainty.

### The workbench is secondary
Detailed project information exists, but it should sit one layer deeper.

### Local-first by default
Prioritize on-device scanning, storage, and interpretation.

### Small restart actions beat giant plans
Prompts should help the user re-enter with momentum, not overwhelm them.

### Cute cannot break clarity
Whimsy is not an excuse for confusion.

### Stable identity, changing behavior
A project's creature should stay recognizably itself while its state changes via animation, mood, and overlays.

### Avoid punishment loops
Staleness should look sleepy or neglected, not shaming.

## Explicit anti-goals

Do not accidentally turn RepoGarden into:

- a spreadsheet of repositories
- a ticketing system
- a kanban-first planner
- a giant metrics dashboard
- a surveillance tool
- a cloud dependency
- a "productivity score" toy that makes the user feel bad
- a manually-updated status board that rots instantly

### Home screen no's

- no table rows
- no default card grid
- no giant charts
- no all-text experience
- no modal stack that hides the habitat entirely

### Creature no's

- no PNG asset packs for the base creature system
- no requiring hand-drawn sprites
- no unstable random rerolls every render
- no giant repo-size swings that make new projects invisible

## Core verbs

- notice
- remember
- resume
- soothe
- revive
- organize briefly, then return to play
