# Ready views & workbench mode toggle — manual smoke

Use this check after touching the JOURNAL view, the cross-repo events store
(`src/lib/events.ts`, `src/lib/event-summary.ts`, `src/hooks/use-events.ts`),
or the workbench PORTRAIT/NOTES mode toggle.

## Start

From the repo root:

```bash
corepack enable
pnpm install
pnpm dev
```

Point it at a directory containing two or three real git repos with at least
a few commits between them.

## Top-strip taxonomy

1. Verify the top-right segmented chrome reads
   **GARDEN · ROOMS · JOURNAL · GITHUB**. There must not be a SHELF or LIST
   segment anywhere.
2. Press `g`. The active segment should advance once per press, cycling
   garden → rooms → journal → GitHub → garden.
3. Click each segment with the mouse. The clicked segment becomes active.
4. Toggle JOURNAL or GITHUB ↔ GARDEN — the star-wipe dither plays during the
   swap unless reduced motion is enabled.
5. Toggle GARDEN ↔ ROOMS — no dither; placements re-tween instead (or snap
   with reduced motion).

## JOURNAL view

1. Click JOURNAL with no creature focused. The right column shows day-grouped
   rows (`today`, `yesterday`, `N days ago`, `ddd mmm d`) of cross-repo
   events. Each row reads `<glyph>  <HH:mm>  <repo-name>  <summary>`.
2. The summary text should be lowercase and affectionate (`shipped "fix tide
   chart"`, not `commit abc1234`). No numeric aggregates or charts anywhere.
3. Press `j/k` — the journal cursor (`▸`) advances row by row.
4. Press `↑/↓` — the left repo picker changes scope without scrolling the journal rows.
5. Press `PgDn` / `PgUp` — selection advances by roughly one page and the
   viewport scrolls so the new cursor stays visible.
6. Press `/`, type a fragment of a repo name or commit subject, press enter.
   The timeline filters to matches. Press `esc` or clear to remove the filter.
7. Click a creature in the left sidebar. The timeline scopes to just that
   repo. Click the same creature again or move to the home row to broaden scope.
8. Select a row and press `↵` — the workbench opens for that repo in
   PORTRAIT mode (assuming PORTRAIT is the last-used mode or first launch).
9. If the journal is empty on first launch, the empty-state copy reads:
   *"the journal fills in as your repos change. come back after a commit,
   a note, or a tide shift."*

## Workbench PORTRAIT / NOTES toggle

1. From GARDEN or ROOMS, focus a creature and press `↵`. The workbench opens.
2. **First launch in a fresh process:** the active mode is PORTRAIT.
3. PORTRAIT shows (top → bottom, omitting empty sections):
   - vibe glyph + reason line (colored to vibe)
   - branch · age · dirty · ahead · behind chips
   - 30-day sparkline + total commits
   - blocker (red alert + markdown body)
   - note to future self (markdown body)
   - what's changed (DiffView per dirty file)
   - recent commits (up to 8)
4. Click the **NOTES** badge in the workbench header. The view swaps to the
   tabbed notes editor. The dirty-diff and recent-commits panels are no
   longer visible — they live in PORTRAIT only.
5. Press `tab` (in NOTES) — note tabs cycle. Type, then wait ~1s — auto-save
   indicator fires.
6. `ctrl+p` opens the command palette (NOTES mode only).
7. Click **PORTRAIT** to swap back.
8. Close the workbench (`esc`), reopen via `↵` on another creature in the
   same session — the last-used mode (NOTES, from step 4) is restored.
9. Quit (`q`) and restart `pnpm dev`. The workbench opens in PORTRAIT
   again — last-used mode is session-scoped, not persisted.

## Events store

1. Edit a note in the workbench and save. Run:
   ```bash
   tail -5 ~/.repogarden/events.jsonl
   ```
   The last line should be a `note-edited` event with `repoName` and a
   signed `charsDelta`.
2. Add a blocker via the memory editor. Confirm a `blocker-added` event
   appears with `firstLine` truncated to 200 chars.
3. Clear the blocker. Confirm a `blocker-cleared` event appears.
4. Edit the blocker in-place (change text without clearing it). Confirm
   **no** event is appended — edits to existing nonempty blockers don't
   emit (avoids typo spam).
5. Commit something in one of the scanned repos, then trigger a rescan
   (`r`). A `commit` event should appear with the commit's `committedAt`
   timestamp, not the scan time.
6. Switch branches in a scanned repo and rescan. A `branch-switched` event
   appears with `from` and `to`.
7. Verify `~/.repogarden/events.meta.json` shows `{ "seeded": true, ... }`
   after first run; subsequent runs do not re-emit the seed events.

## Regressions to watch

- GARDEN motion + creature placement unchanged.
- ROOMS dividers still render where they did before.
- `c` overlay card in GARDEN/ROOMS still toggles and contains the lighter
  peek (no recent-commits or diff — those are PORTRAIT-only now).
- Usage bar still renders in every ready view and the workbench.
- No active `view: "list"` or `view: "shelf"` references in code, docs, or
  help.
