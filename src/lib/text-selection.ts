/**
 * Selection helpers for the TextArea. The selection is defined by an
 * `anchor` position in logical coordinates (line + col) plus the current
 * cursor position. The anchor is where the selection started; the cursor
 * is where it ends (= the "head"). Either ordering is valid — anchor can
 * be before or after the cursor in document order.
 *
 * Working in logical coordinates keeps selection semantics independent of
 * wrap: the same characters stay selected whether the editor wraps at 60
 * or 120 columns.
 */

export interface Position {
  line: number;
  col: number;
}

export interface SelectionRange {
  start: Position;
  end: Position;
}

/** Normalize pasted / loaded text to the editor's internal LF-only model. */
export const normalizeLineEndings = (text: string): string =>
  text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

/** True when two logical positions point at the same cell. */
export const positionsEqual = (a: Position, b: Position): boolean =>
  a.line === b.line && a.col === b.col;

const finiteInteger = (value: number): number =>
  Number.isFinite(value) ? Math.trunc(value) : 0;

/** Clamp a logical position to an existing line and column. */
export const clampPosition = (lines: string[], pos: Position): Position => {
  const safeLines = lines.length > 0 ? lines : [""];
  const line = Math.max(
    0,
    Math.min(safeLines.length - 1, finiteInteger(pos.line))
  );
  const col = Math.max(
    0,
    Math.min((safeLines[line] ?? "").length, finiteInteger(pos.col))
  );
  return { line, col };
};

/** Clamp both ends of a range and return it in start-before-end order. */
export const clampRange = (
  lines: string[],
  range: SelectionRange
): SelectionRange => {
  const start = clampPosition(lines, range.start);
  const end = clampPosition(lines, range.end);
  return orderRange(start, end);
};

/** True when `a` is strictly before `b` in document order. */
export const isBefore = (a: Position, b: Position): boolean =>
  a.line < b.line || (a.line === b.line && a.col < b.col);

/** Normalize (anchor, cursor) into start-before-end ordering. */
export const orderRange = (anchor: Position, cursor: Position): SelectionRange =>
  isBefore(anchor, cursor) ? { start: anchor, end: cursor } : { start: cursor, end: anchor };

/** True when the selection is empty (anchor === cursor). */
export const isEmptyRange = (range: SelectionRange): boolean =>
  range.start.line === range.end.line && range.start.col === range.end.col;

/**
 * True when `pos` falls inside `range`. The start is inclusive and the end
 * is exclusive, matching how the selection is rendered (visually highlighted
 * characters span [start, end)) so a right-click on any visually selected
 * character is treated as "inside the selection".
 */
export const containsPosition = (
  range: SelectionRange,
  pos: Position
): boolean => {
  const afterStart =
    pos.line > range.start.line ||
    (pos.line === range.start.line && pos.col >= range.start.col);
  const beforeEnd =
    pos.line < range.end.line ||
    (pos.line === range.end.line && pos.col < range.end.col);
  return afterStart && beforeEnd;
};

/**
 * Extract the substring of the buffer covered by the selection range.
 * Multi-line selections re-join with `\n` so the result is paste-ready.
 */
export const getSelectedText = (lines: string[], range: SelectionRange): string => {
  const safeLines = lines.length > 0 ? lines : [""];
  const { start, end } = clampRange(safeLines, range);
  if (start.line === end.line) {
    return (safeLines[start.line] ?? "").slice(start.col, end.col);
  }
  const parts: string[] = [];
  parts.push((safeLines[start.line] ?? "").slice(start.col));
  for (let i = start.line + 1; i < end.line; i++) {
    parts.push(safeLines[i] ?? "");
  }
  parts.push((safeLines[end.line] ?? "").slice(0, end.col));
  return parts.join("\n");
};

/** Count selected characters using the same LF-joined model as copy/paste. */
export const getSelectedCharCount = (
  lines: string[],
  range: SelectionRange
): number => getSelectedText(lines, range).length;

/**
 * Replace the selection range with `replacement`. Returns the new buffer
 * value and the post-replacement cursor position (placed at the end of
 * the inserted text). Pure — caller updates state.
 */
export const replaceRange = (
  lines: string[],
  range: SelectionRange,
  replacement: string
): { value: string; cursorLine: number; cursorCol: number } => {
  const safeLines = lines.length > 0 ? lines : [""];
  const { start, end } = clampRange(safeLines, range);
  const normalizedReplacement = normalizeLineEndings(replacement);
  const beforeLines = safeLines.slice(0, start.line);
  const beforePart = (safeLines[start.line] ?? "").slice(0, start.col);
  const afterPart = (safeLines[end.line] ?? "").slice(end.col);
  const afterLines = safeLines.slice(end.line + 1);

  const replacementLines = normalizedReplacement.split("\n");
  let newLines: string[];
  if (replacementLines.length === 1) {
    newLines = [
      ...beforeLines,
      beforePart + normalizedReplacement + afterPart,
      ...afterLines,
    ];
  } else {
    const lastReplacementLine = replacementLines[replacementLines.length - 1] ?? "";
    newLines = [
      ...beforeLines,
      beforePart + (replacementLines[0] ?? ""),
      ...replacementLines.slice(1, -1),
      lastReplacementLine + afterPart,
      ...afterLines,
    ];
  }

  const cursorLine = start.line + replacementLines.length - 1;
  const cursorCol =
    replacementLines.length === 1
      ? start.col + normalizedReplacement.length
      : (replacementLines[replacementLines.length - 1] ?? "").length;

  return { value: newLines.join("\n"), cursorLine, cursorCol };
};
