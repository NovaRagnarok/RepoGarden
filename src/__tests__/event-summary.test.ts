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

// ---------------------------------------------------------------------------
// vibe-changed phrasing
// ---------------------------------------------------------------------------

const makeVibe = (from: string, to: string, reason?: string): JournalEvent => ({
  ts: "2026-05-13T12:00:00.000Z",
  repoId: "alpha",
  repoName: "alpha",
  kind: "vibe-changed",
  payload: { from, to, ...(reason !== undefined ? { reason } : {}) },
});

test("vibe stuck → happy reads as back in flow, not happy: clean", () => {
  const summary = eventSummary(makeVibe("stuck", "happy", "clean."));
  assert.equal(summary, "back in flow — clean");
});

test("vibe sleepy → happy still reads as woke up", () => {
  const summary = eventSummary(makeVibe("sleepy", "happy", "last commit 0d ago, clean."));
  assert.equal(summary, "woke up — last commit 0d ago, clean");
});

test("vibe happy → stuck strips the redundant 'blocker:' prefix from the reason", () => {
  const summary = eventSummary(makeVibe("happy", "stuck", "blocker: refactor auth"));
  assert.equal(summary, "hit a blocker — refactor auth");
});

test("vibe happy → awake reads as got busy with the dirty/ahead reason", () => {
  const summary = eventSummary(
    makeVibe("happy", "awake", "uncommitted changes · 2 unpushed commits")
  );
  assert.equal(summary, "got busy — uncommitted changes · 2 unpushed commits");
});

test("vibe awake → happy reads as settled", () => {
  const summary = eventSummary(makeVibe("awake", "happy", "clean."));
  assert.equal(summary, "settled — clean");
});

test("vibe stuck → awake reads as back at it", () => {
  const summary = eventSummary(makeVibe("stuck", "awake", "uncommitted changes"));
  assert.equal(summary, "back at it — uncommitted changes");
});

test("vibe happy → sleepy reads as wound down", () => {
  const summary = eventSummary(makeVibe("happy", "sleepy", "quiet for 14 days."));
  assert.equal(summary, "wound down — quiet for 14 days");
});

test("vibe-changed without a reason omits the dash-separated tail", () => {
  const summary = eventSummary(makeVibe("stuck", "happy"));
  assert.equal(summary, "back in flow");
});

// Pre-rename journal entries used the old vocabulary ("noisy"/"blocked").
// The event-summary normaliser maps them onto the new transition verbs so
// historical entries keep rendering correctly after the rename.
test("vibe-changed with legacy noisy/blocked payloads still renders a transition verb", () => {
  assert.equal(
    eventSummary(makeVibe("blocked", "happy", "clean.")),
    "back in flow — clean"
  );
  assert.equal(
    eventSummary(makeVibe("happy", "noisy", "uncommitted changes")),
    "got busy — uncommitted changes"
  );
});

test("vibe-changed for an unknown transition falls back to a generic verb", () => {
  const summary = eventSummary(makeVibe("happy", "unknown", "something"));
  assert.equal(summary, "became unknown — something");
});

// ---------------------------------------------------------------------------
// mood-changed phrasing
// ---------------------------------------------------------------------------

const makeMood = (from: string, to: string, reason?: string): JournalEvent => ({
  ts: "2026-05-13T12:00:00.000Z",
  repoId: "alpha",
  repoName: "alpha",
  kind: "mood-changed",
  payload: { from, to, ...(reason !== undefined ? { reason } : {}) },
});

test("mood content → excited reads as perked up with reason", () => {
  const summary = eventSummary(makeMood("content", "excited", "12 commits in the last 7 days"));
  assert.equal(summary, "perked up — 12 commits in the last 7 days");
});

test("mood content → anxious reads as got anxious", () => {
  const summary = eventSummary(makeMood("content", "anxious", "3 commits behind remote"));
  assert.equal(summary, "got anxious — 3 commits behind remote");
});

test("mood anxious → content reads as relaxed", () => {
  const summary = eventSummary(makeMood("anxious", "content", "nothing remarkable"));
  assert.equal(summary, "relaxed — nothing remarkable");
});

test("mood-changed without a reason omits the dash-separated tail", () => {
  const summary = eventSummary(makeMood("content", "proud"));
  assert.equal(summary, "stood tall");
});

test("mood-changed for an unmapped transition falls back to feels X", () => {
  const summary = eventSummary(makeMood("excited", "lonely", "quiet for a while"));
  assert.equal(summary, "feels lonely — quiet for a while");
});
