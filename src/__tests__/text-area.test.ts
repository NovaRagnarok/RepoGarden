import test from "node:test";
import assert from "node:assert/strict";

import { applyBackspace, applyForwardDelete } from "../lib/editor-buffer";

/**
 * State-space tests for the TextArea backspace / delete keysteps.
 *
 * Regression target: #16 — "Backspace stops working in NOTES editor".
 *
 * The freeze surfaces when (cursorLine, cursorCol) is momentarily out of
 * sync with the new buffer length after a selection-delete, paste, or
 * external setEditor() — the editor's previous early-return guard
 * synced the cursor and dropped the keystroke, so the user had to press
 * Backspace a second time to actually delete. The pure helper here is
 * the contract the TextArea now routes through: every keystep is
 * applied at the clamped cursor, so a stale cursor cannot eat the edit.
 */

test("applyBackspace at mid-line deletes the previous character", () => {
  const result = applyBackspace("hello", { line: 0, col: 3 }, null);
  assert.equal(result.changed, true);
  assert.equal(result.value, "helo");
  assert.deepEqual(
    { line: result.cursorLine, col: result.cursorCol },
    { line: 0, col: 2 }
  );
});

test("applyBackspace at column 0 of a non-first line joins with the previous line", () => {
  const result = applyBackspace("one\ntwo", { line: 1, col: 0 }, null);
  assert.equal(result.changed, true);
  assert.equal(result.value, "onetwo");
  assert.deepEqual(
    { line: result.cursorLine, col: result.cursorCol },
    { line: 0, col: 3 }
  );
});

test("applyBackspace at the very start of the buffer is a no-op", () => {
  const result = applyBackspace("hello", { line: 0, col: 0 }, null);
  assert.equal(result.changed, false);
  assert.equal(result.value, "hello");
  assert.deepEqual(
    { line: result.cursorLine, col: result.cursorCol },
    { line: 0, col: 0 }
  );
});

test("applyBackspace with an active selection deletes the selection", () => {
  // value = "hello world", select "lo wor" (cols 3..9). Backspace deletes it.
  const result = applyBackspace(
    "hello world",
    { line: 0, col: 9 },
    { line: 0, col: 3 }
  );
  assert.equal(result.changed, true);
  assert.equal(result.value, "helld");
  assert.deepEqual(
    { line: result.cursorLine, col: result.cursorCol },
    { line: 0, col: 3 }
  );
});

test("applyBackspace with a multi-line selection collapses to a single line", () => {
  const result = applyBackspace(
    "alpha\nbeta\ngamma",
    { line: 2, col: 2 },
    { line: 0, col: 3 }
  );
  assert.equal(result.changed, true);
  assert.equal(result.value, "alpmma");
  assert.deepEqual(
    { line: result.cursorLine, col: result.cursorCol },
    { line: 0, col: 3 }
  );
});

test("applyBackspace ignores a collapsed (anchor === cursor) selection", () => {
  // Collapsed range — anchor === cursor — should be treated as "no selection"
  // so backspace falls through to per-char delete, not selection-delete.
  const result = applyBackspace(
    "abc",
    { line: 0, col: 2 },
    { line: 0, col: 2 }
  );
  assert.equal(result.changed, true);
  assert.equal(result.value, "ac");
  assert.deepEqual(
    { line: result.cursorLine, col: result.cursorCol },
    { line: 0, col: 1 }
  );
});

test("regression #16: applyBackspace clamps a cursor stranded past EOL after a buffer shrink", () => {
  // Repro: the buffer just shrunk from "hello\nworld" (line=1, col=5) to
  // "hi" (only one line of length 2), but the React state still holds the
  // pre-shrink cursor. The previous TextArea guard would return early on
  // the very next keystroke, silently dropping the Backspace. The pure
  // helper must instead apply the edit at the clamped position so the
  // user sees a deletion on the first press.
  const result = applyBackspace("hi", { line: 1, col: 5 }, null);
  assert.equal(result.changed, true);
  assert.equal(result.value, "h"); // clamped cursor was (0, 2), deletes "i"
  assert.deepEqual(
    { line: result.cursorLine, col: result.cursorCol },
    { line: 0, col: 1 }
  );
});

test("regression #16: applyBackspace clamps a stale anchor + stale cursor without crashing", () => {
  // Both anchor and cursor point past the new EOL. After clamp they both
  // collapse to the same in-bounds position, so this should fall through
  // to the at-buffer-start no-op rather than producing a phantom delete.
  const result = applyBackspace("", { line: 99, col: 99 }, { line: 50, col: 50 });
  assert.equal(result.changed, false);
  assert.equal(result.value, "");
});

test("regression #16: applyBackspace works on the very first key after a paste-delete", () => {
  // Simulates: user pasted multi-line content (cursor advances to end of
  // paste, line=2, col=4), then deleted everything via a selection-replace
  // that left buffer = "abc". The cursor state hasn't yet caught up. The
  // first Backspace press must still delete a char rather than no-op'ing
  // while it waits for the cursor to be re-clamped on the next render.
  const result = applyBackspace("abc", { line: 2, col: 4 }, null);
  assert.equal(result.changed, true);
  assert.equal(result.value, "ab");
  assert.deepEqual(
    { line: result.cursorLine, col: result.cursorCol },
    { line: 0, col: 2 }
  );
});

test("applyBackspace handles multi-byte unicode (BMP) by removing one UTF-16 code unit", () => {
  // The TextArea operates on JS strings — its "character" unit matches
  // JS string indexing. BMP glyphs (e.g. accented Latin) take one code
  // unit; backspace removes the whole glyph.
  const result = applyBackspace("café", { line: 0, col: 4 }, null);
  assert.equal(result.changed, true);
  assert.equal(result.value, "caf");
});

test("applyBackspace on an empty buffer is always a no-op", () => {
  const result = applyBackspace("", { line: 0, col: 0 }, null);
  assert.equal(result.changed, false);
  assert.equal(result.value, "");
});

test("applyForwardDelete at end of line joins the next line up", () => {
  const result = applyForwardDelete("one\ntwo", { line: 0, col: 3 }, null);
  assert.equal(result.changed, true);
  assert.equal(result.value, "onetwo");
  assert.deepEqual(
    { line: result.cursorLine, col: result.cursorCol },
    { line: 0, col: 3 }
  );
});

test("applyForwardDelete at end of buffer is a no-op", () => {
  const result = applyForwardDelete("abc", { line: 0, col: 3 }, null);
  assert.equal(result.changed, false);
});

test("applyForwardDelete with a selection deletes the selection", () => {
  const result = applyForwardDelete(
    "hello world",
    { line: 0, col: 9 },
    { line: 0, col: 3 }
  );
  assert.equal(result.changed, true);
  assert.equal(result.value, "helld");
});

test("regression #16: applyForwardDelete clamps a stranded cursor the same way", () => {
  const result = applyForwardDelete("hi", { line: 9, col: 9 }, null);
  // Clamped cursor (0, 2) sits at end of "hi", and there's no next line —
  // so this is correctly a no-op rather than a crash or phantom edit.
  assert.equal(result.changed, false);
  assert.equal(result.value, "hi");
});

test("hold-Backspace simulation: ten consecutive presses with a moving stale cursor never freeze", () => {
  // The freeze in #16 looked like: press Backspace → nothing → press again
  // → nothing → ... and only escaping back to the garden recovered. Drive
  // applyBackspace repeatedly with a *moving* stale cursor and confirm
  // every iteration deletes one character until the buffer is empty.
  let value = "abcdefghij";
  // Stale cursor: each iteration pretends React state lags one column
  // behind reality. The helper must still make forward progress.
  let staleLine = 9;
  let staleCol = 99;
  for (let i = 0; i < 10; i++) {
    const result = applyBackspace(value, { line: staleLine, col: staleCol }, null);
    assert.equal(result.changed, true, `iteration ${i}: must mutate`);
    value = result.value;
    // Re-stale the cursor: advance "ahead" of where the helper put it,
    // mimicking React not yet committing the previous step.
    staleLine = result.cursorLine + 3;
    staleCol = result.cursorCol + 3;
  }
  assert.equal(value, "");
});
