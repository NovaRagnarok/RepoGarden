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

/**
 * Split `text` into grapheme clusters. Logical column arithmetic across the
 * editor (cursor positions, selection ranges, backspace/forward-delete) is
 * done in this unit so a 4-byte emoji or ZWJ family counts as one cell —
 * never landing the caret between surrogate halves or splitting a cluster
 * mid-character. Node >=22 ships `Intl.Segmenter` in every build, so we use
 * it unconditionally; the fallback is codepoint splitting via `Array.from`
 * (still strictly better than `.split("")`, which yields code units).
 *
 * The empty string returns an empty array.
 */
const graphemeSegmenter: Intl.Segmenter | null =
  typeof Intl !== "undefined" && typeof Intl.Segmenter === "function"
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null;

export const splitGraphemes = (text: string): string[] => {
  if (text.length === 0) return [];
  if (graphemeSegmenter) {
    const out: string[] = [];
    for (const segment of graphemeSegmenter.segment(text)) {
      out.push(segment.segment);
    }
    return out;
  }
  // Codepoint fallback. `Array.from` walks code points, joining surrogate
  // pairs back into a single string entry each.
  return Array.from(text);
};

/** Number of grapheme clusters in `text`. The unit of `Position.col`. */
export const graphemeLength = (text: string): number => splitGraphemes(text).length;

/**
 * Slice `text` by grapheme indices and re-join. Used everywhere we need a
 * substring of a logical line bounded by logical (cursor) columns.
 */
export const sliceGraphemes = (
  text: string,
  start: number,
  end?: number
): string => {
  const graphemes = splitGraphemes(text);
  return graphemes.slice(start, end).join("");
};

/**
 * Convert a grapheme-index column into a code-unit offset within `text`.
 * Used when underlying string ops (e.g. building the new buffer in
 * `replaceRange`) need to splice the JS string itself.
 */
export const graphemeColToCodeUnit = (text: string, col: number): number => {
  if (col <= 0) return 0;
  const graphemes = splitGraphemes(text);
  if (col >= graphemes.length) return text.length;
  let offset = 0;
  for (let i = 0; i < col; i++) {
    offset += (graphemes[i] ?? "").length;
  }
  return offset;
};

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
    Math.min(graphemeLength(safeLines[line] ?? ""), finiteInteger(pos.col))
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
    return sliceGraphemes(safeLines[start.line] ?? "", start.col, end.col);
  }
  const parts: string[] = [];
  parts.push(sliceGraphemes(safeLines[start.line] ?? "", start.col));
  for (let i = start.line + 1; i < end.line; i++) {
    parts.push(safeLines[i] ?? "");
  }
  parts.push(sliceGraphemes(safeLines[end.line] ?? "", 0, end.col));
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
  // start.col / end.col are grapheme-cluster indices; slice the underlying
  // strings by grapheme so a 4-byte emoji or ZWJ family at the boundary is
  // never split mid-codepoint.
  const beforePart = sliceGraphemes(safeLines[start.line] ?? "", 0, start.col);
  const afterPart = sliceGraphemes(safeLines[end.line] ?? "", end.col);
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
  // Post-edit cursor sits at the end of the inserted text — express in
  // grapheme units so callers stay consistent with `Position.col`.
  const cursorCol =
    replacementLines.length === 1
      ? start.col + graphemeLength(normalizedReplacement)
      : graphemeLength(replacementLines[replacementLines.length - 1] ?? "");

  return { value: newLines.join("\n"), cursorLine, cursorCol };
};
