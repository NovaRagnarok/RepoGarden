# Manual QA Report — feat/usage-overlay (2026-05-17)

End-to-end sweep of every UI surface, driven by `scripts/tui-observe.sh`
(tmux + `capture-pane`). Default terminal 100×32; resized to 140×50 and
40×12 where it mattered. Scan root: `/home/outsideheaven/repos/CleverCat`
(33 repos). Captures live under `/tmp/repogarden-tui-observe/session.*/captures/`.

## Coverage

| Surface | Result | Captures |
| --- | --- | --- |
| Boot / first scan | clean | `boot-state.txt`, `clean-start.txt` |
| Onboarding (FIRST RUN) | minor — input box collapsed | onboarding tmux session |
| Demo mode (`d` on onboarding) | clean | onboarding tmux session |
| Edit-roots (`p`) | clean | `edit-roots.txt` |
| Garden view | clean | `boot-state.txt` |
| Shelf view (`g`) | clean | `shelf-view.txt` |
| Journal view (`g`) | **broken w/ motion**, clean w/ NO_MOTION | `journal-view-3.txt`, `journal-rmot.txt` |
| Filter (`/` + chars) | clean (single chars only) | `filter-typed.txt` |
| Workbench (1–6 sections) | layout overflow at 32 rows; **overview overlap bug at any size** | `wb-clean.txt`, `wb-tall.txt`, `wb-actions.txt`, `wb-notes.txt`, `wb-activity.txt`, `wb-changes.txt`, `wb-commits.txt` |
| Workbench close (`esc`) | **broken** before fix; clean after | `esc-after-fix.txt` |
| Settings — themes | clean | `settings-pre-motion.txt` |
| Settings — prefs (`Tab`) | clean | `settings-prefs.txt`, `settings-prefs-clean.txt` |
| Help overlay (`?`) | **layout collapsed — key boxes overlap content** | `help-overlay.txt` |
| Usage overlay (`U`) | clean (placeholder content while `REPOGARDEN_DISABLE_USAGE=1`) | `usage-overlay.txt` |
| Resize prompt (≤80×24) | clean | `too-small.txt` |
| Quit (`q`) | clean | tmux session exits |

## Bugs found

### B1 — DitherOverlay corrupts journal text on transition (high, deferred)

**Repro:** With `reducedMotion=false`, cycle to journal view via `g`. After
the transition completes, lines inside the journal box have random missing
characters (e.g. `↑↓ pick repo · f a l ev  ts · t all   me       t i   · j    r    ·`).
The corruption is permanent — it does not heal until something forces a
full Ink rerender of the affected line.

**Root cause:** `src/components/DitherOverlay.tsx` paints "star" glyphs
over the journal area using absolute-cursor escape sequences written via
`stdout.write`. Both the per-tick erase (lines 99–104) and the t≥1
cleanup (lines 61–73) clear painted cells by writing a space at the same
absolute position. That space overwrites whatever Ink had rendered at
that cell. Ink's diff cache still thinks the original character is on
screen, so the next render emits nothing for that cell — the journal is
left with permanent holes.

**Workaround:** toggle reduced motion (Settings → prefs → `m`, or set
`NO_MOTION=1` / `CI=true`). With dither disabled the journal renders
perfectly (see `journal-rmot.txt`).

**Why deferred:** the proper fix is bigger than a sweep change. Three
options, none trivial:

- **A.** Render stars as Ink children (absolute-positioned `Box`/`Text`)
  so Ink owns the reconciliation; the overlay unmounting naturally
  triggers Ink to repaint underlying cells. Cleanest but is a rewrite of
  the overlay.
- **B.** Force Ink to invalidate its lastOutput cache on overlay cleanup.
  Ink has no public lever for this; would need monkey-patching the
  log-update writer.
- **C.** Append an invisible-but-changing character to the rendered tree
  on cleanup so Ink's diff sees a different frame and re-emits all lines.
  Hacky and fragile.

Option A is the recommended path; tracking as a follow-up.

### B2 — Workbench `overview` section renders value over label (high)

**Repro:** Open any creature in the workbench (`Enter`). Look at the
`snapshot` panel. At any terminal size where the panel renders both rows
(≥ ~40 rows), the stats render as:

```
75%lth                  551mits              0/1es              6ctivity
steady                  117 in 30d           empty              events in 7d
```

The first row is `<value><tail-of-label>` for each stat — value (`75%`,
`551`, `0/1`, `6`) overlays the leading characters of the label
(`health`, `commits`, `notes`, `activity`), leaving only the suffix
visible. Verified at 140×50 (`wb-tall.txt`, `wb-tall-details.txt`) so it
is not a clipping artifact. The label row simply does not get its own
row.

**Suspect:** `src/screens/WorkbenchScreen.tsx:2046-2057`. The outer Box
is row-direction with explicit child widths; each inner Box is
column-direction with no height. The vertical stacking of `label` →
`value` → `detail` should produce three rows but Yoga is producing
two — likely because the row-direction parent's cross-axis sizing is
collapsing the children, or because `alignItems` is defaulting in a way
that overlays the first two Texts. Not yet root-caused.

### B3 — Workbench layout overflows at 32 rows (medium)

**Repro:** Open workbench at 100×32 (default observe size). Multiple
artefacts:

- Section tabs `[1 overview] [2 actions] …` lose their bottom border:
  `╭────────────╮─╭───────────╮─╭─────────╮─╭────────────╮ ╭───────────╮ ╭───────────╮`
  with the `─` connectors and the next row reading
  `1 file changed; open changes for a quick diff.────────╯ ╰────────╯`
  — the alert and the tab-bottom share a screen row.
- Inner `snapshot` and `top actions` panels collapse to two-line
  rendered boxes with no visible content; their content appears
  *outside* the panel, between the panel borders and the next sibling.
- Status breadcrumb (`section 1/6 · details off · ~/repos/root/<repo>`)
  is pushed off-screen, leaving leftover characters like `~/repos/ro t/`
  visible on the hotbar row.

At 140×50 (`wb-tall.txt`) the same content renders cleanly except for B2.
Confirms this is a "doesn't fit in 32 rows" overflow, not corruption.

**Suspect:** the workbench's top section (sprite portrait + meta + mode
toggles + chips + section tabs + alert) is taller than expected and
leaves too little room for the section content. A height budget check
on the section panels, or a more compact header, would help.

### B4 — HelpOverlay key/description boxes overlap (high)

**Repro:** From the ready shell, press `?`. The shortcuts panel
renders with multiple `┌──┐` key boxes' top borders appearing on the
same row as adjacent shortcut descriptions, and bottom borders missing
entirely (`help-overlay.txt`).

Each `ShortcutRow` (`src/components/ui/keyboard-shortcuts.tsx:25-38`)
has a bordered `KeyLabel` (3 rows tall: top, key, bottom) next to a
plain `Text` description (1 row tall) under `alignItems="center"`. The
expected stacking is 3 rows per grid row; the actual rendering compresses
multiple rows into the same screen rows. The fact that descriptions
also appear *between* key-box borders points at the same Yoga/Ink
column-collapse pattern as B2 — the grid row height isn't matching
`KeyLabel`'s natural height. Reproduced at 100×32 and 140×50.

The `compact` tier path (`responsive.tier === "compact"`, plain `Text`
rows) is fine — only the bordered-key variant is broken.

### B5 — Bare Escape never reaches Ink → screens won't close on single ESC ✅ fixed

**Repro (before fix):** Open the workbench. Press Escape once and wait.
Nothing happens. Press any other key — Escape now takes effect.

**Root cause:** `src/lib/mouse.ts` and `src/lib/focus.ts` both hold a
trailing `\x1b` in a `pending` buffer in case it's the first byte of a
split escape sequence (SGR mouse / focus). With no follow-up byte, the
held `\x1b` sits in `pending` forever — Ink never sees an Escape
keystroke. Demonstrated cleanly via the observe harness, but the bug
applies in real terminal use whenever a user taps Escape and pauses.

**Fix applied:** `src/cli-main.tsx` now schedules a 30 ms timer after
each stdin chunk; if either parser still has bytes pending, the timer
flushes them to Ink. Tests in `src/__tests__/mouse.test.ts` cover both
the existing held-then-released behaviour and the new flush path.
After the fix, single Escape closes Settings, Workbench, Help, Usage,
and Edit-roots reliably (`esc-after-fix.txt`).

### B6 — Credit footer wraps and leaves stale chars on shorter hotbars (medium)

**Repro:** Settings and other narrow-hotbar screens show:

```
tab switch · ↑/↓ pick · enter apply · click row ·★          (https://github.com/NovaRagnarok/RepoG
                                                  RepoGardenarden)
```

The `★ RepoGarden (…)` Credit wraps onto a second line and the wrap
chunk overlaps the previous frame's content (`RepoGarden`/`Garden)` →
`Gardenarden`). The footer Box uses `justify-content: space-between`
with the hotbar Text on the left (`wrap="truncate-end"`) and `Credit` on
the right (`flexShrink={0}`). When the hotbar text contracts between
screens, `Credit` doesn't reposition cleanly and Ink's per-line diff
appears to leave the previous frame's tail visible on the wrapped row.

Reproduced in `settings-pre-motion.txt`, `settings-prefs.txt`,
`settings-prefs-clean.txt`. Not yet root-caused; may share a root with
B2/B4 (Yoga sizing) or be its own line-wrap quirk.

### B7 — Onboarding scan-path input collapses to its borders (low)

**Repro:** First run (no `~/.repogarden/tui.json`). The path input
renders as two adjacent border lines with the prompt and cursor on the
bottom border:

```
 ┃ ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓ ┃
 ┃ ┗━>  █━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛ ┃
```

It's still usable (typing fills the box, Enter scans) but the interior
content row is missing. Likely an explicit `height={2}` or `minHeight`
mismatch on the input field's surrounding Box.

### B8 — Pre-existing toast overlaps garden panel border (cosmetic)

When a toast fires (e.g. "reduced motion · on", "demo mode · synthetic
repos…"), it floats absolutely positioned 7 rows above the bottom and
its bordered box renders *across* the garden panel's bottom border:

```
 ╭───────────────────────╮
 │ ℹ reduced motion · on │
 ╰───────────────────────╯━━━━━━━━━━…
```

Intentional per the comment at `ReadyShell.tsx:1842-1849`
(stop-pushing-flow), but the visual is jarring. Lowering the toast by
~2 rows or fading the underlying border under it would resolve it.

## Harness fixes (applied to `scripts/tui-observe.sh`)

The original `send` allowlist was `g|j|k|h|o|p|q|r|s|t|f|d|c|/|?`,
which couldn't reach page nav (`[` / `]`), capitals (`U`, `T`, `B`),
ctrl chords, or arbitrary text input. Extended to:

- any single printable character via a generic 1-char branch
- `C-<key>` chords (passed straight to `tmux send-keys`)
- `text:<string>` for literal multi-char input
- `Tab` / `Space` synonyms

## App fixes (applied)

| Change | File | Reason |
| --- | --- | --- |
| Export `flushPending` + `hasPending` from mouse/focus parsers | `src/lib/mouse.ts`, `src/lib/focus.ts` | Lets the stdin pipeline release held bytes once it's clear no completion is coming. |
| Schedule a 30 ms `setTimeout` after each stdin chunk to flush both parsers' pending buffers | `src/cli-main.tsx` | Bare Escape resolves within 30 ms instead of waiting indefinitely for a follow-up keystroke. |
| Test the flush path | `src/__tests__/mouse.test.ts` | Locks in B5 fix; 497/497 tests still pass. |

## Recommendations / next steps

1. **B1** — design pass on `DitherOverlay`; the absolute-escape painter
   needs to become an Ink-managed render path so Ink owns cleanup.
2. **B2 + B4** — both likely share a Yoga/Ink layout quirk in nested
   row-flex with bordered children. Worth a single dedicated
   investigation rather than two patches.
3. **B3** — give the workbench a height-aware variant (or set a hard
   floor on the section-content panel height) so 80×24 and 100×32
   terminals don't fall off a cliff. The minimum advertised by the
   resize prompt is 80×24; the workbench is clearly the most rows-
   hungry surface and should still degrade gracefully there.
4. **B6** — investigate Credit positioning; consider truncating the URL
   or moving it out of the hotbar row when the hotbar is short.
5. **B7** — minor; bump the input field's height to 3 (or set
   `minHeight={3}`).
6. **B8** — cosmetic; revisit toast layering.
