import assert from "node:assert/strict";
import test from "node:test";

import {
  MIN_NODE_MAJOR,
  checkNodeVersion,
  formatNodeVersionError,
  parseNodeMajor,
} from "../lib/node-version";

test("parseNodeMajor reads standard Node versions", () => {
  assert.equal(parseNodeMajor("v24.12.4"), 24);
  assert.equal(parseNodeMajor("25.0.0"), 25);
  assert.equal(parseNodeMajor("not-a-version"), undefined);
});

test("checkNodeVersion requires Node 24 or newer", () => {
  assert.equal(checkNodeVersion("v23.11.0").ok, false);
  assert.equal(checkNodeVersion(`v${MIN_NODE_MAJOR}.0.0`).ok, true);
  assert.equal(checkNodeVersion("v25.0.0").ok, true);
});

test("formatNodeVersionError is human readable", () => {
  const message = formatNodeVersionError(checkNodeVersion("v23.11.0"));

  assert.match(message, /RepoGarden requires Node 24 or newer/);
  assert.match(message, /You are running Node 23/);
  assert.match(message, /run repogarden again/);
});
