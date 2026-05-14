import test from "node:test";
import assert from "node:assert/strict";
import { ACTIVITY_HALF_LIFE_DAYS, computeActivity, inferVibe, vibeGlyph } from "../lib/vibe";
import type { ScannedRepo } from "../lib/scanner";

const baseRepo = (overrides: Partial<ScannedRepo> = {}): ScannedRepo => ({
  id: "test",
  path: "/tmp/test",
  name: "test",
  isDirty: false,
  ...overrides
});

const NOW = new Date("2026-05-09T12:00:00Z");

test("blocker memory beats every other signal", () => {
  const result = inferVibe({
    repo: baseRepo({ isDirty: true, lastCommitAt: NOW.toISOString() }),
    memory: { currentBlocker: "build is red" },
    now: NOW
  });
  assert.equal(result.vibe, "blocked");
  assert.match(result.reason, /build is red/);
});

test("repo idle for >14 days reads as sleepy", () => {
  const old = new Date(NOW.getTime() - 30 * 86_400_000).toISOString();
  const result = inferVibe({ repo: baseRepo({ lastCommitAt: old }), now: NOW });
  assert.equal(result.vibe, "sleepy");
  assert.equal(result.daysSinceCommit, 30);
});

test("dirty working tree reads as noisy when recent", () => {
  const recent = new Date(NOW.getTime() - 2 * 86_400_000).toISOString();
  const result = inferVibe({
    repo: baseRepo({ isDirty: true, lastCommitAt: recent }),
    now: NOW
  });
  assert.equal(result.vibe, "noisy");
  assert.match(result.reason, /uncommitted/);
});

test("unpushed commits also count as noisy", () => {
  const recent = new Date(NOW.getTime() - 1 * 86_400_000).toISOString();
  const result = inferVibe({
    repo: baseRepo({ ahead: 3, lastCommitAt: recent }),
    now: NOW
  });
  assert.equal(result.vibe, "noisy");
  assert.match(result.reason, /3 unpushed/);
});

test("clean recent repo reads as happy", () => {
  const recent = new Date(NOW.getTime() - 1 * 86_400_000).toISOString();
  const result = inferVibe({ repo: baseRepo({ lastCommitAt: recent }), now: NOW });
  assert.equal(result.vibe, "happy");
});

test("vibeGlyph returns a 1-char hint per vibe", () => {
  for (const vibe of ["sleepy", "blocked", "noisy", "happy"] as const) {
    const glyph = vibeGlyph(vibe);
    assert.ok(glyph.length >= 1, `glyph for ${vibe} is empty`);
  }
});

test("empty whitespace blocker does not trigger blocked", () => {
  const recent = new Date(NOW.getTime() - 1 * 86_400_000).toISOString();
  const result = inferVibe({
    repo: baseRepo({ lastCommitAt: recent }),
    memory: { currentBlocker: "   " },
    now: NOW
  });
  assert.notEqual(result.vibe, "blocked");
});

// ---------------------------------------------------------------------------
// activity scalar
// ---------------------------------------------------------------------------

test("computeActivity returns 1 for a fresh commit", () => {
  assert.equal(computeActivity(0), 1);
});

test("computeActivity returns 0.5 at the half-life", () => {
  assert.equal(computeActivity(ACTIVITY_HALF_LIFE_DAYS), 0.5);
});

test("computeActivity decays roughly exponentially", () => {
  const single = computeActivity(ACTIVITY_HALF_LIFE_DAYS);
  const double = computeActivity(ACTIVITY_HALF_LIFE_DAYS * 2);
  // Each half-life cuts activity in half.
  assert.ok(Math.abs(double - single * 0.5) < 1e-9, `expected ${single * 0.5}, got ${double}`);
});

test("computeActivity returns 0 for a never-committed repo", () => {
  assert.equal(computeActivity(undefined), 0);
});

test("computeActivity clamps future-dated commits to 1", () => {
  assert.equal(computeActivity(-5), 1);
});

test("inferVibe surfaces activity alongside the vibe", () => {
  const recent = new Date(NOW.getTime() - 1 * 86_400_000).toISOString();
  const fresh = inferVibe({ repo: baseRepo({ lastCommitAt: recent }), now: NOW });
  assert.ok(fresh.activity > 0.85, `expected high activity, got ${fresh.activity}`);

  const stale = new Date(NOW.getTime() - 30 * 86_400_000).toISOString();
  const old = inferVibe({ repo: baseRepo({ lastCommitAt: stale }), now: NOW });
  assert.ok(old.activity < 0.1, `expected low activity, got ${old.activity}`);
});

test("inferVibe gives a blocked repo activity from its commit recency, not zero", () => {
  // A repo can be both blocked and freshly committed — the activity scalar
  // should reflect the latter so its sprite still bustles a bit.
  const recent = new Date(NOW.getTime() - 1 * 86_400_000).toISOString();
  const result = inferVibe({
    repo: baseRepo({ lastCommitAt: recent }),
    memory: { currentBlocker: "build red" },
    now: NOW
  });
  assert.equal(result.vibe, "blocked");
  assert.ok(result.activity > 0.85, `expected high activity, got ${result.activity}`);
});
