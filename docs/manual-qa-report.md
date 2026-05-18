# Manual QA Report — feat/usage-overlay (2026-05-17)

> **Status:** all eight bugs fixed. Verification captures recorded
> end-to-end. Three parallel subagents owned the follow-up work after
> the initial sweep; see "App fixes" at the bottom for the merge
> sequence.

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

### B1 — DitherOverlay corrupts journal text on transition (high) ✅ fixed

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

**Fix applied (Option A):** `src/components/DitherOverlay.tsx` rewritten
to render stars as Ink children (`<Box position="absolute">` with one
`<Text>` per row of the overlay area, each containing a width-W string
of glyphs/spaces). The public API (`originRow`, `originCol`, `width`,
`height`, `startedAt`, `durationMs`) is unchanged so `ReadyShell.tsx`
needed no surgery. When the overlay unmounts, Ink's normal
reconciliation repaints the underlying cells — no more space-on-content
corruption. Verified by cycling garden ↔ journal with `reducedMotion=false`
(`verify-journal` capture): hotbar reads `↑↓ pick repo · f all events ·
t all time · d details · jk scroll · ↵ workbench` with every character
intact.

### B2 — Workbench `overview` section renders value over label (high) ✅ fixed

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

### B3 — Workbench layout overflows at 32 rows (medium) ✅ fixed

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

### B4 — HelpOverlay key/description boxes overlap (high) ✅ fixed

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

### B6 — Credit footer wraps and leaves stale chars on shorter hotbars (medium) ✅ fixed

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

### B7 — Onboarding scan-path input collapses to its borders (low) ✅ fixed

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

### B8 — Pre-existing toast overlaps garden panel border (cosmetic) ✅ fixed

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

| Bug | Fix | Files |
| --- | --- | --- |
| B1 | Render dither stars as Ink children (Box `position="absolute"` + per-row Text) so Ink owns reconciliation. | `src/components/DitherOverlay.tsx` |
| B2 / B3 / B4 | Single shared root cause: Yoga's default `flexShrink=1` was letting a height-constrained ancestor (`overflow="hidden"`) squeeze multi-row bordered children below their natural row count. Set `flexShrink={0}` on every multi-row bordered building block. | `src/components/ui/panel.tsx`, `src/components/ui/badge.tsx`, `src/components/ui/keyboard-shortcuts.tsx`, `src/screens/WorkbenchScreen.tsx` |
| B5 | Schedule a 30 ms `setTimeout` after each stdin chunk to flush both parsers' pending buffers; bare Escape resolves without a follow-up key. Regression test added. | `src/lib/mouse.ts`, `src/lib/focus.ts`, `src/cli-main.tsx`, `src/__tests__/mouse.test.ts` |
| B6 | Pass `fallback={false}` to `<Link>` so non-OSC-8 terminals don't append the inline URL; the hotbar fits cleanly on one line. Hyperlink-capable terminals still get the clickable link. | `src/components/Credit.tsx` |
| B7 | `minHeight={3}` on the scan-path input wrapper so Yoga can't collapse its content row to 0. | `src/screens/OnboardingScreen.tsx` |
| B8 | Bump the absolute Toaster `marginTop` from `rows - 7` to `rows - 9` so the toast sits inside the garden panel instead of straddling its bottom border. | `src/screens/ReadyShell.tsx` |

The fixes landed across four commits on `feat/usage-overlay`:

1. `3109647` — B1 + B5 + harness extensions + this report.
2. `aece371` — B2/B3/B4 layout fixes (subagent worktree, then merged).
3. `99b1633` — B6/B7/B8 cosmetic fixes (subagent worktree, then merged).

497/497 tests pass at every commit. Verification captures live under
`/tmp/repogarden-tui-observe/session.k1nBIL/captures/` and
`/tmp/rg-onboard/` for the final pass.

## Remaining loose ends (not in the original B1–B8 list)

- **Event-summary stale tail** on the first journal row
  (`shipped "Refresh live mobile data on focus"ences"`). Predates the
  sweep; visible in both broken and clean journal captures. Likely a
  per-line wrap/truncation quirk in `JournalView` when consecutive
  events render strings of different lengths into the same Text element.
- **Toast content visibility** during the brief rescan toast at 100×32
  is sometimes overwritten by the starfield/sprite painters — only the
  left border is visible while the toast is on screen. The toast
  *position* (B8) is correct now; this is a separate z-ordering issue
  caused by the same painters mentioned at `ReadyShell.tsx:1842-1849`.
  Lower priority — the toast is right-edge-aligned and short-lived in
  practice.
