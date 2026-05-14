/**
 * Soft word-wrap helpers for the TextArea.
 *
 * The TextArea's buffer is a flat string with explicit `\n` line breaks
 * (logical lines). When wrap is enabled, each logical line may be rendered
 * across several visual rows. These helpers translate between the two
 * coordinate systems so cursor movement, scrolling, and click-to-position
 * all work without baking the wrap logic into the editor's keypress paths.
 *
 * Wrap policy: break at the last whitespace within the width budget when
 * possible; otherwise hard-wrap at the width. The whitespace is kept with
 * the preceding visual line (so the next visual line starts on a non-space),
 * which matches what most text editors do.
 *
 * All column indices (`VisualLine.start`, the `col` returned by
 * `cursorToVisual`, and the `visualCol` accepted by `visualToCursor`) are
 * grapheme-cluster indices — the same unit `Position.col` uses everywhere
 * in the editor. A 4-byte emoji occupies one cell; the caret never lands
 * mid-surrogate (#24).
 */
import { graphemeLength, splitGraphemes } from "@/lib/text-selection";

export interface VisualLine {
  /** Index into the logical lines array this visual line came from. */
  logicalLine: number;
  /** Logical column at which this visual line begins (inclusive). */
  start: number;
  /** The substring of the logical line shown on this visual row. */
  text: string;
}

interface Segment {
  start: number;
  text: string;
}

/**
 * Wrap a single logical line into segments that each fit within `width`.
 * Width of 0 or less (or text already short enough) returns a single segment.
 */
export const wrapLine = (text: string, width: number): Segment[] => {
  const safeWidth = Number.isFinite(width) ? Math.floor(width) : 0;
  const graphemes = splitGraphemes(text);
  if (safeWidth <= 0 || graphemes.length <= safeWidth) {
    return [{ start: 0, text }];
  }
  const result: Segment[] = [];
  let pos = 0;
  while (pos < graphemes.length) {
    if (graphemes.length - pos <= safeWidth) {
      result.push({ start: pos, text: graphemes.slice(pos).join("") });
      break;
    }
    // Look for a wrap point within [pos, pos + safeWidth]. Prefer the last
    // whitespace so the break falls at a word boundary; if none fits, hard
    // wrap at `safeWidth` exactly.
    const candidate = graphemes.slice(pos, pos + safeWidth);
    let breakAt = -1;
    for (let i = candidate.length - 1; i >= 0; i--) {
      if (/\s/.test(candidate[i] ?? "")) {
        breakAt = i;
        break;
      }
    }
    if (breakAt > 0) {
      // Include the whitespace with this segment so the next visual line
      // starts on a non-space.
      const segLen = breakAt + 1;
      result.push({ start: pos, text: graphemes.slice(pos, pos + segLen).join("") });
      pos += segLen;
    } else {
      // No whitespace in the window (a single long word, or whitespace only
      // at column 0). Hard wrap at safeWidth.
      result.push({ start: pos, text: graphemes.slice(pos, pos + safeWidth).join("") });
      pos += safeWidth;
    }
  }
  if (result.length === 0) {
    result.push({ start: 0, text: "" });
  }
  return result;
};

/**
 * Flatten an array of logical lines into the visual-row sequence the
 * TextArea will render at the given width. Width of 0 disables wrapping —
 * the function still returns one VisualLine per logical line for a unified
 * downstream code path.
 */
export const computeVisualLines = (
  logicalLines: string[],
  width: number
): VisualLine[] => {
  const out: VisualLine[] = [];
  if (logicalLines.length === 0) {
    out.push({ logicalLine: 0, start: 0, text: "" });
    return out;
  }
  for (let i = 0; i < logicalLines.length; i++) {
    const segments = wrapLine(logicalLines[i] ?? "", width);
    for (const seg of segments) {
      out.push({ logicalLine: i, start: seg.start, text: seg.text });
    }
  }
  return out;
};

/**
 * Find the visual row index and on-row column that hold the given logical
 * cursor position. When the cursor falls between segments (right after a
 * wrap point), prefers the END of the preceding segment so the cursor
 * visually trails the wrap rather than leading the next line. Falls back
 * to the last visual line of the logical line when something is off.
 */
export const cursorToVisual = (
  visualLines: VisualLine[],
  cursorLine: number,
  cursorCol: number
): { row: number; col: number } => {
  let fallback = -1;
  for (let i = 0; i < visualLines.length; i++) {
    const vl = visualLines[i];
    if (vl.logicalLine !== cursorLine) continue;
    fallback = i;
    const endExclusive = vl.start + graphemeLength(vl.text);
    if (cursorCol >= vl.start && cursorCol < endExclusive) {
      return { row: i, col: cursorCol - vl.start };
    }
    if (cursorCol === endExclusive) {
      // Cursor sits at the end of this visual line. If a next segment exists
      // on the same logical line, we still place the cursor here (end-of-row)
      // rather than column 0 of the next row, matching typical editor feel.
      return { row: i, col: cursorCol - vl.start };
    }
  }
  if (fallback >= 0) {
    return { row: fallback, col: graphemeLength(visualLines[fallback].text) };
  }
  return { row: 0, col: 0 };
};

/**
 * Convert a visual-row position back to (logicalLine, logicalCol). The
 * column is clamped to the visual row's text length so callers can pass an
 * "intended" column without worrying about overflow.
 */
export const visualToCursor = (
  visualLines: VisualLine[],
  visualRow: number,
  visualCol: number
): { line: number; col: number } => {
  if (visualLines.length === 0) return { line: 0, col: 0 };
  const clampedRow = Math.max(0, Math.min(visualLines.length - 1, visualRow));
  const vl = visualLines[clampedRow];
  const col = Math.min(Math.max(0, visualCol), graphemeLength(vl.text));
  return { line: vl.logicalLine, col: vl.start + col };
};
