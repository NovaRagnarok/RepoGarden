import test from "node:test";
import assert from "node:assert/strict";

import {
  clampPosition,
  getSelectedCharCount,
  getSelectedText,
  isBefore,
  isEmptyRange,
  normalizeLineEndings,
  orderRange,
  replaceRange,
} from "../lib/text-selection";

test("isBefore orders by line first, then col", () => {
  assert.equal(isBefore({ line: 0, col: 5 }, { line: 0, col: 10 }), true);
  assert.equal(isBefore({ line: 0, col: 10 }, { line: 0, col: 5 }), false);
  assert.equal(isBefore({ line: 0, col: 100 }, { line: 1, col: 0 }), true);
  assert.equal(isBefore({ line: 0, col: 5 }, { line: 0, col: 5 }), false);
});

test("orderRange returns start-before-end regardless of anchor/cursor order", () => {
  const forward = orderRange({ line: 0, col: 0 }, { line: 1, col: 5 });
  assert.deepEqual(forward, { start: { line: 0, col: 0 }, end: { line: 1, col: 5 } });

  const backward = orderRange({ line: 1, col: 5 }, { line: 0, col: 0 });
  assert.deepEqual(backward, { start: { line: 0, col: 0 }, end: { line: 1, col: 5 } });
});

test("isEmptyRange detects collapsed selections", () => {
  assert.equal(
    isEmptyRange({ start: { line: 0, col: 5 }, end: { line: 0, col: 5 } }),
    true
  );
  assert.equal(
    isEmptyRange({ start: { line: 0, col: 5 }, end: { line: 0, col: 6 } }),
    false
  );
});

test("getSelectedText handles single-line selections", () => {
  const lines = ["hello world"];
  const text = getSelectedText(lines, {
    start: { line: 0, col: 6 },
    end: { line: 0, col: 11 },
  });
  assert.equal(text, "world");
});

test("getSelectedText handles multi-line selections with newlines", () => {
  const lines = ["one two", "three four", "five six"];
  // Select "two\nthree four\nfive"
  const text = getSelectedText(lines, {
    start: { line: 0, col: 4 },
    end: { line: 2, col: 4 },
  });
  assert.equal(text, "two\nthree four\nfive");
});

test("getSelectedText on collapsed range returns empty string", () => {
  const lines = ["hello"];
  assert.equal(
    getSelectedText(lines, { start: { line: 0, col: 3 }, end: { line: 0, col: 3 } }),
    ""
  );
});

test("replaceRange handles single-line single-line replacement", () => {
  const lines = ["hello world"];
  const result = replaceRange(
    lines,
    { start: { line: 0, col: 6 }, end: { line: 0, col: 11 } },
    "there"
  );
  assert.equal(result.value, "hello there");
  assert.equal(result.cursorLine, 0);
  assert.equal(result.cursorCol, 11);
});

test("replaceRange handles single-line replacement that spans multiple lines (inserts newline)", () => {
  const lines = ["hello world"];
  const result = replaceRange(
    lines,
    { start: { line: 0, col: 6 }, end: { line: 0, col: 11 } },
    "big\nworld"
  );
  assert.equal(result.value, "hello big\nworld");
  assert.equal(result.cursorLine, 1);
  assert.equal(result.cursorCol, 5);
});

test("replaceRange handles multi-line deletion (replacement = '')", () => {
  const lines = ["one two", "three four", "five six"];
  const result = replaceRange(
    lines,
    { start: { line: 0, col: 4 }, end: { line: 2, col: 4 } },
    ""
  );
  assert.equal(result.value, "one  six");
  assert.equal(result.cursorLine, 0);
  assert.equal(result.cursorCol, 4);
});

test("replaceRange handles multi-line replacement", () => {
  const lines = ["aaa", "bbb", "ccc"];
  const result = replaceRange(
    lines,
    { start: { line: 0, col: 1 }, end: { line: 2, col: 2 } },
    "X\nY\nZ"
  );
  assert.equal(result.value, "aX\nY\nZc");
  assert.equal(result.cursorLine, 2);
  assert.equal(result.cursorCol, 1);
});

test("replaceRange handles a collapsed range as a pure insert", () => {
  const lines = ["abc"];
  const result = replaceRange(
    lines,
    { start: { line: 0, col: 2 }, end: { line: 0, col: 2 } },
    "Z"
  );
  assert.equal(result.value, "abZc");
  assert.equal(result.cursorLine, 0);
  assert.equal(result.cursorCol, 3);
});


test("normalizeLineEndings converts CRLF and CR to LF", () => {
  assert.equal(normalizeLineEndings("a\r\nb\rc"), "a\nb\nc");
});

test("clampPosition handles negative, overflow, and non-finite coordinates", () => {
  const lines = ["abc", "d"];
  assert.deepEqual(clampPosition(lines, { line: -5, col: -1 }), { line: 0, col: 0 });
  assert.deepEqual(clampPosition(lines, { line: 99, col: 99 }), { line: 1, col: 1 });
  assert.deepEqual(clampPosition(lines, { line: Number.NaN, col: Number.POSITIVE_INFINITY }), { line: 0, col: 0 });
});

test("replaceRange clamps unsafe ranges and normalizes replacement line endings", () => {
  const result = replaceRange(
    ["abc", "def"],
    { start: { line: -1, col: -2 }, end: { line: 99, col: 99 } },
    "x\r\ny"
  );
  assert.equal(result.value, "x\ny");
  assert.deepEqual({ line: result.cursorLine, col: result.cursorCol }, { line: 1, col: 1 });
});

test("getSelectedCharCount matches copied text length", () => {
  const lines = ["one", "two", "three"];
  const range = { start: { line: 0, col: 1 }, end: { line: 2, col: 2 } };
  assert.equal(getSelectedText(lines, range), "ne\ntwo\nth");
  assert.equal(getSelectedCharCount(lines, range), "ne\ntwo\nth".length);
});
