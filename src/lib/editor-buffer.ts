import {
  graphemeLength,
  isEmptyRange,
  orderRange,
  replaceRange,
  sliceGraphemes,
  type Position,
  type SelectionRange,
} from "@/lib/text-selection";

// Re-export the grapheme helpers from the editor module so call sites have
// a single import surface for "column arithmetic". `Position.col` is a
// grapheme-cluster index throughout the editor; these helpers are the
// canonical way to translate between that index and an underlying string.
export { graphemeLength, sliceGraphemes, splitGraphemes } from "@/lib/text-selection";

/**
 * Codepoint-aware length / slice aliases. Today these are backed by
 * `Intl.Segmenter` grapheme splitting (Node >=22), which closes the
 * surrogate-pair gap AND treats ZWJ families / flags / skin-tone modifiers
 * as single cells. The aliases exist so callers that only need codepoint
 * correctness can opt out of grapheme semantics later if needed without
 * a churn of call-site renames.
 */
export const codepointLength = graphemeLength;
export const sliceCodepoints = sliceGraphemes;

export const getEditorLines = (value: string): string[] => value.split("\n");

export const joinEditorLines = (lines: string[]): string => lines.join("\n");

export const normalizeEditorInput = (input: string): string =>
  input.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

export const stripEditorControlChars = (input: string): string =>
  input.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");

export const clampPosition = (lines: string[], position: Position): Position => {
  const safeLines = lines.length > 0 ? lines : [""];
  const line = Math.max(0, Math.min(safeLines.length - 1, position.line));
  const col = Math.max(
    0,
    Math.min(graphemeLength(safeLines[line] ?? ""), position.col)
  );
  return { line, col };
};

export const positionsEqual = (a: Position, b: Position): boolean =>
  a.line === b.line && a.col === b.col;

export const clampSelectionRange = (
  lines: string[],
  range: SelectionRange
): SelectionRange =>
  orderRange(clampPosition(lines, range.start), clampPosition(lines, range.end));

export const endOfDocument = (value: string): Position => {
  const lines = getEditorLines(value);
  const lastLine = Math.max(0, lines.length - 1);
  return { line: lastLine, col: graphemeLength(lines[lastLine] ?? "") };
};

export const allTextSelection = (value: string): SelectionRange | null => {
  if (value.length === 0) return null;
  return { start: { line: 0, col: 0 }, end: endOfDocument(value) };
};

export interface LineEditResult {
  value: string;
  cursorLine: number;
  cursorCol: number;
  anchor: Position | null;
}

const leadingIndentWidth = (line: string): number => {
  let width = 0;
  while (width < line.length && (line[width] === " " || line[width] === "\t")) {
    width++;
  }
  return width;
};

const lineRangeForEdit = (
  lines: string[],
  cursor: Position,
  selection: SelectionRange | null
): { startLine: number; endLine: number } => {
  if (!selection) return { startLine: cursor.line, endLine: cursor.line };
  const range = clampSelectionRange(lines, selection);
  const endLine = range.end.col === 0
    ? Math.max(range.start.line, range.end.line - 1)
    : range.end.line;
  return { startLine: range.start.line, endLine };
};

export const indentLines = (
  value: string,
  cursor: Position,
  selection: SelectionRange | null,
  indent = "  "
): LineEditResult => {
  const lines = getEditorLines(value);
  const safeCursor = clampPosition(lines, cursor);
  const { startLine, endLine } = lineRangeForEdit(lines, safeCursor, selection);
  const nextLines = [...lines];
  for (let line = startLine; line <= endLine; line++) {
    nextLines[line] = indent + (nextLines[line] ?? "");
  }

  const shiftPosition = (pos: Position): Position => {
    const safe = clampPosition(lines, pos);
    return safe.line >= startLine && safe.line <= endLine
      ? { line: safe.line, col: safe.col + indent.length }
      : safe;
  };

  const nextCursor = shiftPosition(safeCursor);
  const nextAnchor = selection ? shiftPosition(selection.start) : null;
  return {
    value: joinEditorLines(nextLines),
    cursorLine: nextCursor.line,
    cursorCol: nextCursor.col,
    anchor: nextAnchor,
  };
};

export const outdentLines = (
  value: string,
  cursor: Position,
  selection: SelectionRange | null,
  indentSize = 2
): LineEditResult => {
  const lines = getEditorLines(value);
  const safeCursor = clampPosition(lines, cursor);
  const { startLine, endLine } = lineRangeForEdit(lines, safeCursor, selection);
  const nextLines = [...lines];
  const removedByLine = new Map<number, number>();

  for (let line = startLine; line <= endLine; line++) {
    const text = nextLines[line] ?? "";
    let remove = 0;
    if (text.startsWith("\t")) {
      remove = 1;
    } else {
      const leading = leadingIndentWidth(text);
      remove = Math.min(indentSize, leading);
    }
    if (remove > 0) {
      nextLines[line] = text.slice(remove);
      removedByLine.set(line, remove);
    }
  }

  const shiftPosition = (pos: Position): Position => {
    const safe = clampPosition(lines, pos);
    const removed = removedByLine.get(safe.line) ?? 0;
    return removed > 0
      ? { line: safe.line, col: Math.max(0, safe.col - Math.min(removed, safe.col)) }
      : safe;
  };

  const nextCursor = shiftPosition(safeCursor);
  const nextAnchor = selection ? shiftPosition(selection.start) : null;
  return {
    value: joinEditorLines(nextLines),
    cursorLine: nextCursor.line,
    cursorCol: nextCursor.col,
    anchor: nextAnchor,
  };
};

/**
 * Result of a single backspace/delete keystep. Returns the new buffer value
 * and the post-mutation cursor; anchor is always cleared by these edits.
 * `changed` is false when the keystep is a no-op (e.g. backspace at the very
 * start of the buffer with no selection) so callers can skip history /
 * scroll work.
 */
export interface KeyStepResult {
  value: string;
  cursorLine: number;
  cursorCol: number;
  changed: boolean;
}

/**
 * Apply one Backspace keystep. Handles three cases in priority order:
 *   1) An active, non-empty selection → delete the selection.
 *   2) Cursor mid-line → delete the char before the cursor.
 *   3) Cursor at line start, line > 0 → join with the previous line.
 *
 * Inputs are clamped defensively — callers may pass stale (cursorLine,
 * cursorCol) or anchor positions after a paste / selection-delete shrinks
 * the buffer. The early-return-on-stale-state guard in TextArea used to
 * eat the keystroke entirely; routing through this helper lets the edit
 * apply at the clamped position instead, so a single Backspace never
 * silently no-ops just because state hadn't yet rendered (#16).
 */
export const applyBackspace = (
  value: string,
  cursor: Position,
  anchor: Position | null
): KeyStepResult => {
  const lines = getEditorLines(value);
  const safeCursor = clampPosition(lines, cursor);

  if (anchor) {
    const safeAnchor = clampPosition(lines, anchor);
    const range = orderRange(safeAnchor, safeCursor);
    if (!isEmptyRange(range)) {
      const result = replaceRange(lines, range, "");
      return { ...result, changed: true };
    }
  }

  if (safeCursor.col > 0) {
    const result = replaceRange(
      lines,
      {
        start: { line: safeCursor.line, col: safeCursor.col - 1 },
        end: safeCursor,
      },
      ""
    );
    return { ...result, changed: true };
  }

  if (safeCursor.line > 0) {
    const prevLine = lines[safeCursor.line - 1] ?? "";
    const result = replaceRange(
      lines,
      {
        start: { line: safeCursor.line - 1, col: graphemeLength(prevLine) },
        end: safeCursor,
      },
      ""
    );
    return { ...result, changed: true };
  }

  return {
    value,
    cursorLine: safeCursor.line,
    cursorCol: safeCursor.col,
    changed: false,
  };
};

/**
 * Apply one forward-Delete keystep — mirror of `applyBackspace`. Selection
 * wins; otherwise removes the char AFTER the cursor or joins the next line
 * up when at end-of-line.
 */
export const applyForwardDelete = (
  value: string,
  cursor: Position,
  anchor: Position | null
): KeyStepResult => {
  const lines = getEditorLines(value);
  const safeCursor = clampPosition(lines, cursor);

  if (anchor) {
    const safeAnchor = clampPosition(lines, anchor);
    const range = orderRange(safeAnchor, safeCursor);
    if (!isEmptyRange(range)) {
      const result = replaceRange(lines, range, "");
      return { ...result, changed: true };
    }
  }

  const currentLine = lines[safeCursor.line] ?? "";
  if (safeCursor.col < graphemeLength(currentLine)) {
    const result = replaceRange(
      lines,
      {
        start: safeCursor,
        end: { line: safeCursor.line, col: safeCursor.col + 1 },
      },
      ""
    );
    return { ...result, changed: true };
  }

  if (safeCursor.line < lines.length - 1) {
    const result = replaceRange(
      lines,
      {
        start: safeCursor,
        end: { line: safeCursor.line + 1, col: 0 },
      },
      ""
    );
    return { ...result, changed: true };
  }

  return {
    value,
    cursorLine: safeCursor.line,
    cursorCol: safeCursor.col,
    changed: false,
  };
};

export const indentationForNextLine = (lineBeforeCursor: string): string => {
  const indent = lineBeforeCursor.match(/^[ \t]*/)?.[0] ?? "";
  const trimmed = lineBeforeCursor.slice(indent.length);
  const bullet = trimmed.match(/^([-*+]\s+)/)?.[1];
  const numbered = trimmed.match(/^(\d+)([.)]\s+)/);
  if (bullet) return `${indent}${bullet}`;
  if (numbered) {
    const next = Number.parseInt(numbered[1] ?? "0", 10) + 1;
    return `${indent}${next}${numbered[2] ?? ". "}`;
  }
  return indent;
};
