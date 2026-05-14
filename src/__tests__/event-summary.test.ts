import assert from "node:assert/strict";
import test from "node:test";

import { eventSummary } from "../lib/event-summary";
import type { JournalEvent } from "../lib/events";

const makePull = (payload: Record<string, unknown>): JournalEvent => ({
  ts: "2026-05-13T12:00:00.000Z",
  repoId: "alpha",
  repoName: "alpha",
  kind: "pull",
  payload,
});

test("pull success with multiple commits names the count and branch", () => {
  const summary = eventSummary(makePull({ ok: true, commitsPulled: 3, branch: "main" }));
  assert.equal(summary, "pulled 3 commits onto main");
});

test("pull success with a single commit uses singular noun", () => {
  const summary = eventSummary(makePull({ ok: true, commitsPulled: 1, branch: "main" }));
  assert.equal(summary, "pulled 1 commit onto main");
});

test("pull success with no branch in payload still renders cleanly", () => {
  const summary = eventSummary(makePull({ ok: true, commitsPulled: 2 }));
  assert.equal(summary, "pulled 2 commits");
});

test("pull success without a commit count reads as pulled changes", () => {
  const summary = eventSummary(makePull({ ok: true, branch: "main" }));
  assert.equal(summary, "pulled changes onto main");
});

test("pull success with zero commits reads as already up to date", () => {
  const summary = eventSummary(makePull({ ok: true, commitsPulled: 0, branch: "main" }));
  assert.equal(summary, "already up to date with main");
});

test("pull success with zero commits and no branch reads as bare up-to-date", () => {
  const summary = eventSummary(makePull({ ok: true, commitsPulled: 0 }));
  assert.equal(summary, "already up to date");
});

test("pull failure with a summary surfaces the reason", () => {
  const summary = eventSummary(
    makePull({ ok: false, summary: "Not possible to fast-forward, aborting." })
  );
  assert.equal(summary, "pull failed: Not possible to fast-forward, aborting.");
});

test("pull failure without a reason falls back to a short message", () => {
  const summary = eventSummary(makePull({ ok: false }));
  assert.equal(summary, "pull failed");
});

test("pull failure truncates long reasons to keep the line readable", () => {
  const long = "x".repeat(200);
  const summary = eventSummary(makePull({ ok: false, summary: long }));
  assert.ok(summary.startsWith("pull failed: "));
  // body after the prefix is capped (60 chars including the trailing ellipsis).
  assert.ok(summary.length <= "pull failed: ".length + 60);
});
