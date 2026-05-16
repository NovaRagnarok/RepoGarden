import { Box, Text } from "ink";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useTheme } from "@/components/ui/theme-provider";
import { useFocus } from "@/hooks/use-focus";
import { useInput } from "@/hooks/use-input";
import { useMouse } from "@/hooks/use-mouse";
import { readFromSystemClipboard, writeToSystemClipboard } from "@/lib/clipboard";
import {
  allTextSelection,
  applyBackspace,
  applyForwardDelete,
  clampPosition,
  getEditorLines,
  graphemeLength,
  indentLines,
  indentationForNextLine,
  joinEditorLines,
  normalizeEditorInput,
  outdentLines,
  positionsEqual,
  sliceGraphemes,
  splitGraphemes,
  stripEditorControlChars,
} from "@/lib/editor-buffer";
import {
  containsPosition,
  getSelectedCharCount,
  getSelectedText,
  isEmptyRange,
  orderRange,
  replaceRange,
  type Position,
  type SelectionRange,
} from "@/lib/text-selection";
import {
  computeVisualLines,
  cursorToVisual,
  visualToCursor,
} from "@/lib/text-wrap";

export interface TextAreaProps {
  value?: string;
  onChange?: (value: string) => void;
  onSubmit?: (value: string) => void;
  placeholder?: string;
  rows?: number;
  label?: string;
  id?: string;
  /**
   * Render the textarea inside its own bordered Box. Default true. Set
   * false when the parent already provides a frame (Panel, Dialog, etc.)
   * to avoid a double-border that eats two visible rows.
   */
  bordered?: boolean;
  borderStyle?:
    | "single"
    | "double"
    | "round"
    | "bold"
    | "singleDouble"
    | "doubleSingle"
    | "classic";
  paddingX?: number;
  cursor?: string;
  /**
   * Top-left screen position (1-indexed) of the first character cell of the
   * editor content. When provided, left-press clicks within the editor's
   * viewport are translated into cursor positions. The parent must compute
   * these from its own layout — Ink doesn't expose absolute positions.
   */
  mouseTopRow?: number;
  mouseLeftCol?: number;
  /**
   * Reset the undo/redo history when this value changes. Pass a stable key
   * identifying the buffer's logical identity (e.g., a note id). When the
   * editor switches buffers, history resets so the new buffer's first edits
   * can't accidentally undo into the previous buffer's content.
   */
  historyKey?: string;
  /**
   * When > 0, soft-wrap each logical line at this column width. Visual rows
   * become independent of logical lines: arrow up/down navigate visual rows,
   * Home/End move to visual line bounds, click-to-position uses visual rows.
   * When undefined or 0, lines render unwrapped (one visual row per logical
   * line, characters past the right edge get clipped by the parent).
   */
  wrapWidth?: number;
  /**
   * Render a visual thumb-on-track scrollbar on the right edge. Defaults to
   * true when wrapping is enabled (where the content height is a known
   * value) and false otherwise. Hidden when the content fits in one
   * viewport. Pattern lifted from termcn's ScrollView component.
   */
  showScrollbar?: boolean;
  /**
   * Fires after copy or cut. `text` is what was placed on the system
   * clipboard; `ok` reports whether `writeToSystemClipboard` succeeded
   * (false when there was nothing to copy or the platform write failed).
   * The parent typically uses this to show a status toast.
   */
  onCopy?: (text: string, ok: boolean) => void;
  /**
   * Allows a parent modal/confirmation prompt to keep the editor rendered
   * without letting it consume keystrokes or show an active caret.
   */
  isActive?: boolean;
  /** Parent-driven cursor / selection jump. Applied whenever `key` changes. */
  selectionRequest?: TextAreaSelectionRequest;
  /** Emits cursor + selection state for parent status bars and find-next. */
  onCursorChange?: (state: TextAreaCursorState) => void;
}

export interface TextAreaSelectionRequest {
  key: string | number;
  anchor: Position;
  cursor: Position;
}

export interface TextAreaCursorState {
  line: number;
  col: number;
  visualRow: number;
  visualCol: number;
  totalLines: number;
  totalVisualRows: number;
  selection: SelectionRange | null;
  selectedChars: number;
}

const getLines = getEditorLines;
const joinLines = joinEditorLines;
const DEFAULT_INDENT = "  ";

/**
 * Walk left within `line` to the start of the previous word: first skip any
 * trailing whitespace, then skip the run of non-whitespace before it. The
 * pattern matches what Ctrl+W and Alt+Backspace already do for deletion and
 * is the standard "previous word boundary" most editors use.
 *
 * Iterates over grapheme clusters (`Position.col` is grapheme-indexed) so
 * an emoji inside a "word" counts as one cell — never lands the boundary
 * mid-surrogate.
 */
const findPrevWordCol = (line: string, fromCol: number): number => {
  const graphemes = splitGraphemes(line);
  let c = Math.max(0, Math.min(graphemes.length, fromCol));
  while (c > 0 && /\s/.test(graphemes[c - 1] ?? "")) c--;
  while (c > 0 && !/\s/.test(graphemes[c - 1] ?? "")) c--;
  return c;
};

/** Mirror of `findPrevWordCol`, walking right to the end of the next word. */
const findNextWordCol = (line: string, fromCol: number): number => {
  const graphemes = splitGraphemes(line);
  let c = Math.max(0, Math.min(graphemes.length, fromCol));
  while (c < graphemes.length && /\s/.test(graphemes[c] ?? "")) c++;
  while (c < graphemes.length && !/\s/.test(graphemes[c] ?? "")) c++;
  return c;
};

const clampSplit = (value: number, max: number): number =>
  Math.max(0, Math.min(max, Number.isFinite(value) ? Math.trunc(value) : 0));

export const TextArea = ({
  value: controlledValue,
  onChange,
  onSubmit,
  placeholder = "",
  rows = 4,
  label,
  id,
  bordered = true,
  borderStyle = "round",
  paddingX = 1,
  cursor = "█",
  mouseTopRow,
  mouseLeftCol,
  historyKey,
  wrapWidth = 0,
  showScrollbar,
  onCopy,
  isActive = true,
  selectionRequest,
  onCursorChange,
}: TextAreaProps) => {
  const [internalValue, setInternalValue] = useState("");
  const [cursorLine, setCursorLine] = useState(0);
  const [cursorCol, setCursorCol] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);
  // Mirror of `scrollOffset` updated synchronously so listeners that fire
  // multiple times within a single stdin chunk see the latest scroll value.
  const scrollOffsetRef = useRef(0);
  // Preserves the intended visual column when moving vertically across short
  // wrapped rows (standard editor behaviour). Horizontal edits reset it.
  const preferredVisualColRef = useRef<number | null>(null);
  // Selection anchor in LOGICAL coordinates. Null means no selection.
  const [anchor, setAnchor] = useState<Position | null>(null);
  // Press position for mouse-drag selection.
  const pressPositionRef = useRef<Position | null>(null);
  const dragAnchorSetRef = useRef(false);
  const theme = useTheme();
  const { isFocused } = useFocus({ id, isActive });

  const value = normalizeEditorInput(controlledValue ?? internalValue);
  const logicalLines = useMemo(() => getLines(value), [value]);
  const safeRows = Math.max(1, Math.floor(rows));

  const setValue = (newVal: string) => {
    const normalized = normalizeEditorInput(newVal);
    if (onChange) {
      onChange(normalized);
    } else {
      setInternalValue(normalized);
    }
  };

  // Visual lines: with wrap enabled, each logical line may span multiple
  // visual rows. Memo'd on (value, wrapWidth) so we don't recompute on every
  // unrelated state change (cursor moves, scroll, focus toggles).
  const visualLines = useMemo(
    () => computeVisualLines(logicalLines, wrapWidth),
    [logicalLines, wrapWidth]
  );

  const maxScroll = Math.max(0, visualLines.length - safeRows);
  const effectiveScrollOffset = Math.max(0, Math.min(scrollOffset, maxScroll));

  // Undo / redo. History snapshots are tuples of value + cursor position so
  // ctrl+z restores the user's caret along with their text. Rapid typing
  // collapses into a single step via a 500ms grouping window; structural
  // edits force a fresh group so they each undo as their own discrete action.
  interface HistoryStep {
    value: string;
    cursorLine: number;
    cursorCol: number;
  }
  const historyPastRef = useRef<HistoryStep[]>([]);
  const historyFutureRef = useRef<HistoryStep[]>([]);
  const lastEditAtRef = useRef(0);
  const HISTORY_GROUP_MS = 500;
  const HISTORY_MAX = 200;

  const resetSelectionRefs = (): void => {
    pressPositionRef.current = null;
    dragAnchorSetRef.current = false;
  };

  // Reset history + cursor + scroll when the parent switches buffers.
  useEffect(() => {
    historyPastRef.current = [];
    historyFutureRef.current = [];
    lastEditAtRef.current = 0;
    preferredVisualColRef.current = null;
    setCursorLine(0);
    setCursorCol(0);
    setScrollOffset(0);
    scrollOffsetRef.current = 0;
    setAnchor(null);
    resetSelectionRefs();
  }, [historyKey]);

  const captureStep = (): HistoryStep => {
    const safeCursor = clampPosition(logicalLines, { line: cursorLine, col: cursorCol });
    return { value, cursorLine: safeCursor.line, cursorCol: safeCursor.col };
  };

  const beforeMutation = (forceBreak: boolean = false): void => {
    const now = Date.now();
    const shouldPush = forceBreak || now - lastEditAtRef.current >= HISTORY_GROUP_MS;
    if (shouldPush) {
      historyPastRef.current.push(captureStep());
      if (historyPastRef.current.length > HISTORY_MAX) {
        historyPastRef.current.shift();
      }
      historyFutureRef.current = [];
    }
    // After a forceBreak, set lastEditAt to 0 so the *next* mutation also
    // starts a fresh group — this is how Enter+typing ends up as two
    // separate undo steps rather than one.
    lastEditAtRef.current = forceBreak ? 0 : now;
  };

  /**
   * Snap `scrollOffset` so the given (line, col) cursor position lands inside
   * the viewport. The caller passes post-mutation visualLines when `value` is
   * about to change.
   */
  const snapScrollToShow = (
    targetVisualLines: typeof visualLines,
    targetLine: number,
    targetCol: number
  ): void => {
    const { row } = cursorToVisual(targetVisualLines, targetLine, targetCol);
    const targetMaxScroll = Math.max(0, targetVisualLines.length - safeRows);
    setScrollOffset((curr) => {
      let next = Math.max(0, Math.min(curr, targetMaxScroll));
      if (row < next) next = row;
      else if (row >= next + safeRows) next = Math.max(0, row - safeRows + 1);
      next = Math.max(0, Math.min(next, targetMaxScroll));
      scrollOffsetRef.current = next;
      return next;
    });
  };

  /** Compute visual lines for a candidate value (post-mutation). */
  const visualLinesFor = (nextValue: string): typeof visualLines =>
    computeVisualLines(getLines(nextValue), wrapWidth);

  const applyHistoryStep = (step: HistoryStep): void => {
    const nextLines = getLines(step.value);
    const safeCursor = clampPosition(nextLines, {
      line: step.cursorLine,
      col: step.cursorCol,
    });
    setValue(step.value);
    setCursorLine(safeCursor.line);
    setCursorCol(safeCursor.col);
    setAnchor(null);
    preferredVisualColRef.current = null;
    resetSelectionRefs();
    snapScrollToShow(
      computeVisualLines(nextLines, wrapWidth),
      safeCursor.line,
      safeCursor.col
    );
    // Force the next mutation to start a new group rather than collapsing
    // with whatever was happening pre-undo.
    lastEditAtRef.current = 0;
  };

  useEffect(() => {
    const nextCursor = clampPosition(logicalLines, { line: cursorLine, col: cursorCol });
    if (!positionsEqual(nextCursor, { line: cursorLine, col: cursorCol })) {
      setCursorLine(nextCursor.line);
      setCursorCol(nextCursor.col);
      preferredVisualColRef.current = null;
    }

    setAnchor((prev) => {
      if (!prev) return prev;
      const nextAnchor = clampPosition(logicalLines, prev);
      return positionsEqual(prev, nextAnchor) ? prev : nextAnchor;
    });

    if (scrollOffset !== effectiveScrollOffset) {
      setScrollOffset(effectiveScrollOffset);
    }
    scrollOffsetRef.current = effectiveScrollOffset;
  }, [logicalLines, cursorLine, cursorCol, scrollOffset, effectiveScrollOffset]);

  useEffect(() => {
    if (!selectionRequest) return;
    const nextAnchor = clampPosition(logicalLines, selectionRequest.anchor);
    const nextCursor = clampPosition(logicalLines, selectionRequest.cursor);
    setCursorLine(nextCursor.line);
    setCursorCol(nextCursor.col);
    setAnchor(positionsEqual(nextAnchor, nextCursor) ? null : nextAnchor);
    preferredVisualColRef.current = null;
    resetSelectionRefs();
    snapScrollToShow(visualLines, nextCursor.line, nextCursor.col);
  }, [selectionRequest?.key]);

  /**
   * Current selection range (normalized start-before-end), or null if no
   * meaningful selection exists. An anchor at the same position as the cursor
   * counts as no selection (collapsed range).
   */
  const currentSelection = useCallback((): SelectionRange | null => {
    if (!anchor) return null;
    const safeAnchor = clampPosition(logicalLines, anchor);
    const safeCursor = clampPosition(logicalLines, { line: cursorLine, col: cursorCol });
    const range = orderRange(safeAnchor, safeCursor);
    return isEmptyRange(range) ? null : range;
  }, [anchor, logicalLines, cursorLine, cursorCol]);

  useEffect(() => {
    if (!onCursorChange) return;
    const safeCursor = clampPosition(logicalLines, { line: cursorLine, col: cursorCol });
    const visual = cursorToVisual(visualLines, safeCursor.line, safeCursor.col);
    const selection = currentSelection();
    onCursorChange({
      line: safeCursor.line,
      col: safeCursor.col,
      visualRow: visual.row,
      visualCol: visual.col,
      totalLines: logicalLines.length,
      totalVisualRows: visualLines.length,
      selection,
      selectedChars: selection ? getSelectedCharCount(logicalLines, selection) : 0,
    });
  }, [onCursorChange, visualLines, logicalLines, cursorLine, cursorCol, currentSelection]);

  const setCursor = (pos: Position): void => {
    const safe = clampPosition(logicalLines, pos);
    setCursorLine(safe.line);
    setCursorCol(safe.col);
  };

  const applyTextEdit = (
    result: { value: string; cursorLine: number; cursorCol: number },
    nextAnchor: Position | null = null
  ): void => {
    setValue(result.value);
    setCursorLine(result.cursorLine);
    setCursorCol(result.cursorCol);
    setAnchor(nextAnchor);
    preferredVisualColRef.current = null;
    resetSelectionRefs();
    snapScrollToShow(visualLinesFor(result.value), result.cursorLine, result.cursorCol);
  };

  /**
   * Replace the current selection with `replacement`. Sets new value, cursor,
   * and clears the anchor. Captures an undo step. Returns the post-replacement
   * state for callers that need to snap scroll.
   */
  const replaceCurrentSelection = (
    replacement: string
  ): { value: string; cursorLine: number; cursorCol: number } | null => {
    const range = currentSelection();
    if (!range) return null;
    beforeMutation(true);
    const result = replaceRange(
      logicalLines,
      range,
      stripEditorControlChars(normalizeEditorInput(replacement))
    );
    setValue(result.value);
    setCursorLine(result.cursorLine);
    setCursorCol(result.cursorCol);
    setAnchor(null);
    preferredVisualColRef.current = null;
    resetSelectionRefs();
    return result;
  };

  /**
   * Copy the current selection to the system clipboard, or fall back to the
   * entire buffer if no selection is active. Fires `onCopy` with the copied
   * text and whether the clipboard write succeeded.
   */
  const copyCurrent = (): void => {
    const range = currentSelection();
    const text = range ? getSelectedText(logicalLines, range) : value;
    const ok = text.length > 0 && writeToSystemClipboard(text);
    // Copy is intentionally non-destructive: keep the highlight so repeated
    // copy/cut or overtyping still targets the same range.
    onCopy?.(text, ok);
  };

  /**
   * Insert `text` into the buffer at `at` as a zero-length replacement.
   * Captures one undo step so the whole paste reverts on a single ctrl+z.
   * Does NOT replace an active selection — right-clicking outside the
   * selection should preserve the selected text rather than silently deleting
   * it.
   */
  const pasteAt = (at: Position, text: string): void => {
    const normalized = stripEditorControlChars(normalizeEditorInput(text));
    if (!normalized) return;
    beforeMutation(true);
    const safeAt = clampPosition(logicalLines, at);
    const result = replaceRange(logicalLines, { start: safeAt, end: safeAt }, normalized);
    applyTextEdit(result);
  };

  const undo = (): boolean => {
    const prev = historyPastRef.current.pop();
    if (!prev) return false;
    historyFutureRef.current.push(captureStep());
    if (historyFutureRef.current.length > HISTORY_MAX) {
      historyFutureRef.current.shift();
    }
    applyHistoryStep(prev);
    return true;
  };

  const redo = (): boolean => {
    const next = historyFutureRef.current.pop();
    if (!next) return false;
    historyPastRef.current.push(captureStep());
    if (historyPastRef.current.length > HISTORY_MAX) {
      historyPastRef.current.shift();
    }
    applyHistoryStep(next);
    return true;
  };

  const replaceSelectionAndSnap = (replacement: string): void => {
    const result = replaceCurrentSelection(replacement);
    if (result) {
      snapScrollToShow(visualLinesFor(result.value), result.cursorLine, result.cursorCol);
    }
  };

  useInput(
    (input, key) => {
      if (!isActive || !isFocused) {
        return;
      }

      // `safeCursor` is the clamped logical cursor. If our React state hasn't
      // caught up to a buffer shrink yet (e.g. parent just replaced `editor`
      // via setEditor, or a selection-delete reduced line count and we're
      // mid-batched-update), `cursorLine` / `cursorCol` can still point past
      // the new EOL. The previous implementation `return`ed here, which ate
      // the keystroke entirely — that's the #16 "Backspace stops responding"
      // freeze: the user presses Backspace, we re-sync the cursor, and never
      // process the deletion. Sync state for the next render and FALL THROUGH
      // so this keystroke still applies — every handler below already uses
      // `safeCursor` rather than the raw state.
      const safeCursor = clampPosition(logicalLines, { line: cursorLine, col: cursorCol });
      if (!positionsEqual(safeCursor, { line: cursorLine, col: cursorCol })) {
        setCursor(safeCursor);
        snapScrollToShow(visualLines, safeCursor.line, safeCursor.col);
      }

      const lines = logicalLines;

      const resetPreferredColumn = (): void => {
        preferredVisualColRef.current = null;
      };

      if (key.return && key.ctrl) {
        onSubmit?.(value);
        return;
      }

      // Undo / redo. Ctrl+Z always undoes; Ctrl+Shift+Z (if the terminal
      // passes the shift bit through) redoes.
      if (key.ctrl && input === "z") {
        if (key.shift) {
          redo();
        } else {
          undo();
        }
        return;
      }

      // Copy: Ctrl+Y. With a selection, copies just the selected text;
      // otherwise copies the entire buffer. Selection stays after copy.
      if (key.ctrl && input === "y") {
        copyCurrent();
        return;
      }

      // Paste: Ctrl+V. Reads the system clipboard and inserts at the cursor,
      // replacing any active selection (standard overtype-on-paste).
      if (key.ctrl && input === "v") {
        const clip = readFromSystemClipboard();
        if (clip === null || clip.length === 0) return;
        const range = currentSelection();
        if (range) {
          replaceSelectionAndSnap(clip);
          return;
        }
        pasteAt(safeCursor, clip);
        return;
      }

      // Cut: Ctrl+X. Copy + replace selection with empty. No-op without a range.
      if (key.ctrl && input === "x") {
        const range = currentSelection();
        if (!range) return;
        const text = getSelectedText(lines, range);
        const ok = text.length > 0 && writeToSystemClipboard(text);
        onCopy?.(text, ok);
        replaceSelectionAndSnap("");
        return;
      }

      // Before any cursor-only movement: with shift held, ensure an anchor
      // exists so the move extends a selection; without shift, clear any
      // existing anchor so the move is just a cursor jump.
      const prepareMove = (): void => {
        if (key.shift) {
          if (!anchor) setAnchor(safeCursor);
        } else if (anchor) {
          setAnchor(null);
        }
      };

      const moveCursor = (next: Position, preservePreferredColumn = false): void => {
        const safeNext = clampPosition(lines, next);
        if (!preservePreferredColumn) resetPreferredColumn();
        prepareMove();
        setCursorLine(safeNext.line);
        setCursorCol(safeNext.col);
        snapScrollToShow(visualLines, safeNext.line, safeNext.col);
      };

      // Ctrl+Home — jump cursor to the very start of the buffer. Placed
      // before the line-scoped Home handler so the ctrl modifier wins.
      if (key.ctrl && key.home) {
        moveCursor({ line: 0, col: 0 });
        return;
      }

      // Ctrl+End — jump cursor to the very end of the buffer.
      if (key.ctrl && key.end) {
        const lastLine = Math.max(0, lines.length - 1);
        moveCursor({ line: lastLine, col: graphemeLength(lines[lastLine] ?? "") });
        return;
      }

      // Ctrl+A — select all. Home keeps line-start muscle memory intact.
      if (key.ctrl && input === "a") {
        const range = allTextSelection(value);
        if (!range) return;
        const safeEnd = clampPosition(lines, range.end);
        setAnchor(range.start);
        setCursorLine(safeEnd.line);
        setCursorCol(safeEnd.col);
        resetPreferredColumn();
        resetSelectionRefs();
        snapScrollToShow(visualLines, safeEnd.line, safeEnd.col);
        return;
      }

      // Home — cursor to start of the current VISUAL line. With wrap, this
      // lands at the start of the displayed row rather than the start of the
      // long logical line, which matches what most editors do.
      if (key.home) {
        const { row } = cursorToVisual(visualLines, safeCursor.line, safeCursor.col);
        const vl = visualLines[row];
        if (vl) {
          moveCursor({ line: vl.logicalLine, col: vl.start });
        }
        return;
      }

      // Ctrl+E or End — cursor to end of the current visual line.
      if ((key.ctrl && input === "e") || key.end) {
        const { row } = cursorToVisual(visualLines, safeCursor.line, safeCursor.col);
        const vl = visualLines[row];
        if (vl) {
          moveCursor({ line: vl.logicalLine, col: vl.start + graphemeLength(vl.text) });
        }
        return;
      }

      // Ctrl+U — delete from cursor back to start of line; with a selection,
      // delete the selection instead.
      if (key.ctrl && input === "u") {
        const range = currentSelection();
        if (range) {
          replaceSelectionAndSnap("");
          return;
        }
        const currentLine = lines[safeCursor.line] ?? "";
        if (safeCursor.col === 0) return;
        beforeMutation(true);
        const newLine = sliceGraphemes(currentLine, safeCursor.col);
        const newLines = [
          ...lines.slice(0, safeCursor.line),
          newLine,
          ...lines.slice(safeCursor.line + 1),
        ];
        const nextValue = joinLines(newLines);
        applyTextEdit({ value: nextValue, cursorLine: safeCursor.line, cursorCol: 0 });
        return;
      }

      // Ctrl+W, Alt+Backspace, or Ctrl+Backspace — delete word backward.
      if (
        (key.ctrl && input === "w") ||
        (key.meta && key.backspace) ||
        (key.ctrl && key.backspace)
      ) {
        const range = currentSelection();
        if (range) {
          replaceSelectionAndSnap("");
          return;
        }
        const currentLine = lines[safeCursor.line] ?? "";
        if (safeCursor.col === 0) {
          if (safeCursor.line === 0) return;
          const prevLine = lines[safeCursor.line - 1] ?? "";
          const cut = findPrevWordCol(prevLine, graphemeLength(prevLine));
          beforeMutation(true);
          const mergedLine = sliceGraphemes(prevLine, 0, cut) + currentLine;
          const newLines = [
            ...lines.slice(0, safeCursor.line - 1),
            mergedLine,
            ...lines.slice(safeCursor.line + 1),
          ];
          const nextValue = joinLines(newLines);
          applyTextEdit({ value: nextValue, cursorLine: safeCursor.line - 1, cursorCol: cut });
          return;
        }
        const cut = findPrevWordCol(currentLine, safeCursor.col);
        beforeMutation(true);
        const newLine = sliceGraphemes(currentLine, 0, cut) + sliceGraphemes(currentLine, safeCursor.col);
        const newLines = [
          ...lines.slice(0, safeCursor.line),
          newLine,
          ...lines.slice(safeCursor.line + 1),
        ];
        const nextValue = joinLines(newLines);
        applyTextEdit({ value: nextValue, cursorLine: safeCursor.line, cursorCol: cut });
        return;
      }

      // Ctrl+Delete or Alt+D — delete word forward.
      if ((key.ctrl && key.delete) || (key.meta && input === "d")) {
        const range = currentSelection();
        if (range) {
          replaceSelectionAndSnap("");
          return;
        }
        const currentLine = lines[safeCursor.line] ?? "";
        if (safeCursor.col >= graphemeLength(currentLine)) {
          if (safeCursor.line >= lines.length - 1) return;
          const nextLine = lines[safeCursor.line + 1] ?? "";
          beforeMutation(true);
          const mergedLine = currentLine + nextLine;
          const newLines = [
            ...lines.slice(0, safeCursor.line),
            mergedLine,
            ...lines.slice(safeCursor.line + 2),
          ];
          const nextValue = joinLines(newLines);
          applyTextEdit({ value: nextValue, cursorLine: safeCursor.line, cursorCol: safeCursor.col });
          return;
        }
        const cut = findNextWordCol(currentLine, safeCursor.col);
        beforeMutation(true);
        const newLine = sliceGraphemes(currentLine, 0, safeCursor.col) + sliceGraphemes(currentLine, cut);
        const newLines = [
          ...lines.slice(0, safeCursor.line),
          newLine,
          ...lines.slice(safeCursor.line + 1),
        ];
        const nextValue = joinLines(newLines);
        applyTextEdit({ value: nextValue, cursorLine: safeCursor.line, cursorCol: safeCursor.col });
        return;
      }

      // Indent / outdent current line or selected lines. Plain Tab finally
      // behaves like an editor key; ctrl+[ / ctrl+] remain explicit fallbacks
      // for terminals that steal Shift+Tab.
      if (
        key.tab ||
        (key.ctrl && (input === "]" || input === "["))
      ) {
        const selection = currentSelection()
          ? { start: anchor ?? safeCursor, end: safeCursor }
          : null;
        const shouldOutdent = (key.shift && key.tab) || (key.ctrl && input === "[");
        beforeMutation(true);
        const result = shouldOutdent
          ? outdentLines(value, safeCursor, selection, DEFAULT_INDENT.length)
          : indentLines(value, safeCursor, selection, DEFAULT_INDENT);
        applyTextEdit(
          { value: result.value, cursorLine: result.cursorLine, cursorCol: result.cursorCol },
          result.anchor
        );
        return;
      }

      if (key.return) {
        // With a selection, Enter replaces it with a newline.
        const range = currentSelection();
        if (range) {
          replaceSelectionAndSnap("\n");
          return;
        }
        beforeMutation(true);
        const currentLine = lines[safeCursor.line] ?? "";
        const before = sliceGraphemes(currentLine, 0, safeCursor.col);
        const continuationIndent = indentationForNextLine(before);
        const result = replaceRange(
          lines,
          { start: safeCursor, end: safeCursor },
          `\n${continuationIndent}`
        );
        applyTextEdit(result);
        return;
      }

      if (key.backspace) {
        // Route through the pure `applyBackspace` helper so the keystep is
        // (a) testable in isolation and (b) defensive against a stale anchor
        // or stale cursor — the helper clamps both before deciding what to
        // do. `currentSelection()` already filters empty-after-clamp ranges,
        // so the helper sees a real selection only when one actually spans
        // characters.
        const range = currentSelection();
        const step = applyBackspace(
          value,
          safeCursor,
          range ? (anchor ?? null) : null
        );
        if (!step.changed) return;
        beforeMutation(range !== null || safeCursor.col === 0);
        applyTextEdit({
          value: step.value,
          cursorLine: step.cursorLine,
          cursorCol: step.cursorCol,
        });
        return;
      }

      // Delete (forward-delete): mirror of backspace. Same helper-routing
      // applies — see comment above.
      if (key.delete) {
        const range = currentSelection();
        const currentLine = lines[safeCursor.line] ?? "";
        const step = applyForwardDelete(
          value,
          safeCursor,
          range ? (anchor ?? null) : null
        );
        if (!step.changed) return;
        beforeMutation(range !== null || safeCursor.col >= graphemeLength(currentLine));
        applyTextEdit({
          value: step.value,
          cursorLine: step.cursorLine,
          cursorCol: step.cursorCol,
        });
        return;
      }

      // Ctrl+Left / Ctrl+Right are owned by Workbench note cycling. Return
      // before the plain-arrow handlers below so the editor does not also move.
      if (key.ctrl && (key.leftArrow || key.rightArrow)) {
        return;
      }

      // Alt+Left — move cursor to start of previous word. Ctrl+Left is taken
      // at the workbench level for note cycling, so this binds Alt+Left as the
      // editor's word-nav escape hatch.
      if (key.meta && key.leftArrow) {
        let nextLine = safeCursor.line;
        let nextCol = safeCursor.col;
        if (safeCursor.col === 0) {
          if (safeCursor.line === 0) return;
          nextLine = safeCursor.line - 1;
          nextCol = graphemeLength(lines[nextLine] ?? "");
        } else {
          nextCol = findPrevWordCol(lines[safeCursor.line] ?? "", safeCursor.col);
        }
        moveCursor({ line: nextLine, col: nextCol });
        return;
      }

      if (key.leftArrow) {
        let nextLine = safeCursor.line;
        let nextCol = safeCursor.col;
        if (safeCursor.col > 0) {
          nextCol = safeCursor.col - 1;
        } else if (safeCursor.line > 0) {
          const prevLine = lines[safeCursor.line - 1] ?? "";
          nextLine = safeCursor.line - 1;
          nextCol = graphemeLength(prevLine);
        } else {
          return;
        }
        moveCursor({ line: nextLine, col: nextCol });
        return;
      }

      // Alt+Right — move cursor to end of next word. Mirror of Alt+Left.
      if (key.meta && key.rightArrow) {
        const currentLine = lines[safeCursor.line] ?? "";
        let nextLine = safeCursor.line;
        let nextCol = safeCursor.col;
        if (safeCursor.col >= graphemeLength(currentLine)) {
          if (safeCursor.line >= lines.length - 1) return;
          nextLine = safeCursor.line + 1;
          nextCol = 0;
        } else {
          nextCol = findNextWordCol(currentLine, safeCursor.col);
        }
        moveCursor({ line: nextLine, col: nextCol });
        return;
      }

      if (key.rightArrow) {
        const currentLine = lines[safeCursor.line] ?? "";
        let nextLine = safeCursor.line;
        let nextCol = safeCursor.col;
        if (safeCursor.col < graphemeLength(currentLine)) {
          nextCol = safeCursor.col + 1;
        } else if (safeCursor.line < lines.length - 1) {
          nextLine = safeCursor.line + 1;
          nextCol = 0;
        } else {
          return;
        }
        moveCursor({ line: nextLine, col: nextCol });
        return;
      }

      // Up/down navigate VISUAL rows. Preserve the intended visual column
      // across ragged/wrapped rows until a horizontal move or edit happens.
      if (key.upArrow) {
        const { row, col } = cursorToVisual(visualLines, safeCursor.line, safeCursor.col);
        if (row === 0) return;
        const desiredCol = preferredVisualColRef.current ?? col;
        preferredVisualColRef.current = desiredCol;
        const next = visualToCursor(visualLines, row - 1, desiredCol);
        moveCursor(next, true);
        return;
      }

      if (key.downArrow) {
        const { row, col } = cursorToVisual(visualLines, safeCursor.line, safeCursor.col);
        if (row >= visualLines.length - 1) return;
        const desiredCol = preferredVisualColRef.current ?? col;
        preferredVisualColRef.current = desiredCol;
        const next = visualToCursor(visualLines, row + 1, desiredCol);
        moveCursor(next, true);
        return;
      }

      if (key.pageUp) {
        const { row, col } = cursorToVisual(visualLines, safeCursor.line, safeCursor.col);
        const desiredCol = preferredVisualColRef.current ?? col;
        preferredVisualColRef.current = desiredCol;
        const targetRow = Math.max(0, row - safeRows);
        const next = visualToCursor(visualLines, targetRow, desiredCol);
        moveCursor(next, true);
        return;
      }

      if (key.pageDown) {
        const { row, col } = cursorToVisual(visualLines, safeCursor.line, safeCursor.col);
        const desiredCol = preferredVisualColRef.current ?? col;
        preferredVisualColRef.current = desiredCol;
        const targetRow = Math.min(visualLines.length - 1, row + safeRows);
        const next = visualToCursor(visualLines, targetRow, desiredCol);
        moveCursor(next, true);
        return;
      }

      if (key.escape || key.tab) {
        return;
      }

      // Unknown ctrl/meta sequences should never leak raw control bytes into
      // the buffer.
      if (key.ctrl || key.meta) {
        return;
      }

      if (input && input.length > 0) {
        const normalized = stripEditorControlChars(normalizeEditorInput(input));
        if (!normalized) return;
        // With a selection, typing replaces the selection (overtype).
        const range = currentSelection();
        if (range) {
          replaceSelectionAndSnap(normalized);
          return;
        }
        beforeMutation(normalized.length > 1 || normalized.includes("\n"));
        const result = replaceRange(lines, { start: safeCursor, end: safeCursor }, normalized);
        applyTextEdit(result);
      }
    },
    { isActive: isActive && isFocused }
  );

  // Wheel + click handling.
  useMouse(
    useCallback(
      (event) => {
        if (!isActive || !isFocused) return;

        if (event.kind === "wheel") {
          // scrollOffset is in visual rows. Cap to the last possible
          // top-of-viewport so we don't scroll past the buffer end.
          const targetMaxScroll = Math.max(0, visualLines.length - safeRows);
          if (event.button === "wheel-up") {
            setScrollOffset((s) => {
              const next = Math.max(0, Math.min(targetMaxScroll, s - 3));
              scrollOffsetRef.current = next;
              return next;
            });
          } else if (event.button === "wheel-down") {
            setScrollOffset((s) => {
              const next = Math.max(0, Math.min(targetMaxScroll, s + 3));
              scrollOffsetRef.current = next;
              return next;
            });
          }
          return;
        }

        // Translate a screen-coord event into a logical (line, col) cursor
        // position inside the editor viewport. Returns null when the event
        // lands outside the editor area.
        const positionFromEvent = (): Position | null => {
          if (mouseTopRow === undefined || mouseLeftCol === undefined) {
            return null;
          }
          const localRow = event.row - mouseTopRow;
          const localCol = event.col - mouseLeftCol;
          if (localRow < 0 || localRow >= safeRows) return null;
          if (localCol < 0) return null;
          // Read scroll from the ref so back-to-back wheel + click events
          // within one stdin chunk see the freshest value.
          const targetVisualRow = Math.min(
            visualLines.length - 1,
            scrollOffsetRef.current + localRow
          );
          if (targetVisualRow < 0) return null;
          const next = visualToCursor(visualLines, targetVisualRow, localCol);
          return { line: next.line, col: next.col };
        };

        // Right-click: terminal-conventional copy/paste shortcut. Clicking
        // inside an active selection copies it; clicking anywhere else pastes
        // the system clipboard at the click point.
        if (event.button === "right" && event.kind === "press") {
          const pos = positionFromEvent();
          if (!pos) return;
          const range = currentSelection();
          if (range && containsPosition(range, pos)) {
            copyCurrent();
            return;
          }
          const clip = readFromSystemClipboard();
          if (clip === null || clip.length === 0) {
            setCursor(pos);
            setAnchor(null);
            preferredVisualColRef.current = null;
            resetSelectionRefs();
            return;
          }
          pasteAt(pos, clip);
          return;
        }

        if (event.button === "left" && event.kind === "press") {
          const pos = positionFromEvent();
          if (!pos) return;
          setCursor(pos);
          setAnchor(null);
          preferredVisualColRef.current = null;
          // Remember the press position so the first drag event can seed
          // the selection anchor there.
          pressPositionRef.current = pos;
          dragAnchorSetRef.current = false;
          return;
        }

        if (event.button === "left" && event.kind === "drag") {
          const pos = positionFromEvent();
          if (!pos) return;
          if (!dragAnchorSetRef.current && pressPositionRef.current) {
            setAnchor(pressPositionRef.current);
            dragAnchorSetRef.current = true;
          }
          setCursor(pos);
          preferredVisualColRef.current = null;
          return;
        }

        if (event.kind === "release") {
          resetSelectionRefs();
        }
      },
      [
        isActive,
        isFocused,
        visualLines,
        safeRows,
        mouseTopRow,
        mouseLeftCol,
        value,
        anchor,
        cursorLine,
        cursorCol,
        currentSelection,
      ]
    ),
    { isActive: isActive && isFocused }
  );

  const isInteractive = isActive && isFocused;
  const borderColor = isInteractive ? theme.colors.focusRing : theme.colors.border;
  const visible = visualLines.slice(effectiveScrollOffset, effectiveScrollOffset + safeRows);
  const paddedVisible: (typeof visualLines[number] | null)[] = [...visible];
  while (paddedVisible.length < safeRows) {
    paddedVisible.push(null);
  }

  const isEmpty = value.length === 0;
  const safeCursor = clampPosition(logicalLines, { line: cursorLine, col: cursorCol });
  // Find the cursor's visual position once for the active-row render.
  const cursorVisual = cursorToVisual(visualLines, safeCursor.line, safeCursor.col);

  // Selection's visual range — visual rows/cols covering the selected logical
  // span. Null when no selection. Drives the per-row inverse rendering below.
  const activeSelection = currentSelection();
  const selVisualStart = activeSelection
    ? cursorToVisual(visualLines, activeSelection.start.line, activeSelection.start.col)
    : null;
  const selVisualEnd = activeSelection
    ? cursorToVisual(visualLines, activeSelection.end.line, activeSelection.end.col)
    : null;

  const renderBody = (
    <>
      {paddedVisible.map((vl, rowIdx) => {
        const absoluteVisualRow = rowIdx + effectiveScrollOffset;

        if (isEmpty && rowIdx === 0) {
          return (
            <Box key={rowIdx} flexDirection="row">
              {isInteractive && <Text color={theme.colors.focusRing}>{cursor}</Text>}
              <Text color={theme.colors.mutedForeground}>{placeholder}</Text>
            </Box>
          );
        }

        if (vl === null) {
          // Render a single-space Text so the empty row claims one terminal
          // row of height. An empty <Box /> collapses to zero height in Ink.
          return (
            <Box key={rowIdx} flexDirection="row">
              <Text> </Text>
            </Box>
          );
        }

        // Selection bounds within this visual row, if the selection overlaps it.
        // Render-side column math runs in grapheme units so a 4-byte emoji
        // or ZWJ family counts as one cell — matching `Position.col` and
        // `cursorToVisual`. We compute the length once per row and slice by
        // grapheme indices when building the styled segments.
        const vlLen = graphemeLength(vl.text);
        let rowSelStart: number | null = null;
        let rowSelEnd: number | null = null;
        if (selVisualStart && selVisualEnd) {
          if (
            absoluteVisualRow >= selVisualStart.row &&
            absoluteVisualRow <= selVisualEnd.row
          ) {
            rowSelStart =
              absoluteVisualRow === selVisualStart.row ? selVisualStart.col : 0;
            rowSelEnd =
              absoluteVisualRow === selVisualEnd.row ? selVisualEnd.col : vlLen;
            rowSelStart = clampSplit(rowSelStart, vlLen);
            rowSelEnd = clampSplit(rowSelEnd, vlLen);
            if (rowSelEnd < rowSelStart) {
              const tmp = rowSelStart;
              rowSelStart = rowSelEnd;
              rowSelEnd = tmp;
            }
          }
        }

        const isActiveRow = isInteractive && absoluteVisualRow === cursorVisual.row;
        const cursorColOnRow = isActiveRow ? clampSplit(cursorVisual.col, vlLen) : null;

        // Build styled segments. The cursor is rendered as the actual character
        // at its position with backgroundColor + color — NOT a separate
        // inserted block — so row width stays stable.
        type CharStyle = "normal" | "selected" | "cursor";
        const splits = new Set<number>([0, vlLen]);
        if (rowSelStart !== null) splits.add(rowSelStart);
        if (rowSelEnd !== null) splits.add(rowSelEnd);
        if (cursorColOnRow !== null && cursorColOnRow < vlLen) {
          splits.add(cursorColOnRow);
          splits.add(cursorColOnRow + 1);
        }
        const sortedSplits = [...splits]
          .map((split) => clampSplit(split, vlLen))
          .sort((a, b) => a - b);
        const segments: Array<{ text: string; style: CharStyle }> = [];
        for (let i = 0; i < sortedSplits.length - 1; i++) {
          const segStart = sortedSplits[i];
          const segEnd = sortedSplits[i + 1];
          if (segStart === segEnd) continue;
          let style: CharStyle = "normal";
          if (
            cursorColOnRow !== null &&
            cursorColOnRow < vlLen &&
            segStart === cursorColOnRow
          ) {
            style = "cursor";
          } else if (
            rowSelStart !== null &&
            rowSelEnd !== null &&
            segStart >= rowSelStart &&
            segEnd <= rowSelEnd
          ) {
            style = "selected";
          }
          segments.push({ text: sliceGraphemes(vl.text, segStart, segEnd), style });
        }

        // Cursor sitting one column past the end of the line: emit an extra
        // one-col cursor span containing a space, since there's no character
        // there to style in place.
        const cursorPastEnd =
          isActiveRow && cursorColOnRow !== null && cursorColOnRow >= vlLen;

        // Empty, non-active rows would otherwise collapse to zero terminal rows.
        const isBlankRow = segments.length === 0 && !cursorPastEnd;

        return (
          <Box key={rowIdx} flexDirection="row">
            {isBlankRow && <Text> </Text>}
            {segments.map((seg, segIdx) => (
              <Text
                key={segIdx}
                inverse={seg.style === "selected"}
                backgroundColor={
                  seg.style === "cursor" ? theme.colors.focusRing : undefined
                }
                color={
                  seg.style === "cursor"
                    ? theme.colors.background
                    : seg.style === "selected"
                      ? undefined
                      : theme.colors.foreground
                }
              >
                {seg.text}
              </Text>
            ))}
            {cursorPastEnd && (
              <Text
                backgroundColor={theme.colors.focusRing}
                color={theme.colors.background}
              >
                {" "}
              </Text>
            )}
          </Box>
        );
      })}
    </>
  );

  // Scrollbar — thumb-on-track on the right edge. Default visible when
  // wrapping (where content height is meaningful and we have meaningful
  // viewport math). Hidden when content fits in one viewport.
  const scrollbarVisible =
    (showScrollbar ?? wrapWidth > 0) && visualLines.length > safeRows;
  const thumbSize =
    visualLines.length <= safeRows
      ? safeRows
      : Math.max(1, Math.round((safeRows / visualLines.length) * safeRows));
  const thumbPosition =
    visualLines.length <= safeRows || maxScroll === 0
      ? 0
      : Math.round((effectiveScrollOffset / maxScroll) * (safeRows - thumbSize));

  const scrollbar = scrollbarVisible ? (
    <Box width={1} flexDirection="column" flexShrink={0}>
      {Array.from({ length: safeRows }, (_, i) => {
        const isThumb = i >= thumbPosition && i < thumbPosition + thumbSize;
        return (
          <Text
            key={i}
            color={isThumb ? theme.colors.primary : theme.colors.mutedForeground}
          >
            {isThumb ? "█" : "│"}
          </Text>
        );
      })}
    </Box>
  ) : null;

  const bodyWithScrollbar = (
    <Box flexDirection="row">
      <Box flexDirection="column" flexGrow={1}>
        {renderBody}
      </Box>
      {scrollbar}
    </Box>
  );

  if (!bordered) {
    return (
      <Box flexDirection="column" paddingX={paddingX}>
        {label && <Text bold>{label}</Text>}
        {bodyWithScrollbar}
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {label && <Text bold>{label}</Text>}
      <Box
        flexDirection="column"
        borderStyle={borderStyle}
        borderColor={borderColor}
        paddingX={paddingX}
      >
        {bodyWithScrollbar}
      </Box>
    </Box>
  );
};
