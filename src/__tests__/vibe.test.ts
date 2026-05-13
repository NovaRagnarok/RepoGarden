import test from "node:test";
import assert from "node:assert/strict";
import { inferVibe, vibeGlyph } from "../lib/vibe";
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
