import test from "node:test";
import assert from "node:assert/strict";

import {
  parseFocusChunk,
  subscribeFocus,
  type FocusEventKind
} from "../lib/focus";

const captureFocus = (run: () => void): FocusEventKind[] => {
  const events: FocusEventKind[] = [];
  const unsubscribe = subscribeFocus((kind) => events.push(kind));
  try {
    run();
  } finally {
    unsubscribe();
  }
  return events;
};

test("parseFocusChunk passes plain key data through unchanged", () => {
  const events = captureFocus(() => {
    const out = parseFocusChunk("hello\n");
    assert.equal(out, "hello\n");
  });
  assert.equal(events.length, 0);
});

test("parseFocusChunk strips focus-in and emits the event", () => {
  const events = captureFocus(() => {
    const out = parseFocusChunk("\x1b[I");
    assert.equal(out, "");
  });
  assert.deepEqual(events, ["focus-in"]);
});

test("parseFocusChunk strips focus-out and emits the event", () => {
  const events = captureFocus(() => {
    const out = parseFocusChunk("\x1b[O");
    assert.equal(out, "");
  });
  assert.deepEqual(events, ["focus-out"]);
});

test("parseFocusChunk keeps surrounding key data around focus sequences", () => {
  const events = captureFocus(() => {
    const out = parseFocusChunk("a\x1b[Ib\x1b[Oc");
    assert.equal(out, "abc");
  });
  assert.deepEqual(events, ["focus-in", "focus-out"]);
});

test("parseFocusChunk preserves a lone Esc keypress (no follow-up)", () => {
  // First chunk is just \x1b — could be the start of a focus sequence OR a
  // bare Esc. We hold it pending; the next chunk reveals which.
  const events = captureFocus(() => {
    const a = parseFocusChunk("\x1b");
    assert.equal(a, "");
    // Second chunk shows it was a bare Esc followed by ordinary input.
    const b = parseFocusChunk("xyz");
    assert.equal(b, "\x1bxyz");
  });
  assert.equal(events.length, 0);
});

test("parseFocusChunk passes through other escape sequences (e.g. arrow keys)", () => {
  // Arrow keys are \x1b[A / \x1b[B / \x1b[C / \x1b[D — same prefix as focus
  // events but a different final byte. Must flow through to Ink.
  const events = captureFocus(() => {
    const out = parseFocusChunk("\x1b[A\x1b[B");
    assert.equal(out, "\x1b[A\x1b[B");
  });
  assert.equal(events.length, 0);
});

test("parseFocusChunk buffers a focus sequence split across two chunks", () => {
  const events = captureFocus(() => {
    const a = parseFocusChunk("foo\x1b[");
    assert.equal(a, "foo");
    const b = parseFocusChunk("Ibar");
    assert.equal(b, "bar");
  });
  assert.deepEqual(events, ["focus-in"]);
});

test("parseFocusChunk handles multiple focus events in one chunk", () => {
  const events = captureFocus(() => {
    parseFocusChunk("\x1b[I\x1b[O\x1b[I");
  });
  assert.deepEqual(events, ["focus-in", "focus-out", "focus-in"]);
});
