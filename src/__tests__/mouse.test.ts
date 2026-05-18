import test from "node:test";
import assert from "node:assert/strict";

import {
  flushPending,
  hasPending,
  parseStdinChunk,
  subscribeMouse,
  type MouseEvent,
} from "../lib/mouse";

const captureEvents = (run: () => void): MouseEvent[] => {
  const events: MouseEvent[] = [];
  const unsubscribe = subscribeMouse((event) => events.push(event));
  try {
    run();
  } finally {
    unsubscribe();
  }
  return events;
};

test("parseStdinChunk passes plain key data through unchanged", () => {
  const events = captureEvents(() => {
    const out = parseStdinChunk("hello\n");
    assert.equal(out, "hello\n");
  });
  assert.equal(events.length, 0);
});

test("parseStdinChunk emits a left-press event for an SGR press sequence", () => {
  const events = captureEvents(() => {
    const out = parseStdinChunk("\x1b[<0;42;7M");
    assert.equal(out, ""); // sequence stripped
  });
  assert.equal(events.length, 1);
  assert.deepEqual(events[0], {
    kind: "press",
    button: "left",
    col: 42,
    row: 7
  });
});

test("parseStdinChunk distinguishes release (m) from press (M)", () => {
  const events = captureEvents(() => {
    parseStdinChunk("\x1b[<0;1;1M\x1b[<0;1;1m");
  });
  assert.equal(events.length, 2);
  assert.equal(events[0].kind, "press");
  assert.equal(events[1].kind, "release");
});

test("parseStdinChunk decodes SGR button-code-3 release as a release event", () => {
  const events = captureEvents(() => {
    parseStdinChunk("\x1b[<3;8;9m");
  });
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, "release");
  assert.equal(events[0].button, "unknown");
});

test("parseStdinChunk decodes wheel events and the wheel direction", () => {
  const events = captureEvents(() => {
    parseStdinChunk("\x1b[<64;5;5M\x1b[<65;5;5M");
  });
  assert.equal(events.length, 2);
  assert.equal(events[0].kind, "wheel");
  assert.equal(events[0].button, "wheel-up");
  assert.equal(events[1].kind, "wheel");
  assert.equal(events[1].button, "wheel-down");
});

test("parseStdinChunk strips multiple sequences and keeps surrounding key data", () => {
  const events = captureEvents(() => {
    const out = parseStdinChunk("a\x1b[<0;1;1Mb\x1b[<2;3;4Mc");
    assert.equal(out, "abc");
  });
  assert.equal(events.length, 2);
  assert.equal(events[0].button, "left");
  assert.equal(events[1].button, "right");
});

test("parseStdinChunk buffers a sequence split across two chunks", () => {
  const events = captureEvents(() => {
    // First chunk ends mid-sequence; nothing should fire yet.
    const a = parseStdinChunk("foo\x1b[<0;10");
    assert.equal(a, "foo");
    // Second chunk completes the sequence.
    const b = parseStdinChunk(";20Mbar");
    assert.equal(b, "bar");
  });
  assert.equal(events.length, 1);
  assert.equal(events[0].col, 10);
  assert.equal(events[0].row, 20);
});

test("parseStdinChunk decodes pure motion (no button) as a move event", () => {
  const events = captureEvents(() => {
    // cb = 32 + 3 = 35 → motion bit set, button bits = 3 (no button held).
    parseStdinChunk("\x1b[<35;10;20M");
  });
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, "move");
  assert.equal(events[0].col, 10);
  assert.equal(events[0].row, 20);
});

test("parseStdinChunk decodes left-button motion as drag, not move", () => {
  const events = captureEvents(() => {
    // cb = 32 + 0 = 32 → motion bit set, button bits = 0 (left held).
    parseStdinChunk("\x1b[<32;10;20M");
  });
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, "drag");
});

test("parseStdinChunk holds a trailing lone escape, then releases on a non-mouse follow-up", () => {
  // A trailing `\x1b` could be the start of an SGR-mouse sequence completed in
  // the next chunk. Forwarding it eagerly is what made mouse clicks register
  // as Esc keystrokes in Ink (issue #17). Hold it; release as soon as the next
  // chunk arrives carrying anything that isn't a partial mouse continuation.
  const events = captureEvents(() => {
    const a = parseStdinChunk("\x1b");
    assert.equal(a, "");
    // Real Esc keypress followed by an unrelated keystroke: both should flow
    // through to Ink in order.
    const b = parseStdinChunk("q");
    assert.equal(b, "\x1bq");
  });
  assert.equal(events.length, 0);
});

test("parseStdinChunk holds partial SGR prefixes across chunk boundaries", () => {
  // Reproduce the issue-#17 leak: an SGR mouse press split at every awkward
  // boundary must (a) emit exactly one mouse event once both chunks are fed
  // and (b) never leak the leading `\x1b` into the keyboard stream as Esc.
  const boundaries: Array<[string, string]> = [
    ["\x1b", "[<0;42;7M"],
    ["\x1b[", "<0;42;7M"],
    ["\x1b[<", "0;42;7M"],
    ["\x1b[<0", ";42;7M"],
    ["\x1b[<0;", "42;7M"],
    ["\x1b[<0;42", ";7M"],
    ["\x1b[<0;42;", "7M"],
    ["\x1b[<0;42;7", "M"]
  ];
  for (const [first, second] of boundaries) {
    const events = captureEvents(() => {
      const a = parseStdinChunk(first);
      // Critically: the first half must NEVER pass the leading `\x1b` through
      // — that's what Ink interprets as Esc.
      assert.equal(a, "", `first chunk leaked for boundary "${first}|${second}"`);
      const b = parseStdinChunk(second);
      assert.equal(b, "", `second chunk leaked for boundary "${first}|${second}"`);
    });
    assert.equal(events.length, 1, `event count for boundary "${first}|${second}"`);
    assert.deepEqual(events[0], {
      kind: "press",
      button: "left",
      col: 42,
      row: 7
    });
  }
});

test("flushPending releases a buffered lone Escape so a paused Esc keypress still reaches Ink", () => {
  // A bare `\x1b` arrives, parser holds it back as a possible SGR-mouse
  // prefix, no follow-up ever comes. cli-main schedules flushPending on a
  // ~30ms timer after each chunk; the held Esc must be released verbatim so
  // screens can close on a single Escape keypress.
  parseStdinChunk("\x1b");
  assert.equal(hasPending(), true);
  assert.equal(flushPending(), "\x1b");
  assert.equal(hasPending(), false);
  // A second flush against an empty buffer is a no-op.
  assert.equal(flushPending(), "");
});
