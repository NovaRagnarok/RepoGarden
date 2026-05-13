import test from "node:test";
import assert from "node:assert/strict";

import { fakeName, redact } from "../lib/privacy";

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
