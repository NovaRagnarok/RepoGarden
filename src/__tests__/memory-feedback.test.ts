import test from "node:test";
import assert from "node:assert/strict";

import {
  buildMemoryEditFeedback,
  classifyMemoryNoteName,
  describeMemoryEditDelta,
} from "../lib/memory-feedback";

test("classifyMemoryNoteName recognizes blocker and future-self notes", () => {
  assert.equal(classifyMemoryNoteName("blocker"), "blocker");
  assert.equal(classifyMemoryNoteName(" Note To Future Self "), "future-self");
  assert.equal(classifyMemoryNoteName("note-to-future-self"), "future-self");
  assert.equal(classifyMemoryNoteName("scratch"), "note");
});

test("describeMemoryEditDelta prefers line and meaningful character deltas", () => {
  assert.deepEqual(describeMemoryEditDelta("one", "one\ntwo"), {
    charDelta: 4,
    lineDelta: 1,
    label: "+1 line",
  });
  assert.deepEqual(describeMemoryEditDelta("short", "short plus a much longer note body"), {
    charDelta: 29,
    lineDelta: 0,
    label: "+29 chars",
  });
  assert.deepEqual(describeMemoryEditDelta("word", "words"), {
    charDelta: 1,
    lineDelta: 0,
    label: "small edit",
  });
});

test("blocker feedback names set, clear, and in-place update states", () => {
  const set = buildMemoryEditFeedback("blocker", "", "CI is red");
  assert.equal(set.status, "blocker set · +1 line · shelf now stuck");
  assert.equal(set.previousTrimmed, "");
  assert.equal(set.nextTrimmed, "CI is red");

  const updated = buildMemoryEditFeedback("blocker", "CI is red", "CI is red\nneeds logs");
  assert.equal(updated.status, "blocker updated · +1 line");

  const cleared = buildMemoryEditFeedback("blocker", "CI is red", "");
  assert.equal(cleared.status, "blocker cleared · -1 line · shelf can leave stuck");
});

test("future-self feedback is distinct from ordinary notes", () => {
  const future = buildMemoryEditFeedback("note to future self", "", "rotate keys Monday");
  assert.equal(future.kind, "future-self");
  assert.equal(future.status, "future-self note set · +1 line");

  const regular = buildMemoryEditFeedback("design sketch", "alpha", "alpha\nbeta");
  assert.equal(regular.kind, "note");
  assert.equal(regular.status, 'note "design sketch" updated · +1 line');
});
