import type { Position, SelectionRange } from "./text-selection";

export interface TextMatch extends SelectionRange {
  /** Flat UTF-16 offset into the full editor value. */
  offset: number;
  /** Flat UTF-16 offset one past the end of the match. */
  endOffset: number;
}

export interface FindTextOptions {
  caseSensitive?: boolean;
}

export const getLineStarts = (value: string): number[] => {
  const starts = [0];
  for (let i = 0; i < value.length; i++) {
    if (value[i] === "\n") starts.push(i + 1);
  }
  return starts;
};

export const positionToOffset = (value: string, position: Position): number => {
  const starts = getLineStarts(value);
  const line = Math.max(0, Math.min(starts.length - 1, position.line));
  const lineStart = starts[line] ?? 0;
  const nextLineStart = starts[line + 1];
  const lineEnd =
    nextLineStart === undefined ? value.length : Math.max(lineStart, nextLineStart - 1);
  return Math.max(lineStart, Math.min(lineEnd, lineStart + Math.max(0, position.col)));
};

export const offsetToPosition = (value: string, offset: number): Position => {
  const starts = getLineStarts(value);
  const clamped = Math.max(0, Math.min(value.length, offset));
  let low = 0;
  let high = starts.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const start = starts[mid] ?? 0;
    const next = starts[mid + 1] ?? Number.POSITIVE_INFINITY;
    if (clamped < start) {
      high = mid - 1;
    } else if (clamped >= next) {
      low = mid + 1;
    } else {
      return { line: mid, col: clamped - start };
    }
  }
  const last = starts.length - 1;
  return { line: last, col: clamped - (starts[last] ?? 0) };
};

export const findTextMatches = (
  value: string,
  query: string,
  options: FindTextOptions = {}
): TextMatch[] => {
  if (!query) return [];
  const haystack = options.caseSensitive ? value : value.toLocaleLowerCase();
  const needle = options.caseSensitive ? query : query.toLocaleLowerCase();
  if (!needle) return [];

  const matches: TextMatch[] = [];
  let from = 0;
  while (from <= haystack.length) {
    const offset = haystack.indexOf(needle, from);
    if (offset === -1) break;
    const endOffset = offset + needle.length;
    matches.push({
      offset,
      endOffset,
      start: offsetToPosition(value, offset),
      end: offsetToPosition(value, endOffset),
    });
    // Advance by at least one char so overlapping matches are discoverable
    // without risking an infinite loop on empty/zero-width queries.
    from = offset + 1;
  }
  return matches;
};

export const pickNextMatch = (
  matches: TextMatch[],
  fromOffset: number,
  direction: 1 | -1 = 1
): { match: TextMatch; index: number } | null => {
  if (matches.length === 0) return null;

  if (direction === 1) {
    const index = matches.findIndex((match) => match.offset >= fromOffset);
    const wrapped = index === -1 ? 0 : index;
    return { match: matches[wrapped], index: wrapped };
  }

  for (let i = matches.length - 1; i >= 0; i--) {
    if (matches[i].offset <= fromOffset) return { match: matches[i], index: i };
  }
  return { match: matches[matches.length - 1], index: matches.length - 1 };
};
