import test from "node:test";
import assert from "node:assert/strict";

import {
  findTextMatches,
  offsetToPosition,
  pickNextMatch,
  positionToOffset,
} from "../lib/note-search";

test("positionToOffset and offsetToPosition round-trip across lines", () => {
  const value = "one\ntwo\nthree";
  const pos = { line: 2, col: 2 };
  const offset = positionToOffset(value, pos);
  assert.equal(offset, 10);
  assert.deepEqual(offsetToPosition(value, offset), pos);
});

test("findTextMatches is case-insensitive by default and spans lines", () => {
  const matches = findTextMatches("Alpha\nbeta alpha", "ALPHA");
  assert.equal(matches.length, 2);
  assert.deepEqual(matches[0].start, { line: 0, col: 0 });
  assert.deepEqual(matches[1].start, { line: 1, col: 5 });
});

test("findTextMatches discovers overlapping matches", () => {
  const matches = findTextMatches("aaaa", "aa");
  assert.deepEqual(matches.map((match) => match.offset), [0, 1, 2]);
});

test("pickNextMatch wraps in both directions", () => {
  const matches = findTextMatches("one two one", "one");
  assert.equal(pickNextMatch(matches, 4, 1)?.index, 1);
  assert.equal(pickNextMatch(matches, 99, 1)?.index, 0);
  assert.equal(pickNextMatch(matches, 4, -1)?.index, 0);
  assert.equal(pickNextMatch(matches, -1, -1)?.index, 1);
});
