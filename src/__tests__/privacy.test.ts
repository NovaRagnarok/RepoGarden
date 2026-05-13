import test from "node:test";
import assert from "node:assert/strict";

import { fakeName, redact, scrambleName } from "../lib/privacy";

test("fakeName is deterministic for a given id", () => {
  const id = "/home/user/repos/pocket-cron";
  assert.equal(fakeName(id), fakeName(id));
  assert.equal(fakeName(id), fakeName(id));
});

test("fakeName produces 1-3 hyphenated words", () => {
  for (let i = 0; i < 50; i += 1) {
    const name = fakeName(`repo-${i}`);
    const parts = name.split("-");
    assert.ok(parts.length >= 1 && parts.length <= 3, `unexpected word count: ${name}`);
    for (const part of parts) {
      assert.match(part, /^[a-z]+$/, `non-lowercase-alpha part: ${part}`);
    }
  }
});

test("fakeName word-count distribution roughly matches the 20/60/20 target", () => {
  const counts = { 1: 0, 2: 0, 3: 0 };
  const total = 1000;
  for (let i = 0; i < total; i += 1) {
    const name = fakeName(`sample-${i}`);
    const parts = name.split("-").length as 1 | 2 | 3;
    counts[parts] += 1;
  }
  // Generous bounds — we're not asserting the exact distribution, just that
  // every bucket gets a reasonable share so a single class never dominates.
  assert.ok(counts[1] > total * 0.1, `1-word bucket too small: ${counts[1]}`);
  assert.ok(counts[2] > total * 0.4, `2-word bucket too small: ${counts[2]}`);
  assert.ok(counts[3] > total * 0.1, `3-word bucket too small: ${counts[3]}`);
});

test("fakeName produces diverse aliases across distinct ids", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 100; i += 1) {
    seen.add(fakeName(`distinct-${i}`));
  }
  // 100 ids, 250+ adj * 130+ nouns = thousands of possibilities — at least
  // 80% should be unique. This catches a stuck PRNG or a degenerate wordlist.
  assert.ok(seen.size >= 80, `expected ≥80 unique names from 100 ids, got ${seen.size}`);
});

test("redact(subject) returns a same-length block", () => {
  assert.equal(redact("fix the thing", "subject"), "▓".repeat(13));
  assert.equal(redact("", "subject"), "");
});

test("redact(branch) and redact(author) preserve length", () => {
  assert.equal(redact("feature/secret-thing", "branch"), "▓".repeat(20));
  assert.equal(redact("Jane Doe", "author"), "▓".repeat(8));
});

test("redact(path) keeps the ~/ prefix when present", () => {
  const masked = redact("~/work/secret-project", "path");
  assert.ok(masked.startsWith("~/"), `expected ~/ prefix, got ${masked}`);
  assert.ok(masked.length >= 4);
});

test("redact(path) on absolute paths returns block text", () => {
  const masked = redact("/home/user/repos/secret", "path");
  assert.match(masked, /^▓+$/);
});

test("redact(note) returns a placeholder regardless of length", () => {
  const short = redact("hi", "note");
  const long = redact("a much longer note with private information in it", "note");
  assert.equal(short, long);
  assert.ok(short.length > 0);
});

test("redact(vibe) returns a per-vibe generic line", () => {
  assert.equal(typeof redact("happy", "vibe"), "string");
  assert.notEqual(redact("happy", "vibe"), "happy");
  assert.notEqual(redact("happy", "vibe"), redact("noisy", "vibe"));
  // Unknown vibe falls back to a generic line.
  assert.ok(redact("unknown", "vibe").length > 0);
});

test("scrambleName output matches target length", () => {
  const targets = ["plum", "plum-thistle", "tiny-mossy-fern", "a"];
  for (const t of targets) {
    for (const progress of [0, 0.25, 0.5, 0.75, 1]) {
      const out = scrambleName(t, progress, 42);
      assert.equal(out.length, t.length, `length mismatch at progress ${progress} for "${t}"`);
    }
  }
});

test("scrambleName at progress=1 returns the target verbatim", () => {
  assert.equal(scrambleName("plum-thistle-mole", 1, 1), "plum-thistle-mole");
  assert.equal(scrambleName("a-b-c", 1, 999), "a-b-c");
});

test("scrambleName preserves hyphens and spaces at every progress level", () => {
  const target = "tiny-mossy-fern";
  for (let p = 0; p <= 1; p += 0.1) {
    const out = scrambleName(target, p, 7);
    for (let i = 0; i < target.length; i += 1) {
      if (target[i] === "-") {
        assert.equal(out[i], "-", `expected '-' at index ${i}, got '${out[i]}' at progress ${p}`);
      }
    }
  }
});

test("scrambleName reveals left-to-right as progress climbs", () => {
  const target = "abcdefgh";
  // At progress 0.5, roughly the first half should be settled.
  const out = scrambleName(target, 0.5, 1);
  // The first char settles when progress >= 1/8 = 0.125, so at 0.5 the first
  // 4 chars (settle thresholds 0.125, 0.25, 0.375, 0.5) are all revealed.
  assert.equal(out.slice(0, 4), "abcd");
});

test("scrambleName varies output across seeds at the same progress", () => {
  const target = "abcdefghij";
  const a = scrambleName(target, 0.1, 1);
  const b = scrambleName(target, 0.1, 2);
  // Both have the same prefix-revealed character (first char settles at 0.1),
  // but the random-char positions should differ at least sometimes.
  assert.notEqual(a, b);
});
