import test from "node:test";
import assert from "node:assert/strict";

import {
  allTextSelection,
  clampPosition,
  indentLines,
  indentationForNextLine,
  normalizeEditorInput,
  outdentLines,
} from "../lib/editor-buffer";

test("normalizeEditorInput converts CRLF and CR to LF", () => {
  assert.equal(normalizeEditorInput("a\r\nb\rc"), "a\nb\nc");
});

test("clampPosition keeps cursor coordinates inside the buffer", () => {
  const lines = ["abc", "d"];
  assert.deepEqual(clampPosition(lines, { line: 10, col: 10 }), { line: 1, col: 1 });
  assert.deepEqual(clampPosition(lines, { line: -5, col: -2 }), { line: 0, col: 0 });
});

test("allTextSelection selects from document start through final character", () => {
  assert.deepEqual(allTextSelection("one\ntwo"), {
    start: { line: 0, col: 0 },
    end: { line: 1, col: 3 },
  });
  assert.equal(allTextSelection(""), null);
});

test("indentLines indents every selected line and preserves selection anchor", () => {
  const result = indentLines(
    "one\ntwo\nthree",
    { line: 1, col: 2 },
    { start: { line: 0, col: 1 }, end: { line: 2, col: 0 } }
  );
  assert.equal(result.value, "  one\n  two\nthree");
  assert.deepEqual({ line: result.cursorLine, col: result.cursorCol }, { line: 1, col: 4 });
  assert.deepEqual(result.anchor, { line: 0, col: 3 });
});

test("outdentLines removes up to two leading spaces or one tab", () => {
  const result = outdentLines(
    "    one\n\ttwo\n three",
    { line: 2, col: 3 },
    { start: { line: 0, col: 0 }, end: { line: 2, col: 6 } }
  );
  assert.equal(result.value, "  one\ntwo\nthree");
  assert.deepEqual({ line: result.cursorLine, col: result.cursorCol }, { line: 2, col: 2 });
});

test("indentationForNextLine preserves indentation and continues common lists", () => {
  assert.equal(indentationForNextLine("    const x = 1"), "    ");
  assert.equal(indentationForNextLine("  - item"), "  - ");
  assert.equal(indentationForNextLine("9. item"), "10. ");
});
