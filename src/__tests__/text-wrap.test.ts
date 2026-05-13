import test from "node:test";
import assert from "node:assert/strict";

import {
  computeVisualLines,
  cursorToVisual,
  visualToCursor,
  wrapLine,
} from "../lib/text-wrap";

test("wrapLine returns single segment for short text", () => {
  assert.deepEqual(wrapLine("hello", 80), [{ start: 0, text: "hello" }]);
});

test("wrapLine returns single segment for width <= 0", () => {
  assert.deepEqual(wrapLine("hello world really long line", 0), [
    { start: 0, text: "hello world really long line" },
  ]);
});

test("wrapLine breaks at last whitespace within budget", () => {
  // "the quick brown fox" with width 10:
  //  "the quick "  -> break after space at idx 9, segment len 10
  //  "brown fox"   -> remainder
  const segs = wrapLine("the quick brown fox", 10);
  assert.deepEqual(segs, [
    { start: 0, text: "the quick " },
    { start: 10, text: "brown fox" },
  ]);
});

test("wrapLine hard-wraps when no whitespace within budget", () => {
  // A single 20-char word, width 10 → hard wrap at 10.
  const segs = wrapLine("abcdefghijklmnopqrst", 10);
  assert.deepEqual(segs, [
    { start: 0, text: "abcdefghij" },
    { start: 10, text: "klmnopqrst" },
  ]);
});

test("wrapLine handles empty string", () => {
  assert.deepEqual(wrapLine("", 10), [{ start: 0, text: "" }]);
});

test("wrapLine handles trailing remainder shorter than width", () => {
  // "aaa bbbb cc" width 5: "aaa "(4) + "bbbb " is too long, hard-wrap?
  // Actually "aaa bbbb" with width 5 → "aaa " then "bbbb" (no whitespace in
  // "bbbb" within width 5, so hard wrap doesn't trigger because the
  // remainder fits in width). Final segments: ["aaa ", "bbbb cc"].
  const segs = wrapLine("aaa bbbb cc", 5);
  // First pass: candidate = "aaa b" (width 5). Last space at idx 3 → segment
  // "aaa " (len 4). Remainder "bbbb cc" (7 chars). Doesn't fit in 5;
  // candidate = "bbbb ". Last space at idx 4 → segment "bbbb " (5). Remainder
  // "cc" fits.
  assert.deepEqual(segs, [
    { start: 0, text: "aaa " },
    { start: 4, text: "bbbb " },
    { start: 9, text: "cc" },
  ]);
});

test("computeVisualLines preserves logicalLine origin per segment", () => {
  const vls = computeVisualLines(["short", "this line will wrap into two"], 10);
  // line 0: "short" → 1 segment
  // line 1: "this line will wrap into two" → wraps
  assert.equal(vls[0].logicalLine, 0);
  assert.equal(vls[0].text, "short");
  for (let i = 1; i < vls.length; i++) {
    assert.equal(vls[i].logicalLine, 1, `vls[${i}] should map to logical line 1`);
  }
});

test("computeVisualLines preserves empty lines as their own visual rows", () => {
  const vls = computeVisualLines(["", "x", ""], 10);
  assert.equal(vls.length, 3);
  assert.deepEqual(
    vls.map((v) => [v.logicalLine, v.text]),
    [
      [0, ""],
      [1, "x"],
      [2, ""],
    ]
  );
});

test("computeVisualLines with empty input returns one empty visual row", () => {
  const vls = computeVisualLines([], 10);
  assert.equal(vls.length, 1);
  assert.deepEqual(vls[0], { logicalLine: 0, start: 0, text: "" });
});

test("cursorToVisual maps logical cursor to correct visual row", () => {
  const vls = computeVisualLines(["the quick brown fox"], 10);
  // visual rows: ["the quick ", "brown fox"]
  // cursor at logical col 5 → "the q|uick " → row 0, col 5
  assert.deepEqual(cursorToVisual(vls, 0, 5), { row: 0, col: 5 });
  // cursor at logical col 12 → "brown fox" starts at 10, so col 2 ("br|own")
  assert.deepEqual(cursorToVisual(vls, 0, 12), { row: 1, col: 2 });
  // cursor at end of buffer (logical col 19) → end of second visual row
  assert.deepEqual(cursorToVisual(vls, 0, 19), { row: 1, col: 9 });
});

test("cursorToVisual at exact wrap boundary stays on the preceding row", () => {
  const vls = computeVisualLines(["the quick brown fox"], 10);
  // logical col 10 = start of second visual row. Convention: prefer the END
  // of the preceding row (col 10 in visual line 0 with text len 10).
  const result = cursorToVisual(vls, 0, 10);
  assert.equal(result.row, 0);
  assert.equal(result.col, 10);
});

test("visualToCursor maps back, clamping overflowing column", () => {
  const vls = computeVisualLines(["the quick brown fox"], 10);
  // visual row 1 ("brown fox", len 9), col 100 → clamp to col 9 → logical col 19
  assert.deepEqual(visualToCursor(vls, 1, 100), { line: 0, col: 19 });
  // visual row 0, col 0 → logical (0, 0)
  assert.deepEqual(visualToCursor(vls, 0, 0), { line: 0, col: 0 });
});

test("visualToCursor clamps row out of bounds to last row", () => {
  const vls = computeVisualLines(["one", "two", "three"], 10);
  assert.deepEqual(visualToCursor(vls, 99, 0), { line: 2, col: 0 });
  assert.deepEqual(visualToCursor(vls, -5, 0), { line: 0, col: 0 });
});

test("wrapLine treats fractional and non-finite widths safely", () => {
  assert.deepEqual(wrapLine("abcdef", Number.NaN), [{ start: 0, text: "abcdef" }]);
  assert.deepEqual(wrapLine("abcdef", Number.POSITIVE_INFINITY), [{ start: 0, text: "abcdef" }]);
  assert.deepEqual(wrapLine("abcdef", 2.9), [
    { start: 0, text: "ab" },
    { start: 2, text: "cd" },
    { start: 4, text: "ef" },
  ]);
});
