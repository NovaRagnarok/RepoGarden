import { Box, Text, useFocusManager } from "ink";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { CommandPalette, type CommandPaletteItem } from "@/components/ui/command-palette";
import { Credit } from "@/components/Credit";
import { CreatureSprite } from "@/components/CreatureSprite";
import { DiffView } from "@/components/ui/diff-view";
import { Markdown } from "@/components/ui/markdown";
import { Panel } from "@/components/ui/panel";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Sparkline } from "@/components/ui/sparkline";
import { TextArea, type TextAreaCursorState, type TextAreaSelectionRequest } from "@/components/ui/text-area";
import { TextInput } from "@/components/ui/text-input";
import { useTheme } from "@/components/ui/theme-provider";
import { useToasts } from "@/components/ui/toast-host";
import { UsageBar, UsageBarPlaceholder } from "@/components/UsageBar";
import { ResizePrompt } from "@/components/ResizePrompt";
import { useInput } from "@/hooks/use-input";
import { useMouse } from "@/hooks/use-mouse";
import { useTerminalSize } from "@/hooks/use-terminal-size";
import { useUsage } from "@/hooks/use-usage";
import { writeToSystemClipboard } from "@/lib/clipboard";
import type { RepoCreature } from "@/lib/creature";
import { appendEvent, readEvents, type JournalEvent } from "@/lib/events";
import {
  countCommitsBetween,
  pickPullSummary,
  pullRepo,
  readHeadSha,
  type PullResult,
} from "@/lib/git-pull";
import { loadMemory, saveMemory } from "@/lib/memory";
import { findTextMatches, pickNextMatch, positionToOffset } from "@/lib/note-search";
import {
  createNote,
  deleteNote,
  deriveBlockerFromNotes,
  loadNotes,
  renameNote,
  saveNoteBody,
  setActive,
  type NotesState,
} from "@/lib/notes";
import {
  buildPortraitClipboardText,
  buildPortraitModel,
  cyclePortraitSection,
  PORTRAIT_SECTIONS,
  sectionItemCount,
  sectionLabel,
  sectionPageSize,
  type PortraitModel,
  type PortraitSectionId,
  type PortraitSeverity,
} from "@/lib/portrait";
import { tildify } from "@/lib/scanner";
import { getTerminalLayout } from "@/lib/responsive-layout";
import { creatureCharSize } from "@/lib/sprite";
import { vibeGlyph } from "@/lib/vibe";

export interface WorkbenchScreenProps {
  creature: RepoCreature;
  onClose: () => void;
  onPulled?: (creature: RepoCreature) => void;
  usageBarDisabled?: boolean;
}

// In-memory, session-scoped last-used workbench mode. NOT persisted to disk —
// user explicitly chose per-session so new processes always start at PORTRAIT.
let lastWorkbenchMode: "portrait" | "notes" | null = null;

type Mode =
  | { kind: "edit" }
  | { kind: "naming"; target: "create" | { rename: string } }
  | { kind: "search" }
  | { kind: "goto-line" }
  | { kind: "confirm-clear" }
  | { kind: "confirm-delete" }
  | { kind: "confirm-pull" }
  | { kind: "pulling" }
  | {
      kind: "status";
      message: string;
      variant: "success" | "info" | "warning" | "error";
      sticky?: boolean;
    };

export const WorkbenchScreen = ({
  creature,
  onClose,
  onPulled,
  usageBarDisabled = false,
}: WorkbenchScreenProps) => {
  const theme = useTheme();
  const { columns, rows } = useTerminalSize();
  const responsive = getTerminalLayout(columns, rows);
  const isCompact = responsive.tier === "compact";
  const focusManager = useFocusManager();
  const usage = useUsage(undefined, { disabled: usageBarDisabled });
  const { push: pushToast } = useToasts();

  // Char-delta threshold: edits smaller than this don't get a "+N chars" hint.
  // Matches the audit-#5 spec — small typo-edits would otherwise spam the toast
  // host. Skipping the hint (not the toast itself) keeps the save acknowledged
  // without surfacing trivia.
  const CHARS_DELTA_HINT_THRESHOLD = 20;
  const formatCharsDelta = (delta: number): string => {
    if (Math.abs(delta) < CHARS_DELTA_HINT_THRESHOLD) return "";
    return delta > 0 ? ` · +${delta} chars` : ` · ${delta} chars`;
  };

  const [notes, setNotes] = useState<NotesState>(() => loadNotes(creature.id));
  const activeId = notes.index.active;
  const activeMeta = notes.index.notes[activeId];
  const [editor, setEditor] = useState<string>(notes.bodies[activeId] ?? "");
  const [pendingName, setPendingName] = useState<string>("");
  const [pendingSearch, setPendingSearch] = useState<string>("");
  const [pendingGoto, setPendingGoto] = useState<string>("");
  const [selectionRequest, setSelectionRequest] = useState<TextAreaSelectionRequest | undefined>();
  const [editorCursor, setEditorCursor] = useState<TextAreaCursorState>({
    line: 0,
    col: 0,
    visualRow: 0,
    visualCol: 0,
    totalLines: 1,
    totalVisualRows: 1,
    selection: null,
    selectedChars: 0,
  });
  const [uiMode, setUiMode] = useState<Mode>({ kind: "edit" });
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [portraitSectionIndex, setPortraitSectionIndex] = useState(0);
  const [portraitDetailsOpen, setPortraitDetailsOpen] = useState(false);
  // Within-section scroll offset for the active PORTRAIT section. Reset to
  // 0 whenever the active section changes (or detailsOpen flips and the
  // page size shrinks) so each visit starts at the top. PgUp/PgDn page
  // through; #4 — workbench portrait would otherwise clip its tail on
  // short terminals with long dirty-file or commit lists.
  const [portraitScrollOffset, setPortraitScrollOffset] = useState(0);
  const [portraitEvents, setPortraitEvents] = useState<JournalEvent[]>(() =>
    readEvents({ repoId: creature.id, limit: 40 })
  );
  const selectionRequestCounterRef = useRef(0);

  // Workbench mode: PORTRAIT (read snapshot) or NOTES (write editor).
  // Default is PORTRAIT on first launch — matches notice → understand → act.
  // Per-session memory via module-level lastWorkbenchMode (not persisted to disk).
  const [workbenchMode, setWorkbenchMode] = useState<"portrait" | "notes">(
    () => lastWorkbenchMode ?? "portrait"
  );
  const switchMode = (next: "portrait" | "notes") => {
    if (next === "portrait" && workbenchMode === "notes" && (notes.bodies[activeId] ?? "") !== editor) {
      setNotes(saveNoteBody(creature.id, notes, activeId, editor, creature.scan.name));
    }

    lastWorkbenchMode = next;
    setWorkbenchMode(next);
    // If flipping away from notes, close any open palette / prompts to avoid a stuck modal.
    if (next !== "notes") {
      setPaletteOpen(false);
      setPendingName("");
      setUiMode({ kind: "edit" });
    }
  };

  const dirty = (notes.bodies[activeId] ?? "") !== editor;

  const portraitSection = PORTRAIT_SECTIONS[portraitSectionIndex] ?? "overview";
  const portraitModel = useMemo(
    () => buildPortraitModel(creature, notes, portraitEvents),
    [creature, notes, portraitEvents]
  );

  useEffect(() => {
    setPortraitScrollOffset(0);
  }, [portraitSection, portraitDetailsOpen]);

  const fullWidth = Math.max(20, columns - 2);

  // Focus the editor whenever we drop back into edit mode. useFocusManager()
  // returns a fresh object on every Ink re-render (FocusContext's value is
  // constructed inline), so we hold a ref and depend only on uiMode kind to
  // avoid re-firing every tick.
  const focusManagerRef = useRef(focusManager);
  focusManagerRef.current = focusManager;
  useEffect(() => {
    if (paletteOpen) return; // palette owns its own focus while mounted
    if (workbenchMode !== "notes") return; // portrait mode has no editor to focus
    if (uiMode.kind === "edit" || uiMode.kind === "status") {
      focusManagerRef.current.focus("editor");
    } else if (uiMode.kind === "naming") {
      focusManagerRef.current.focus("new-note-name");
    } else if (uiMode.kind === "search") {
      focusManagerRef.current.focus("note-search");
    } else if (uiMode.kind === "goto-line") {
      focusManagerRef.current.focus("note-goto-line");
    }
  }, [uiMode.kind, paletteOpen, workbenchMode]);

  useEffect(() => {
    if (workbenchMode !== "portrait") return;
    setPortraitEvents(readEvents({ repoId: creature.id, limit: 40 }));
  }, [workbenchMode, creature.id]);

  // When the active note changes (switch via tab), pull its body into the
  // editor buffer. The previous note's edits should already have been
  // persisted by whatever triggered the switch.
  const lastActiveIdRef = useRef(activeId);
  useEffect(() => {
    if (lastActiveIdRef.current !== activeId) {
      lastActiveIdRef.current = activeId;
      setEditor(notes.bodies[activeId] ?? "");
    }
  }, [activeId, notes.bodies]);

  // Auto-dismiss transient status banners after ~1.5s. Confirmations stick
  // until the user acts or hits escape. Pull results pass `sticky: true` so
  // a non-fast-forward error doesn't vanish before the user can read it.
  useEffect(() => {
    if (uiMode.kind !== "status") return;
    if (uiMode.sticky) return;
    const timer = setTimeout(() => setUiMode({ kind: "edit" }), 1500);
    return () => clearTimeout(timer);
  }, [uiMode]);

  // Auto-save on idle: when the editor buffer diverges from the persisted
  // body, schedule a save 1s after the last keystroke. Cancelled on every
  // keystroke (the effect re-runs and the cleanup clears the prior timer),
  // so saves only fire once the user pauses. Manual ctrl+s, tab switches,
  // create/delete/rename, palette open, and close paths already persist
  // synchronously — this only fills the "typed and walked away" gap.
  useEffect(() => {
    if ((notes.bodies[activeId] ?? "") === editor) return;
    const timer = setTimeout(() => {
      const oldBody = notes.bodies[activeId] ?? "";
      const delta = editor.length - oldBody.length;
      const saved = saveNoteBody(creature.id, notes, activeId, editor, creature.scan.name);
      setNotes(saved);
      const name = notes.index.notes[activeId]?.name ?? "note";
      pushToast(`saved · note "${name}"${formatCharsDelta(delta)}`, "info");
    }, 1000);
    return () => clearTimeout(timer);
  }, [editor, notes, activeId, creature.id, pushToast]);

  // Mirror the "blocker"-named note into the legacy ProjectMemory field so
  // the garden's vibe layer (inferVibe) keeps reading the creature as
  // `blocked` when one is set. Re-reads memory from disk so we don't clobber
  // unrelated fields (lastVisitedAt, hidden) updated elsewhere. Runs on
  // every notes-state change — keystroke-level edits don't touch `notes`
  // (only `editor`), so this only fires on explicit save / tab-switch /
  // create / delete paths.
  useEffect(() => {
    const blocker = deriveBlockerFromNotes(notes);
    const current = loadMemory(creature.id);
    if ((current.currentBlocker ?? undefined) === blocker) return;
    const prevBlocker = current.currentBlocker?.trim() ?? "";
    const nextBlocker = blocker?.trim() ?? "";
    saveMemory(creature.id, { ...current, currentBlocker: blocker }, creature.scan.name);
    // Only toast on the empty↔nonempty transitions so a typo-edit inside an
    // existing blocker note doesn't fire a "set" toast on every keystroke
    // pause. Mirrors saveMemory's own event-emit logic.
    if (!prevBlocker && nextBlocker) {
      pushToast("blocker set · stuck", "success");
    } else if (prevBlocker && !nextBlocker) {
      pushToast("blocker cleared", "success");
    }
  }, [notes, creature.id, pushToast]);

  const persistCurrentEditor = (state: NotesState): NotesState => {
    if ((state.bodies[activeId] ?? "") === editor) return state;
    return saveNoteBody(creature.id, state, activeId, editor, creature.scan.name);
  };

  const cycleActive = (direction: 1 | -1) => {
    if (notes.index.order.length < 2) return;
    const idx = notes.index.order.indexOf(activeId);
    const nextIdx =
      (idx + direction + notes.index.order.length) % notes.index.order.length;
    const nextId = notes.index.order[nextIdx];
    const saved = persistCurrentEditor(notes);
    const switched = setActive(creature.id, saved, nextId);
    setNotes(switched);
  };

  const switchToNoteId = (nextId: string) => {
    if (nextId === activeId) return;
    const saved = persistCurrentEditor(notes);
    const switched = setActive(creature.id, saved, nextId);
    setNotes(switched);
  };

  const handleCursorChange = useCallback((state: TextAreaCursorState) => {
    setEditorCursor(state);
  }, []);

  const requestEditorSelection = useCallback(
    (
      anchor: TextAreaSelectionRequest["anchor"],
      cursor: TextAreaSelectionRequest["cursor"]
    ) => {
      selectionRequestCounterRef.current += 1;
      setSelectionRequest({
        key: `${activeId}:${selectionRequestCounterRef.current}`,
        anchor,
        cursor,
      });
    },
    [activeId]
  );

  const selectWholeEditor = useCallback(() => {
    const lines = editor.split("\n");
    const lastLine = Math.max(0, lines.length - 1);
    const lastCol = (lines[lastLine] ?? "").length;
    if (lastLine === 0 && lastCol === 0) {
      setUiMode({ kind: "status", message: "note is empty", variant: "warning" });
      return;
    }
    requestEditorSelection({ line: 0, col: 0 }, { line: lastLine, col: lastCol });
    setUiMode({ kind: "status", message: "selected all", variant: "success" });
  }, [editor, requestEditorSelection]);

  const runSearch = useCallback(
    (rawQuery: string, direction: 1 | -1 = 1, advanceFromCursor = true) => {
      const query = rawQuery.trim();
      if (!query) {
        setUiMode({ kind: "status", message: "search cancelled", variant: "warning" });
        return;
      }

      const matches = findTextMatches(editor, query);
      if (matches.length === 0) {
        const label = query.length > 28 ? `${query.slice(0, 27)}…` : query;
        setUiMode({
          kind: "status",
          message: `no matches for "${label}"`,
          variant: "warning",
        });
        setPendingSearch(query);
        return;
      }

      let cursorOffset = 0;
      if (editorCursor.selection) {
        const edge = direction === 1 ? editorCursor.selection.end : editorCursor.selection.start;
        cursorOffset = positionToOffset(editor, edge);
      } else {
        cursorOffset = positionToOffset(editor, { line: editorCursor.line, col: editorCursor.col });
      }

      const fromOffset = advanceFromCursor
        ? Math.max(0, Math.min(editor.length, cursorOffset + direction))
        : cursorOffset;
      const picked = pickNextMatch(matches, fromOffset, direction);
      if (!picked) return;

      requestEditorSelection(picked.match.start, picked.match.end);
      setPendingSearch(query);
      setUiMode({
        kind: "status",
        message: `match ${picked.index + 1}/${matches.length}`,
        variant: "success",
      });
    },
    [editor, editorCursor, requestEditorSelection]
  );

  const openSearchPrompt = useCallback(() => {
    setPendingSearch((current) => current);
    setUiMode({ kind: "search" });
  }, []);

  const handleSearchSubmit = (rawQuery: string) => {
    runSearch(rawQuery, 1, false);
  };

  const handleGotoSubmit = (rawLine: string) => {
    const lineText = rawLine.trim();
    const requested = Number.parseInt(lineText, 10);
    if (!lineText || !Number.isFinite(requested) || requested < 1) {
      setPendingGoto("");
      setUiMode({ kind: "status", message: "invalid line number", variant: "warning" });
      return;
    }

    const totalLines = editor.split("\n").length;
    const line = Math.max(1, Math.min(totalLines, requested));
    const position = { line: line - 1, col: 0 };
    requestEditorSelection(position, position);
    setPendingGoto("");
    setUiMode({
      kind: "status",
      message: line === requested ? `line ${line}` : `line ${line}/${totalLines}`,
      variant: "success",
    });
  };

  const setPortraitSection = useCallback((section: PortraitSectionId) => {
    const index = PORTRAIT_SECTIONS.indexOf(section);
    if (index >= 0) setPortraitSectionIndex(index);
  }, []);

  const copyPortraitSummary = useCallback(() => {
    const text = buildPortraitClipboardText(creature, portraitModel);
    const ok = writeToSystemClipboard(text);
    setUiMode({
      kind: "status",
      message: ok ? "portrait copied" : "could not copy portrait",
      variant: ok ? "success" : "warning",
    });
  }, [creature, portraitModel]);

  const copyRepoPath = useCallback(() => {
    const ok = writeToSystemClipboard(creature.scan.path);
    setUiMode({
      kind: "status",
      message: ok ? "path copied" : "could not copy path",
      variant: ok ? "success" : "warning",
    });
  }, [creature.scan.path]);

  const pullPreflight = useCallback((): { ok: true } | { ok: false; reason: string } => {
    if (creature.scan.scanError) return { ok: false, reason: "not a git repo" };
    if (creature.scan.isDirty) {
      return { ok: false, reason: "working tree has changes — commit or stash first" };
    }
    if (!creature.scan.branch || creature.scan.branch === "HEAD") {
      return { ok: false, reason: "detached HEAD — checkout a branch first" };
    }
    if (creature.scan.ahead === undefined && creature.scan.behind === undefined) {
      return { ok: false, reason: "branch has no upstream" };
    }
    return { ok: true };
  }, [creature.scan]);

  const requestPull = useCallback(() => {
    const check = pullPreflight();
    if (!check.ok) {
      setUiMode({ kind: "status", message: check.reason, variant: "warning", sticky: true });
      return;
    }
    setUiMode({ kind: "confirm-pull" });
  }, [pullPreflight]);

  const executePull = useCallback(async () => {
    setUiMode({ kind: "pulling" });
    const beforeSha = creature.scan.lastCommitSha;
    let result: PullResult;
    try {
      result = await pullRepo({ cwd: creature.scan.path });
    } catch (err) {
      const message = err instanceof Error ? err.message : "pull crashed";
      setUiMode({ kind: "status", message: `pull failed: ${message}`, variant: "error", sticky: true });
      return;
    }

    const summary = pickPullSummary(result);
    const afterSha = result.ok ? readHeadSha(creature.scan.path) ?? beforeSha : beforeSha;
    let commitsPulled: number | undefined;
    if (result.ok) {
      if (/already up to date/i.test(result.stdout)) {
        commitsPulled = 0;
      } else if (beforeSha && afterSha && beforeSha !== afterSha) {
        commitsPulled = countCommitsBetween(creature.scan.path, beforeSha, afterSha);
      } else if (beforeSha === afterSha) {
        commitsPulled = 0;
      }
    }

    appendEvent({
      ts: new Date().toISOString(),
      repoId: creature.id,
      repoName: creature.scan.name,
      kind: "pull",
      payload: {
        ok: result.ok,
        exitCode: result.exitCode,
        branch: creature.scan.branch,
        beforeSha,
        afterSha,
        commitsPulled,
        summary,
        durationMs: result.durationMs,
        timedOut: result.timedOut,
      },
    });

    if (result.ok) {
      const variant: "success" | "warning" = commitsPulled === 0 ? "warning" : "success";
      const message =
        commitsPulled === 0
          ? `already up to date${creature.scan.branch ? ` with ${creature.scan.branch}` : ""}`
          : commitsPulled !== undefined
            ? `pulled ${commitsPulled} ${commitsPulled === 1 ? "commit" : "commits"}${creature.scan.branch ? ` onto ${creature.scan.branch}` : ""}`
            : `pulled changes${creature.scan.branch ? ` onto ${creature.scan.branch}` : ""}`;
      setUiMode({ kind: "status", message, variant, sticky: commitsPulled !== 0 });
      onPulled?.(creature);
      return;
    }

    setUiMode({
      kind: "status",
      message: `pull failed: ${summary}`,
      variant: "error",
      sticky: true,
    });
  }, [creature, onPulled]);

  const handlePortraitEnter = useCallback(() => {
    if (portraitSection === "notes") {
      switchMode("notes");
      return;
    }
    if (portraitSection === "changes") {
      setPortraitDetailsOpen((value) => !value);
      return;
    }
    if (portraitSection === "actions") {
      const target = portraitModel.actions[0]?.section;
      if (target && target !== "actions") {
        setPortraitSection(target);
        return;
      }
    }
    setPortraitDetailsOpen((value) => !value);
  }, [portraitSection, portraitModel.actions, setPortraitSection]);

  // Mouse-click hit zones. The layout is sprite-gated so we read the sprite
  // height from the same helper the sprite renderer uses. Coordinates are
  // 1-indexed (xterm SGR mouse reporting), top-left = (1, 1).
  //
  // Both wide and narrow layout (after mode toggle introduced in Slice 2):
  //   row 1            outer paddingY=1
  //   rows 2..H+1      header: sprite+info on left (badge removed from header)
  //   row H+2          paddingTop=1 between header and mode toggle
  //   rows H+3..H+5    mode toggle row (PORTRAIT / NOTES badges, 3 rows)
  //   row H+6          paddingTop=1 between mode toggle and tabs
  //   rows H+7..H+9    tabs row (border + content + border)
  //
  // The tab wrapper Box below sets `flexShrink={0}` so the tab's bordered
  // child can't be squished from 3 rows down to 2 when total natural
  // content exceeds the container height — that flex shrink was the source
  // of mouse-click offsets that varied with terminal size.
  // Tab columns start at outer paddingX=1 (col 2) and lay out left-to-right
  // with TAB_GUTTER=1 between each.
  const spriteCharH = creatureCharSize(creature.scan).charH;
  const headerRows = isCompact ? 3 : Math.max(spriteCharH, 3);
  // Mode toggle row position (1-indexed). Same for both wide and narrow.
  const toggleTop = headerRows + 3;
  const toggleBottom = toggleTop + (isCompact ? 0 : 2);
  // Tab row position (1-indexed). See comment above for breakdown.
  // Both wide and narrow: headerRows + 7 (toggle occupies the same slot that
  // the narrow-mode badge used to occupy).
  const tabsTop = isCompact ? toggleBottom + 2 : headerRows + 7;
  const tabsBottom = tabsTop + 2;
  // Editor content origin: just below the Panel's top border (1 row), and
  // offset by outer paddingX (1) + Panel border (1) + Panel paddingX (1) +
  // TextArea paddingX (0) = 4 columns in.
  const editorTopRow = tabsBottom + 2;
  const editorLeftCol = 4;
  // Editor content width: total terminal cols minus outer paddingX (2),
  // Panel chrome (border 2 + paddingX 2 = 4), and the 1-col scrollbar that
  // the TextArea renders on its right edge = columns - 7. Floor at 20 so
  // the wrap math stays sane on very narrow terminals.
  const editorWrapWidth = Math.max(20, columns - 7);

  useMouse(
    useCallback(
      (event) => {
        if (event.kind !== "press" || event.button !== "left") return;

        // 1) Click on the PORTRAIT / NOTES mode toggle badges.
        // Each bordered Badge: text + 2 paddingX + 2 borders. Gap=1 between them.
        // Toggle row is at toggleTop..toggleBottom, starting at col 2 (outer paddingX=1).
        if (!isCompact && event.row >= toggleTop && event.row <= toggleBottom) {
          const segments: { mode: "portrait" | "notes"; label: string }[] = [
            { mode: "portrait", label: "PORTRAIT" },
            { mode: "notes", label: "NOTES" },
          ];
          const widths = segments.map((s) => s.label.length + 4); // text + 2 pad + 2 border
          let cursor = 2; // outer paddingX=1, 1-indexed
          for (let i = 0; i < segments.length; i++) {
            const left = cursor;
            const right = cursor + widths[i] - 1;
            if (event.col >= left && event.col <= right) {
              if (workbenchMode === "notes" && segments[i].mode !== "notes") {
                const saved = persistCurrentEditor(notes);
                if (saved !== notes) setNotes(saved);
              }
              switchMode(segments[i].mode);
              return;
            }
            cursor = right + 2; // 1 gap col between segments
          }
        }

        if (paletteOpen) return;
        if (uiMode.kind !== "edit" && uiMode.kind !== "status") return;
        if (workbenchMode !== "notes") return;

        // Compute visible tabs to map cursor x to a note id.
        const { visible, hiddenCount } = computeTabLayout(
          notes.index.order,
          notes.index.notes,
          activeId,
          fullWidth
        );

        // 2) Click on a tab → switch to that note.
        if (event.row >= tabsTop && event.row <= tabsBottom) {
          let cursorCol = 2; // outer paddingX=1, 1-indexed
          for (const tab of visible) {
            const width = TAB_WIDTH(tab.label);
            const left = cursorCol;
            const right = cursorCol + width - 1;
            if (event.col >= left && event.col <= right) {
              switchToNoteId(tab.id);
              return;
            }
            cursorCol = right + 1 + TAB_GUTTER;
          }
          // 3) Click on `+N more` indicator → open palette.
          if (hiddenCount > 0) {
            // The indicator has paddingX=1 around a text like "+N more · ctrl+p to jump"
            const indicatorLabel = `+${hiddenCount} more · ctrl+p to jump`;
            const indicatorLeft = cursorCol;
            const indicatorRight = indicatorLeft + indicatorLabel.length + 1; // +2 for paddingX, -1 since the gutter already counted
            if (event.col >= indicatorLeft && event.col <= indicatorRight) {
              const saved = persistCurrentEditor(notes);
              if (saved !== notes) setNotes(saved);
              setPaletteOpen(true);
              return;
            }
          }
        }
      },
      [
        paletteOpen,
        uiMode.kind,
        workbenchMode,
        toggleTop,
        toggleBottom,
        tabsTop,
        tabsBottom,
        notes,
        activeId,
        fullWidth,
        isCompact,
      ]
    )
  );

  useInput((input, key) => {
    // The command palette owns its own input handler when open. Short-circuit
    // here so editor shortcuts don't fire while the user is navigating it.
    if (paletteOpen) return;

    if (uiMode.kind === "naming") {
      // The TextInput owns Enter/Escape via its own focus, but we still need
      // a global escape route in case the input loses focus for any reason.
      if (key.escape) {
        setPendingName("");
        setUiMode({ kind: "edit" });
      }
      return;
    }

    if (uiMode.kind === "search" || uiMode.kind === "goto-line") {
      if (key.escape) {
        if (uiMode.kind === "goto-line") setPendingGoto("");
        setUiMode({ kind: "edit" });
      }
      return;
    }

    if (key.escape) {
      if (
        uiMode.kind === "confirm-clear" ||
        uiMode.kind === "confirm-delete" ||
        uiMode.kind === "confirm-pull"
      ) {
        setUiMode({ kind: "edit" });
        return;
      }
      if (uiMode.kind === "status" && uiMode.sticky) {
        setUiMode({ kind: "edit" });
        return;
      }
      if (uiMode.kind === "pulling") {
        // Don't let escape interrupt an in-flight pull — the OS-level
        // process will keep running and we'd lose the result.
        return;
      }
      const saved = persistCurrentEditor(notes);
      if (saved !== notes) setNotes(saved);
      onClose();
      return;
    }

    // Block all further input while a pull is in flight. The async resolver
    // owns the next setUiMode call.
    if (uiMode.kind === "pulling") return;

    if (key.ctrl && input === "1") {
      switchMode("portrait");
      return;
    }

    if (key.ctrl && input === "2") {
      switchMode("notes");
      return;
    }

    if (workbenchMode === "portrait") {
      const numericSection = Number.parseInt(input, 10);
      if (Number.isInteger(numericSection) && numericSection >= 1 && numericSection <= PORTRAIT_SECTIONS.length) {
        setPortraitSectionIndex(numericSection - 1);
        return;
      }

      if (key.downArrow || input === "j") {
        setPortraitSectionIndex((index) => cyclePortraitSection(index, 1));
        return;
      }
      if (key.upArrow || input === "k") {
        setPortraitSectionIndex((index) => cyclePortraitSection(index, -1));
        return;
      }
      if (key.leftArrow) {
        setPortraitSectionIndex((index) => cyclePortraitSection(index, -1));
        return;
      }
      if (key.rightArrow) {
        setPortraitSectionIndex((index) => cyclePortraitSection(index, 1));
        return;
      }
      if (key.return) {
        handlePortraitEnter();
        return;
      }
      if (input === "d") {
        setPortraitDetailsOpen((value) => !value);
        return;
      }
      if (key.pageDown) {
        const pageSize = sectionPageSize(portraitSection, portraitDetailsOpen);
        const total = sectionItemCount(portraitSection, portraitModel, creature);
        if (pageSize > 0 && total > pageSize) {
          const maxOffset = Math.max(0, total - pageSize);
          setPortraitScrollOffset((offset) => Math.min(maxOffset, offset + pageSize));
        }
        return;
      }
      if (key.pageUp) {
        const pageSize = sectionPageSize(portraitSection, portraitDetailsOpen);
        if (pageSize > 0) {
          setPortraitScrollOffset((offset) => Math.max(0, offset - pageSize));
        }
        return;
      }
      if (input === "n") {
        switchMode("notes");
        return;
      }
      if (input === "c") {
        copyPortraitSummary();
        return;
      }
      if (input === "p") {
        copyRepoPath();
        return;
      }
      if (input === "a") {
        setPortraitSection("actions");
        return;
      }
      if (input === "v") {
        setPortraitSection("overview");
        return;
      }
      if (input === "r") {
        setPortraitEvents(readEvents({ repoId: creature.id, limit: 40 }));
        setUiMode({ kind: "status", message: "portrait refreshed", variant: "success" });
        return;
      }
      if (input === "u") {
        if (uiMode.kind === "confirm-pull") {
          void executePull();
        } else {
          requestPull();
        }
        return;
      }
      // Any other key dismisses a pending pull confirmation without acting.
      if (uiMode.kind === "confirm-pull") {
        setUiMode({ kind: "edit" });
      }
      return;
    }

    // Notes-only commands should not mutate hidden note state while the user
    // is reading the PORTRAIT view. Escape above still closes the workbench.
    if (workbenchMode !== "notes") return;

    if (key.ctrl && (key.return || input === "s")) {
      const oldBody = notes.bodies[activeId] ?? "";
      const wasDirty = oldBody !== editor;
      const delta = editor.length - oldBody.length;
      const saved = persistCurrentEditor(notes);
      setNotes(saved);
      setUiMode({ kind: "status", message: "saved", variant: "success" });
      if (wasDirty) {
        const name = notes.index.notes[activeId]?.name ?? "note";
        pushToast(`saved · note "${name}"${formatCharsDelta(delta)}`, "info");
      }
      return;
    }

    // ctrl+y is handled by the focused TextArea so it can prefer the
    // selection over the full buffer when one is active. Status feedback
    // arrives via the editor's onCopy callback below.

    if (key.ctrl && input === "f") {
      openSearchPrompt();
      return;
    }

    if (key.ctrl && input === "g") {
      setPendingGoto(String(editorCursor.line + 1));
      setUiMode({ kind: "goto-line" });
      return;
    }

    if (key.ctrl && input === "a") {
      selectWholeEditor();
      return;
    }

    if (key.ctrl && input === "j") {
      if (pendingSearch.trim()) {
        runSearch(pendingSearch, 1, true);
      } else {
        openSearchPrompt();
      }
      return;
    }

    if (key.ctrl && input === "b") {
      if (pendingSearch.trim()) {
        runSearch(pendingSearch, -1, true);
      } else {
        openSearchPrompt();
      }
      return;
    }

    if (key.ctrl && input === "k") {
      if (uiMode.kind === "confirm-clear") {
        const stateWithEditor =
          (notes.bodies[activeId] ?? "") === editor
            ? notes
            : { ...notes, bodies: { ...notes.bodies, [activeId]: editor } };
        const clearedName = notes.index.notes[activeId]?.name ?? "note";
        setEditor("");
        requestEditorSelection({ line: 0, col: 0 }, { line: 0, col: 0 });
        const saved = saveNoteBody(creature.id, stateWithEditor, activeId, "", creature.scan.name);
        setNotes(saved);
        setUiMode({ kind: "status", message: "cleared", variant: "success" });
        pushToast(`cleared · note "${clearedName}"`, "info");
      } else {
        setUiMode({ kind: "confirm-clear" });
      }
      return;
    }

    if (key.ctrl && input === "d") {
      if (uiMode.kind === "confirm-delete") {
        const deletedName = notes.index.notes[activeId]?.name ?? "note";
        const next = deleteNote(creature.id, notes, activeId, creature.scan.name);
        setNotes(next);
        // deleteNote resets active; pull the new active's body in immediately
        // rather than waiting for the active-id effect, so the editor doesn't
        // briefly show the deleted content.
        setEditor(next.bodies[next.index.active] ?? "");
        lastActiveIdRef.current = next.index.active;
        setUiMode({ kind: "status", message: "deleted", variant: "success" });
        pushToast(`deleted · note "${deletedName}"`, "info");
      } else {
        setUiMode({ kind: "confirm-delete" });
      }
      return;
    }

    if (key.ctrl && input === "n") {
      setPendingName("");
      setUiMode({ kind: "naming", target: "create" });
      return;
    }

    if (key.ctrl && input === "r") {
      setPendingName(activeMeta?.name ?? "");
      setUiMode({ kind: "naming", target: { rename: activeId } });
      return;
    }

    if (key.ctrl && input === "p") {
      // Persist before showing the palette so a "switch to..." action lands
      // on a saved-from buffer rather than dropping in-flight edits. Also
      // reset a pending confirmation; opening the palette is an implicit
      // change-of-mind and the dialog under it would be confusing.
      const saved = persistCurrentEditor(notes);
      if (saved !== notes) setNotes(saved);
      if (uiMode.kind !== "edit") setUiMode({ kind: "edit" });
      setPaletteOpen(true);
      return;
    }

    // Note cycling deliberately avoids Tab now that Tab is editor-native
    // indentation. Use ctrl+left/right or the palette to switch notes.
    if (key.ctrl && key.leftArrow) {
      cycleActive(-1);
      return;
    }
    if (key.ctrl && key.rightArrow) {
      cycleActive(1);
      return;
    }

    // Any other input dismisses a pending confirmation without acting.
    if (uiMode.kind === "confirm-clear" || uiMode.kind === "confirm-delete") {
      setUiMode({ kind: "edit" });
    }
  });

  const buildPaletteItems = (): CommandPaletteItem[] => {
    const items: CommandPaletteItem[] = [];
    // Switch-to-note actions first — that's the most common use of the
    // palette ("I have 12 notes, just let me jump to one").
    for (const id of notes.index.order) {
      const meta = notes.index.notes[id];
      if (!meta) continue;
      const isActive = id === activeId;
      items.push({
        key: `switch-${id}`,
        label: isActive ? `${meta.name} (current)` : meta.name,
        hint: isActive ? undefined : "switch",
        onSelect: () => {
          if (isActive) return;
          const saved = persistCurrentEditor(notes);
          const switched = setActive(creature.id, saved, id);
          setNotes(switched);
        },
      });
    }
    items.push({
      key: "action-new",
      label: "new note",
      hint: "ctrl+n",
      onSelect: () => {
        setPendingName("");
        setUiMode({ kind: "naming", target: "create" });
      },
    });
    items.push({
      key: "action-rename",
      label: "rename current note",
      hint: "ctrl+r",
      onSelect: () => {
        setPendingName(activeMeta?.name ?? "");
        setUiMode({ kind: "naming", target: { rename: activeId } });
      },
    });
    items.push({
      key: "action-delete",
      label: "delete current note",
      hint: "ctrl+d",
      onSelect: () => setUiMode({ kind: "confirm-delete" }),
    });
    items.push({
      key: "action-copy",
      label: "copy current note",
      hint: "ctrl+y",
      onSelect: () => {
        const ok = writeToSystemClipboard(editor);
        setUiMode({
          kind: "status",
          message: ok ? "copied" : "nothing to copy",
          variant: ok ? "success" : "warning",
        });
      },
    });
    items.push({
      key: "action-select-all",
      label: "select all",
      hint: "ctrl+a",
      onSelect: selectWholeEditor,
    });
    items.push({
      key: "action-find",
      label: "find in current note",
      hint: "ctrl+f",
      onSelect: openSearchPrompt,
    });
    items.push({
      key: "action-find-next",
      label: "find next",
      hint: "ctrl+j",
      onSelect: () => {
        if (pendingSearch.trim()) runSearch(pendingSearch, 1, true);
        else openSearchPrompt();
      },
    });
    items.push({
      key: "action-find-previous",
      label: "find previous",
      hint: "ctrl+b",
      onSelect: () => {
        if (pendingSearch.trim()) runSearch(pendingSearch, -1, true);
        else openSearchPrompt();
      },
    });
    items.push({
      key: "action-goto-line",
      label: "go to line",
      hint: "ctrl+g",
      onSelect: () => {
        setPendingGoto(String(editorCursor.line + 1));
        setUiMode({ kind: "goto-line" });
      },
    });
    items.push({
      key: "action-clear",
      label: "clear current note",
      hint: "ctrl+k",
      onSelect: () => setUiMode({ kind: "confirm-clear" }),
    });
    items.push({
      key: "action-save",
      label: "save",
      hint: "ctrl+s",
      onSelect: () => {
        const saved = persistCurrentEditor(notes);
        setNotes(saved);
        setUiMode({ kind: "status", message: "saved", variant: "success" });
      },
    });
    items.push({
      key: "action-pull",
      label: "pull from remote",
      hint: "u",
      onSelect: () => {
        const saved = persistCurrentEditor(notes);
        if (saved !== notes) setNotes(saved);
        // The palette gesture (open + pick) is already deliberate, so skip
        // the second-press confirm that protects portrait's single-key `u`.
        const check = pullPreflight();
        if (!check.ok) {
          setUiMode({ kind: "status", message: check.reason, variant: "warning", sticky: true });
          return;
        }
        void executePull();
      },
    });
    items.push({
      key: "action-close",
      label: "close workbench",
      hint: "esc",
      onSelect: () => {
        const saved = persistCurrentEditor(notes);
        if (saved !== notes) setNotes(saved);
        onClose();
      },
    });
    return items;
  };

  const handleNamingSubmit = (rawName: string) => {
    if (uiMode.kind !== "naming") return;
    if (uiMode.target === "create") {
      const { state: next, id: newId } = createNote(creature.id, persistCurrentEditor(notes), rawName, creature.scan.name);
      setNotes(next);
      setEditor("");
      lastActiveIdRef.current = next.index.active;
      setPendingName("");
      setUiMode({ kind: "status", message: "new note", variant: "success" });
      const newName = next.index.notes[newId]?.name ?? "note";
      pushToast(`created · note "${newName}"`, "info");
      return;
    }
    // rename: ignore empty submission (renameNote already short-circuits, but
    // surfacing a status keeps the UX legible — silent no-ops feel broken).
    const targetId = uiMode.target.rename;
    const trimmed = rawName.trim();
    if (!trimmed) {
      setPendingName("");
      setUiMode({ kind: "status", message: "rename cancelled", variant: "warning" });
      return;
    }
    const fromName = notes.index.notes[targetId]?.name ?? "note";
    const renamed = renameNote(creature.id, persistCurrentEditor(notes), targetId, trimmed, creature.scan.name);
    setNotes(renamed);
    setPendingName("");
    setUiMode({ kind: "status", message: "renamed", variant: "success" });
    const toName = renamed.index.notes[targetId]?.name ?? trimmed;
    if (toName !== fromName) {
      pushToast(`renamed · "${fromName}" → "${toName}"`, "info");
    }
  };

  const containerHeight = responsive.contentHeight;

  // Editor sizing: reserve real rows for chrome and prompts, then give every
  // remaining row to the editor. The old fixed 24-row floor caused the footer
  // and action row to clip on shorter terminals, which made NOTES feel janky.
  const promptRows =
    uiMode.kind === "naming" || uiMode.kind === "search" || uiMode.kind === "goto-line"
      ? 2
      : 0;
  const chromeRows = (isCompact ? 13 : 20) + promptRows;
  const editorRows = Math.max(6, containerHeight - chromeRows);

  if (responsive.tier === "too-small") {
    return <ResizePrompt columns={columns} rows={rows} title="WORKBENCH" />;
  }

  return (
    <Box
      flexDirection="column"
      paddingX={1}
      paddingY={1}
      height={containerHeight}
      overflow="hidden"
    >
      {/* Header: sprite + repo identity. Badge removed — mode toggle is its own row below. */}
      <Box
        flexDirection="row"
        alignItems="flex-start"
        flexShrink={0}
      >
        <Box flexDirection="row">
          {isCompact ? null : <CreatureSprite creature={creature} />}
          <Box flexDirection="column" paddingLeft={isCompact ? 0 : 2}>
            <Text bold color={theme.colors.primary}>
              {creature.scan.name}
            </Text>
            <Text wrap="truncate-end">
              {creature.scan.branch ? `branch ${creature.scan.branch} · ` : ""}
              {creature.scan.primaryLanguage ?? "?"}
              {creature.vibe.daysSinceCommit !== undefined
                ? ` · ${creature.vibe.daysSinceCommit}d ago`
                : ""}
            </Text>
            <Text dimColor color={theme.colors.mutedForeground} wrap="truncate-end">
              {tildify(creature.scan.path)}
            </Text>
          </Box>
        </Box>
      </Box>

      {/* Mode toggle row: PORTRAIT / NOTES segmented control.
          Mirrors the GARDEN/SHELF/LIST toggle style in ReadyShell (~L1015–1032).
          The active segment uses success colour + bold; inactive uses mutedForeground.
          In NOTES mode a quiet N NOTES count badge trails to the right.
          Mouse-click hit zones are handled by the useMouse hook above; ctrl+1/ctrl+2
          provide keyboard switching without colliding with note editing shortcuts.
      */}
      {isCompact ? (
        <Box paddingTop={1} flexDirection="row" columnGap={1} flexShrink={0}>
          <Text color={workbenchMode === "portrait" ? theme.colors.success : theme.colors.mutedForeground} bold={workbenchMode === "portrait"}>
            PORTRAIT
          </Text>
          <Text dimColor color={theme.colors.mutedForeground}>|</Text>
          <Text color={workbenchMode === "notes" ? theme.colors.success : theme.colors.mutedForeground} bold={workbenchMode === "notes"}>
            NOTES
          </Text>
          <Text dimColor color={theme.colors.mutedForeground} wrap="truncate-end">
            {workbenchMode === "portrait"
              ? ` ${portraitModel.score.score}% · ${portraitModel.score.label}`
              : ` ${notes.index.order.length} ${notes.index.order.length === 1 ? "note" : "notes"}`}
          </Text>
        </Box>
      ) : (
        <Box paddingTop={1} flexDirection="row" gap={1} alignItems="center" flexShrink={0}>
          {(
            [
              { value: "portrait" as const, label: "PORTRAIT" },
              { value: "notes" as const, label: "NOTES" },
            ]
          ).map((seg) => {
            const active = workbenchMode === seg.value;
            return (
              <Badge
                key={seg.value}
                color={active ? theme.colors.success : theme.colors.mutedForeground}
                bold={active}
              >
                {seg.label}
              </Badge>
            );
          })}
          {workbenchMode === "portrait" ? (
            <Badge variant={portraitModel.score.severity}>
              {`${portraitModel.score.score}% · ${portraitModel.score.label.toUpperCase()}`}
            </Badge>
          ) : null}
          {workbenchMode === "notes" ? (
            <Badge variant="info">
              {notes.index.order.length === 1 ? "1 NOTE" : `${notes.index.order.length} NOTES`}
            </Badge>
          ) : null}
        </Box>
      )}

      {/* PORTRAIT mode — read-only snapshot of the creature's current state.
          Content flows top-to-bottom, full width, gracefully omitting absent items.
          The dirty-changes and recent-commits panels live here (not in NOTES). */}
      {workbenchMode === "portrait" ? (
        <PortraitMode
          creature={creature}
          fullWidth={fullWidth}
          model={portraitModel}
          activeSection={portraitSection}
          detailsOpen={portraitDetailsOpen}
          scrollOffset={portraitScrollOffset}
          status={(() => {
            if (uiMode.kind === "status") return { message: uiMode.message, variant: uiMode.variant };
            if (uiMode.kind === "confirm-pull") {
              return { message: "press u again to pull · esc to cancel", variant: "warning" as const };
            }
            if (uiMode.kind === "pulling") {
              return { message: "pulling…", variant: "info" as const };
            }
            return undefined;
          })()}
          compact={isCompact}
        />
      ) : null}

      {/* NOTES mode content — gated to workbenchMode === "notes" */}
      {workbenchMode === "notes" && !paletteOpen ? (
        <Box paddingTop={1} flexShrink={0}>
          <TabRow
            order={notes.index.order}
            metas={notes.index.notes}
            activeId={activeId}
            dirty={dirty}
            maxWidth={fullWidth}
          />
        </Box>
      ) : null}

      {workbenchMode === "notes" && paletteOpen ? (
        <Box paddingTop={1}>
          <CommandPalette
            title={`palette · ${creature.scan.name}`}
            placeholder="switch note or run action…"
            items={buildPaletteItems()}
            width={Math.min(70, fullWidth)}
            onClose={() => setPaletteOpen(false)}
          />
        </Box>
      ) : null}

      {workbenchMode === "notes" && !paletteOpen && uiMode.kind === "naming" ? (
        <Box paddingTop={1} flexDirection="row" gap={1} alignItems="center">
          <Text dimColor color={theme.colors.mutedForeground}>
            {uiMode.target === "create" ? "new note name:" : "rename to:"}
          </Text>
          <TextInput
            id="new-note-name"
            value={pendingName}
            onChange={setPendingName}
            onSubmit={handleNamingSubmit}
            placeholder={uiMode.target === "create" ? "e.g. design sketch" : "new name"}
            width={Math.max(12, Math.min(40, fullWidth - 18))}
            autoFocus
          />
          <Text dimColor color={theme.colors.mutedForeground}>
            enter {uiMode.target === "create" ? "create" : "rename"} · esc cancel
          </Text>
        </Box>
      ) : null}

      {workbenchMode === "notes" && !paletteOpen && uiMode.kind === "search" ? (
        <Box paddingTop={1} flexDirection="row" gap={1} alignItems="center">
          <Text dimColor color={theme.colors.mutedForeground}>
            find:
          </Text>
          <TextInput
            id="note-search"
            value={pendingSearch}
            onChange={setPendingSearch}
            onSubmit={handleSearchSubmit}
            placeholder="text in current note"
            width={Math.max(12, Math.min(44, fullWidth - 22))}
            autoFocus
          />
          <Text dimColor color={theme.colors.mutedForeground}>
            enter next · ctrl+j next · ctrl+b previous · esc cancel
          </Text>
        </Box>
      ) : null}

      {workbenchMode === "notes" && !paletteOpen && uiMode.kind === "goto-line" ? (
        <Box paddingTop={1} flexDirection="row" gap={1} alignItems="center">
          <Text dimColor color={theme.colors.mutedForeground}>
            go to line:
          </Text>
          <TextInput
            id="note-goto-line"
            value={pendingGoto}
            onChange={setPendingGoto}
            onSubmit={handleGotoSubmit}
            placeholder={`1-${editor.split("\n").length}`}
            width={Math.max(8, Math.min(16, fullWidth - 24))}
            autoFocus
          />
          <Text dimColor color={theme.colors.mutedForeground}>
            enter jump · esc cancel
          </Text>
        </Box>
      ) : null}

      {workbenchMode === "notes" && !paletteOpen ? (
        <>
          <Panel paddingY={0} width={fullWidth}>
            <TextArea
              id="editor"
              value={editor}
              onChange={setEditor}
              rows={editorRows}
              bordered={false}
              paddingX={0}
              mouseTopRow={editorTopRow}
              mouseLeftCol={editorLeftCol}
              historyKey={activeId}
              wrapWidth={editorWrapWidth}
              isActive={uiMode.kind === "edit" || uiMode.kind === "status"}
              selectionRequest={selectionRequest}
              onCursorChange={handleCursorChange}
              placeholder="start typing. auto-saves on idle. ctrl+n starts a new note. ctrl+f searches. ctrl+p opens the palette."
              onCopy={(text, ok) => {
                setUiMode({
                  kind: "status",
                  message: ok
                    ? text.includes("\n") || text.length > 40
                      ? "copied"
                      : `copied "${text}"`
                    : "nothing to copy",
                  variant: ok ? "success" : "warning",
                });
              }}
            />
          </Panel>

          <ActionRow uiMode={uiMode} dirty={dirty} cursor={editorCursor} charCount={editor.length} />
        </>
      ) : null}

      {/* Footer: always rendered regardless of mode */}
      <Box
        paddingTop={1}
        flexDirection="row"
        justifyContent="space-between"
        columnGap={2}
        alignItems="flex-end"
      >
        <Box flexGrow={1} flexShrink={1}>
          <Text dimColor color={theme.colors.mutedForeground} wrap="truncate-end">
            {workbenchMode === "portrait"
              ? isCompact
                ? "1-6 section · enter details/action · n notes · u pull · esc back"
                : "1-6 section · j/k/←/→ section · PgUp/PgDn scroll · a actions · v overview · enter act/details · d details · n notes · u pull · c copy summary · p copy path · r refresh · ctrl+2 notes · esc back"
              : isCompact
                ? "ctrl+1 portrait · ctrl+n new · ctrl+f find · ctrl+p palette · auto-save · esc back"
                : "ctrl+1 portrait · tab indent · shift+tab outdent · ctrl+←/→ switch · ctrl+n new · ctrl+r rename · ctrl+d delete · ctrl+f find · ctrl+j/b next/prev · ctrl+g line · ctrl+p palette · ctrl+a select all · ctrl+y copy · ctrl+v paste · ctrl+x cut · ctrl+z undo · auto-save · esc back"}
          </Text>
        </Box>
        <Box flexDirection="row" columnGap={2} flexShrink={0} alignItems="flex-end">
          {responsive.showUsageFooter ? (
            usage.length > 0 ? (
              <UsageBar items={usage} inline />
            ) : (
              <UsageBarPlaceholder />
            )
          ) : null}
          <Credit />
        </Box>
      </Box>
    </Box>
  );
};

interface TabRowProps {
  order: string[];
  metas: NotesState["index"]["notes"];
  activeId: string;
  /** True when the active tab's editor buffer diverges from the saved body. */
  dirty: boolean;
  maxWidth: number;
}

/** Width of a rendered tab including its border + paddingX. */
const TAB_WIDTH = (label: string): number => label.length + 4;
const TAB_GUTTER = 1;
const TAB_NAME_CAP = 16;

interface TabLayout {
  visible: { id: string; label: string }[];
  hiddenCount: number;
}

/**
 * Compute which tabs fit in the available width using the same greedy-from-
 * active fit `TabRow` renders. Exported as a pure function so the mouse hit
 * tester in `WorkbenchScreen` and the renderer in `TabRow` agree on what's
 * visible without duplicating logic.
 */
const computeTabLayout = (
  order: string[],
  metas: NotesState["index"]["notes"],
  activeId: string,
  maxWidth: number
): TabLayout => {
  const formatted = order.map((id) => {
    const name = metas[id]?.name ?? id;
    const truncated =
      name.length > TAB_NAME_CAP ? `${name.slice(0, TAB_NAME_CAP - 1)}…` : name;
    return { id, label: truncated };
  });

  const activeIdx = formatted.findIndex((tab) => tab.id === activeId);
  let remaining = maxWidth;
  const include: Set<number> = new Set();
  if (activeIdx >= 0) {
    include.add(activeIdx);
    remaining -= TAB_WIDTH(formatted[activeIdx].label);
  }
  let leftIdx = activeIdx - 1;
  let rightIdx = activeIdx + 1;
  while ((leftIdx >= 0 || rightIdx < formatted.length) && remaining > 0) {
    if (rightIdx < formatted.length) {
      const cost = TAB_WIDTH(formatted[rightIdx].label) + TAB_GUTTER;
      if (cost <= remaining) {
        include.add(rightIdx);
        remaining -= cost;
        rightIdx++;
      } else {
        rightIdx = formatted.length;
      }
    }
    if (leftIdx >= 0) {
      const cost = TAB_WIDTH(formatted[leftIdx].label) + TAB_GUTTER;
      if (cost <= remaining) {
        include.add(leftIdx);
        remaining -= cost;
        leftIdx--;
      } else {
        leftIdx = -1;
      }
    }
  }

  return {
    visible: formatted.filter((_tab, idx) => include.has(idx)),
    hiddenCount: formatted.length - include.size,
  };
};

const TabRow = ({ order, metas, activeId, dirty, maxWidth }: TabRowProps) => {
  const theme = useTheme();
  const { visible, hiddenCount } = computeTabLayout(order, metas, activeId, maxWidth);

  return (
    <Box flexDirection="row" gap={1} flexWrap="wrap">
      {visible.map((tab) => {
        const isActive = tab.id === activeId;
        const isDirty = isActive && dirty;
        return (
          <Box
            key={tab.id}
            borderStyle="round"
            borderColor={
              isDirty
                ? theme.colors.warning
                : isActive
                  ? theme.colors.focusRing
                  : theme.colors.border
            }
            paddingX={1}
            flexShrink={0}
          >
            {isDirty ? (
              <Text color={theme.colors.warning} bold>
                ● {tab.label}
              </Text>
            ) : (
              <Text
                color={isActive ? theme.colors.primary : theme.colors.foreground}
                bold={isActive}
              >
                {isActive ? `• ${tab.label}` : tab.label}
              </Text>
            )}
          </Box>
        );
      })}
      {hiddenCount > 0 ? (
        <Box paddingX={1}>
          <Text dimColor color={theme.colors.mutedForeground}>
            +{hiddenCount} more · ctrl+p to jump
          </Text>
        </Box>
      ) : null}
    </Box>
  );
};

interface ActionRowProps {
  uiMode: Mode;
  dirty: boolean;
  cursor: TextAreaCursorState;
  charCount: number;
}

const ActionRow = ({ uiMode, dirty, cursor, charCount }: ActionRowProps) => {
  const theme = useTheme();

  if (uiMode.kind === "confirm-clear") {
    return (
      <Box paddingTop={1}>
        <Badge variant="warning" bold>
          press ctrl+k again to clear this note · esc to cancel
        </Badge>
      </Box>
    );
  }
  if (uiMode.kind === "confirm-delete") {
    return (
      <Box paddingTop={1}>
        <Badge variant="error" bold>
          press ctrl+d again to delete this note · esc to cancel
        </Badge>
      </Box>
    );
  }
  if (uiMode.kind === "confirm-pull") {
    return (
      <Box paddingTop={1}>
        <Badge variant="warning" bold>
          press u again to pull · esc to cancel
        </Badge>
      </Box>
    );
  }
  if (uiMode.kind === "pulling") {
    return (
      <Box paddingTop={1}>
        <Badge variant="info" bold>
          pulling…
        </Badge>
      </Box>
    );
  }
  if (uiMode.kind === "status") {
    return (
      <Box paddingTop={1}>
        <Badge variant={uiMode.variant} bold>
          {uiMode.message}
        </Badge>
      </Box>
    );
  }

  const selected = cursor.selectedChars > 0 ? ` · ${cursor.selectedChars} selected` : "";

  return (
    <Box paddingTop={1}>
      <Text dimColor color={theme.colors.mutedForeground}>
        {dirty ? "unsaved" : "saved"} · line {cursor.line + 1}:{cursor.col + 1} · {cursor.totalLines} lines · {charCount} chars{selected}
      </Text>
    </Box>
  );
};

// ---------------------------------------------------------------------------
// PortraitMode — interactive repo briefing.
// ---------------------------------------------------------------------------

interface PortraitModeProps {
  creature: RepoCreature;
  fullWidth: number;
  model: PortraitModel;
  activeSection: PortraitSectionId;
  detailsOpen: boolean;
  /** Within-section scroll offset into the list. Section-scoped: the
   *  WorkbenchScreen resets to 0 on every section change so each section
   *  starts at the top. */
  scrollOffset?: number;
  status?: { message: string; variant: PortraitSeverity };
  compact?: boolean;
}

const severityColor = (
  severity: PortraitSeverity | "muted",
  theme: ReturnType<typeof useTheme>
): string => {
  switch (severity) {
    case "error":
      return theme.colors.error;
    case "warning":
      return theme.colors.warning;
    case "info":
      return theme.colors.info;
    case "success":
      return theme.colors.success;
    case "muted":
    default:
      return theme.colors.mutedForeground;
  }
};

const toneColor = (
  tone: PortraitSeverity | "muted" | undefined,
  theme: ReturnType<typeof useTheme>
): string => {
  switch (tone) {
    case "error":
      return theme.colors.error;
    case "warning":
      return theme.colors.warning;
    case "info":
      return theme.colors.info;
    case "success":
      return theme.colors.success;
    case "muted":
    default:
      return theme.colors.mutedForeground;
  }
};

const clampText = (value: string, max: number): string => {
  if (max <= 1) return value.slice(0, max);
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
};

const statusLabel = (status: { staged: boolean; unstaged: boolean; untracked: boolean }): string => {
  if (status.untracked) return "untracked";
  if (status.staged && status.unstaged) return "staged+dirty";
  if (status.staged) return "staged";
  if (status.unstaged) return "unstaged";
  return "changed";
};

const PortraitMode = ({
  creature,
  fullWidth,
  model,
  activeSection,
  detailsOpen,
  scrollOffset = 0,
  status,
  compact = false,
}: PortraitModeProps) => {
  const theme = useTheme();
  const scoreColor = severityColor(model.score.severity, theme);
  const panelWidth = Math.max(20, fullWidth);
  const innerWidth = Math.max(20, fullWidth - 6);
  const dirtyFiles = creature.scan.dirtyFiles ?? [];
  const totalDirtyFiles = creature.scan.dirtyFileCount ?? dirtyFiles.length ?? model.changes.length;
  const commitSparkData =
    creature.scan.recentCommitDays && creature.scan.recentCommitDays.some((n) => n > 0)
      ? creature.scan.recentCommitDays
      : undefined;

  if (compact) {
    const compactRows = (() => {
      switch (activeSection) {
        case "notes":
          return model.notes.length === 0
            ? ["no notes yet · press n to start one"]
            : model.notes.slice(0, 4).map((note) => `${note.name}: ${note.preview || "empty"}`);
        case "activity":
          return model.events.length === 0
            ? ["no journal events for this repo yet"]
            : model.events.slice(0, 4).map((event) => `${event.timeLabel} ${event.summary}`);
        case "changes":
          if (!creature.scan.isDirty) return ["working tree clean"];
          if (dirtyFiles.length > 0) {
            return dirtyFiles.slice(0, 4).map((file) => `${file.label} ${file.filename}`);
          }
          return model.changes.slice(0, 4).map((change) => `diff ${change.filename}`);
        case "commits":
          return model.commits.length === 0
            ? ["no commits visible in this scan"]
            : model.commits.slice(0, 4).map((commit) => `${commit.shortSha} ${commit.subject}`);
        case "actions":
        case "overview":
        default:
          return model.actions.slice(0, 4).map((action, index) => `${index + 1}. ${action.title}: ${action.detail}`);
      }
    })();

    return (
      <Box flexDirection="column" paddingTop={1}>
        <Box flexDirection="row" alignItems="center" columnGap={1}>
          <Text color={scoreColor} bold>
            {vibeGlyph(creature.vibe.vibe)} {model.score.label} · {model.score.score}%
          </Text>
          <Box flexGrow={1}>
            <ProgressBar
              value={model.score.score}
              total={100}
              width={Math.max(10, Math.min(24, fullWidth - 28))}
              showPercent={false}
              showCount={false}
              color={scoreColor}
            />
          </Box>
        </Box>
        {status ? (
          <Box paddingTop={1}>
            <Text color={severityColor(status.variant, theme)} bold wrap="truncate-end">
              {status.message}
            </Text>
          </Box>
        ) : null}
        <Text color={scoreColor} wrap="truncate-end">
          {model.score.reasons.length > 0 ? model.score.reasons.join(" · ") : creature.vibe.reason}
        </Text>
        <Box paddingTop={1}>
          <Panel title={sectionLabel(activeSection)} paddingY={0} width={panelWidth}>
            {compactRows.map((row, index) => (
              <Text key={`${activeSection}-${index}`} wrap="truncate-end">
                {row}
              </Text>
            ))}
          </Panel>
        </Box>
        <Box paddingTop={1}>
          <Text dimColor color={theme.colors.mutedForeground} wrap="truncate-end">
            {`section ${PORTRAIT_SECTIONS.indexOf(activeSection) + 1}/${PORTRAIT_SECTIONS.length} · ${clampText(tildify(creature.scan.path), Math.max(20, fullWidth - 8))}`}
          </Text>
        </Box>
      </Box>
    );
  }

  const renderPageIndicator = (total: number, limit: number) => {
    if (total <= limit) return null;
    const start = Math.min(scrollOffset, Math.max(0, total - limit)) + 1;
    const end = Math.min(scrollOffset + limit, total);
    return (
      <Box paddingTop={1}>
        <Text dimColor color={theme.colors.mutedForeground}>
          showing {start}–{end} of {total} · PgUp/PgDn to scroll
        </Text>
      </Box>
    );
  };

  const renderSection = () => {
    switch (activeSection) {
      case "actions": {
        const limit = detailsOpen ? 8 : 5;
        return (
          <Panel title="next actions" paddingY={0} width={panelWidth}>
            {model.actions.slice(scrollOffset, scrollOffset + limit).map((action, index) => (
              <Box key={action.id} flexDirection="column" paddingTop={index === 0 ? 0 : 1}>
                <Box flexDirection="row" columnGap={1}>
                  <Text color={severityColor(action.severity, theme)} bold>
                    {index + 1}.
                  </Text>
                  <Text color={severityColor(action.severity, theme)} bold wrap="truncate-end">
                    {action.title}
                  </Text>
                  {action.shortcut ? (
                    <Text dimColor color={theme.colors.mutedForeground}>
                      [{action.shortcut}]
                    </Text>
                  ) : null}
                </Box>
                <Text dimColor color={theme.colors.mutedForeground} wrap="wrap">
                  {action.detail}
                </Text>
              </Box>
            ))}
            {renderPageIndicator(model.actions.length, limit)}
            <Box paddingTop={1}>
              <Text dimColor color={theme.colors.mutedForeground}>
                enter follows the first action · n opens notes
              </Text>
            </Box>
          </Panel>
        );
      }

      case "notes": {
        const limit = detailsOpen ? 10 : 5;
        return (
          <Panel title="notes signal" paddingY={0} width={panelWidth}>
            {model.notes.length === 0 ? (
              <Text dimColor color={theme.colors.mutedForeground}>no notes yet · press n to start one</Text>
            ) : (
              model.notes.slice(scrollOffset, scrollOffset + limit).map((note) => (
                <Box key={note.id} flexDirection="column" paddingTop={note.active ? 0 : 1}>
                  <Box flexDirection="row" columnGap={1}>
                    <Text color={note.kind === "blocker" ? theme.colors.error : note.kind === "future-self" ? theme.colors.info : theme.colors.primary} bold={note.active || note.kind !== "regular"}>
                      {note.active ? "•" : " "} {note.name}
                    </Text>
                    <Text dimColor color={theme.colors.mutedForeground}>
                      {note.lineCount} lines · {note.charCount} chars · {note.updatedLabel}
                    </Text>
                  </Box>
                  <Text dimColor={note.empty} color={note.empty ? theme.colors.mutedForeground : theme.colors.foreground} wrap="truncate-end">
                    {note.preview}
                  </Text>
                </Box>
              ))
            )}
            {model.blocker ? (
              <Box paddingTop={1} flexDirection="column">
                <Alert variant="error" title="blocker note" bordered={false} paddingX={0} />
                <Markdown width={innerWidth}>{model.blocker}</Markdown>
              </Box>
            ) : null}
            {model.futureSelf && detailsOpen ? (
              <Box paddingTop={1} flexDirection="column">
                <Text bold color={theme.colors.info}>note to future self</Text>
                <Markdown width={innerWidth}>{model.futureSelf}</Markdown>
              </Box>
            ) : null}
            {renderPageIndicator(model.notes.length, limit)}
          </Panel>
        );
      }

      case "activity": {
        const limit = detailsOpen ? 8 : 5;
        return (
          <Panel title="activity" paddingY={0} width={panelWidth}>
            <Box flexDirection="column">
              <Text dimColor color={theme.colors.mutedForeground}>journal events · last 14 days</Text>
              <Sparkline data={model.activityBuckets} width={Math.max(18, innerWidth)} color={theme.colors.primary} />
            </Box>
            {commitSparkData ? (
              <Box flexDirection="column" paddingTop={1}>
                <Text dimColor color={theme.colors.mutedForeground}>commits · last 30 days</Text>
                <Sparkline data={commitSparkData} width={Math.max(18, innerWidth)} color={theme.colors.success} />
              </Box>
            ) : null}
            <Box paddingTop={1} flexDirection="column">
              {model.events.length === 0 ? (
                <Text dimColor color={theme.colors.mutedForeground}>no journal events for this repo yet</Text>
              ) : (
                model.events.slice(scrollOffset, scrollOffset + limit).map((event) => (
                  <Box key={event.id} flexDirection="row" columnGap={1}>
                    <Box width={12}>
                      <Text dimColor color={theme.colors.mutedForeground}>{event.timeLabel}</Text>
                    </Box>
                    <Text wrap="truncate-end">{event.summary}</Text>
                  </Box>
                ))
              )}
            </Box>
            {renderPageIndicator(model.events.length, limit)}
          </Panel>
        );
      }

      case "changes": {
        const limit = detailsOpen ? 16 : 8;
        return (
          <Panel
            title={totalDirtyFiles > 0 ? `changes · ${totalDirtyFiles} files` : "changes"}
            paddingY={0}
            width={panelWidth}
          >
            {!creature.scan.isDirty ? (
              <Text color={theme.colors.success}>working tree clean</Text>
            ) : null}
            {dirtyFiles.length > 0 ? (
              <Box flexDirection="column">
                {dirtyFiles.slice(scrollOffset, scrollOffset + limit).map((file) => (
                  <Box key={`${file.code}:${file.filename}`} flexDirection="row" columnGap={1}>
                    <Box width={12}>
                      <Text color={file.untracked ? theme.colors.info : file.staged ? theme.colors.success : theme.colors.warning}>
                        {file.label}
                      </Text>
                    </Box>
                    <Text wrap="truncate-end">{file.filename}</Text>
                    {file.renamedFrom ? (
                      <Text dimColor color={theme.colors.mutedForeground} wrap="truncate-end">
                        ← {file.renamedFrom}
                      </Text>
                    ) : null}
                    <Text dimColor color={theme.colors.mutedForeground}>
                      {statusLabel(file)}
                    </Text>
                  </Box>
                ))}
                {totalDirtyFiles > dirtyFiles.length ? (
                  <Text dimColor color={theme.colors.mutedForeground}>
                    +{totalDirtyFiles - dirtyFiles.length} more files not shown
                  </Text>
                ) : null}
              </Box>
            ) : null}
            {model.changes.length > 0 ? (
              <Box flexDirection="column" paddingTop={1}>
                {detailsOpen ? (
                  (creature.scan.dirtyChanges ?? []).slice(0, 3).map((change, index) => (
                    <Box key={change.filename} flexDirection="column" paddingTop={index === 0 ? 0 : 1}>
                      {change.skipped ? (
                        <Box flexDirection="column">
                          <Text color={theme.colors.warning}>
                            {change.filename}
                          </Text>
                          <Text dimColor color={theme.colors.mutedForeground}>
                            {change.skipped === "too-large"
                              ? "preview disabled · file exceeds 256 KB"
                              : change.skipped === "binary"
                              ? "preview disabled · binary file"
                              : "preview disabled · sensitive filename"}
                          </Text>
                        </Box>
                      ) : (
                        <>
                          <DiffView
                            filename={change.filename}
                            oldText={change.oldText}
                            newText={change.newText}
                            mode="unified"
                            context={2}
                            showLineNumbers
                          />
                          {change.truncated ? (
                            <Text dimColor color={theme.colors.mutedForeground}>
                              truncated to first 100 lines
                            </Text>
                          ) : null}
                        </>
                      )}
                    </Box>
                  ))
                ) : (
                  model.changes.slice(0, 4).map((change) => (
                    <Box key={change.filename} flexDirection="row" columnGap={1}>
                      <Text color={theme.colors.warning}>diff</Text>
                      <Text wrap="truncate-end">{change.filename}</Text>
                      <Text dimColor color={theme.colors.mutedForeground}>
                        {change.oldLineCount}→{change.newLineCount} lines{change.truncated ? " · truncated" : ""}
                      </Text>
                    </Box>
                  ))
                )}
              </Box>
            ) : creature.scan.isDirty ? (
              <Box paddingTop={1}>
                <Text dimColor color={theme.colors.mutedForeground}>
                  no text diff preview available; untracked/binary files may still be listed above
                </Text>
              </Box>
            ) : null}
            {renderPageIndicator(dirtyFiles.length, limit)}
          </Panel>
        );
      }

      case "commits": {
        const limit = detailsOpen ? 10 : 6;
        return (
          <Panel title="commits" paddingY={0} width={panelWidth}>
            {creature.scan.lastCommitSubject ? (
              <Box flexDirection="column">
                <Text dimColor color={theme.colors.mutedForeground}>latest</Text>
                <Text wrap="truncate-end">{creature.scan.lastCommitSubject}</Text>
              </Box>
            ) : null}
            <Box paddingTop={creature.scan.lastCommitSubject ? 1 : 0} flexDirection="column">
              {model.commits.length === 0 ? (
                <Text dimColor color={theme.colors.mutedForeground}>no commits visible in this scan</Text>
              ) : (
                model.commits.slice(scrollOffset, scrollOffset + limit).map((commit) => (
                  <Box key={commit.sha} flexDirection="row" columnGap={1}>
                    <Box width={9}>
                      <Text color={theme.colors.accent}>{commit.shortSha}</Text>
                    </Box>
                    <Box width={12}>
                      <Text dimColor color={theme.colors.mutedForeground}>{commit.timeLabel}</Text>
                    </Box>
                    <Box flexGrow={1}>
                      <Text wrap="truncate-end">{commit.subject}</Text>
                    </Box>
                    {detailsOpen ? (
                      <Text dimColor color={theme.colors.mutedForeground}>{commit.author}</Text>
                    ) : null}
                  </Box>
                ))
              )}
            </Box>
            {renderPageIndicator(model.commits.length, limit)}
          </Panel>
        );
      }

      case "overview":
      default:
        return (
          <Box flexDirection="column">
            <Panel title="snapshot" paddingY={0} width={panelWidth}>
              <Box flexDirection={fullWidth >= 82 ? "row" : "column"} columnGap={4}>
                {model.stats.map((stat) => (
                  <Box key={stat.key} flexDirection="column" width={fullWidth >= 82 ? Math.floor((panelWidth - 10) / 4) : undefined}>
                    <Text dimColor color={theme.colors.mutedForeground}>{stat.label}</Text>
                    <Text color={toneColor(stat.severity, theme)} bold={stat.severity !== "muted"}>
                      {stat.value}
                    </Text>
                    {stat.detail ? (
                      <Text dimColor color={theme.colors.mutedForeground} wrap="truncate-end">{stat.detail}</Text>
                    ) : null}
                  </Box>
                ))}
              </Box>
            </Panel>

            <Box paddingTop={1}>
              <Panel title="top actions" paddingY={0} width={panelWidth}>
                {model.actions.slice(0, 3).map((action, index) => (
                  <Box key={action.id} flexDirection="row" columnGap={1}>
                    <Text color={severityColor(action.severity, theme)} bold>{index + 1}.</Text>
                    <Text color={severityColor(action.severity, theme)} bold wrap="truncate-end">{action.title}</Text>
                    <Text dimColor color={theme.colors.mutedForeground} wrap="truncate-end">— {action.detail}</Text>
                  </Box>
                ))}
              </Panel>
            </Box>
          </Box>
        );
    }
  };

  return (
    <Box flexDirection="column" paddingTop={1}>
      <Box flexDirection="row" alignItems="center" columnGap={1}>
        <Text color={scoreColor} bold>
          {vibeGlyph(creature.vibe.vibe)} {model.score.label} · {model.score.score}%
        </Text>
        <Box flexGrow={1}>
          <ProgressBar
            value={model.score.score}
            total={100}
            width={Math.max(12, Math.min(32, fullWidth - 28))}
            showPercent={false}
            showCount={false}
            color={scoreColor}
          />
        </Box>
      </Box>

      <Box paddingTop={1} flexDirection="row" gap={1} flexWrap="wrap">
        {model.chips.map((chip) => (
          <Badge
            key={chip.key}
            color={severityColor(chip.severity, theme)}
            bold={chip.severity !== "muted"}
            paddingX={1}
          >
            {chip.label}
          </Badge>
        ))}
      </Box>

      <Box paddingTop={1} flexDirection="row" gap={1} flexWrap="wrap">
        {PORTRAIT_SECTIONS.map((section, index) => {
          const active = section === activeSection;
          return (
            <Badge
              key={section}
              color={active ? theme.colors.primary : theme.colors.mutedForeground}
              bold={active}
              paddingX={1}
            >
              {`${index + 1} ${sectionLabel(section)}`}
            </Badge>
          );
        })}
      </Box>

      {status ? (
        <Box paddingTop={1}>
          <Badge variant={status.variant} bold>{status.message}</Badge>
        </Box>
      ) : null}

      <Box paddingTop={1}>
        <Alert
          variant={model.score.severity}
          title={model.score.reasons.length > 0 ? model.score.reasons.join(" · ") : creature.vibe.reason}
          bordered={false}
          paddingX={0}
        >
          {model.actions[0]?.detail ?? "clean working tree, no obvious blocker, no action required"}
        </Alert>
      </Box>

      <Box paddingTop={1}>{renderSection()}</Box>

      <Box paddingTop={1}>
        <Text dimColor color={theme.colors.mutedForeground} wrap="truncate-end">
          {`section ${PORTRAIT_SECTIONS.indexOf(activeSection) + 1}/${PORTRAIT_SECTIONS.length} · ${detailsOpen ? "details on" : "details off"} · ${clampText(tildify(creature.scan.path), Math.max(20, fullWidth - 8))}`}
        </Text>
      </Box>
    </Box>
  );
};
