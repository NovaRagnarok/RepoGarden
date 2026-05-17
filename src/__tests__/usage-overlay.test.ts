import test from "node:test";
import assert from "node:assert/strict";

import { __testing__ } from "../screens/UsageOverlay";

const { formatCountdown, formatFetchedAt } = __testing__;

test("formatCountdown rounds future windows into days/hours/minutes", () => {
  const now = Date.UTC(2026, 4, 17, 12, 0, 0);
  const in4d6h = new Date(now + 4 * 86_400_000 + 6 * 3_600_000);
  const in2h14m = new Date(now + 2 * 3_600_000 + 14 * 60_000);
  const in7m = new Date(now + 7 * 60_000);
  assert.equal(formatCountdown(in4d6h, now), "resets in 4d 6h");
  assert.equal(formatCountdown(in2h14m, now), "resets in 2h 14m");
  assert.equal(formatCountdown(in7m, now), "resets in 7m");
});

test("formatCountdown returns 'resets now' for past reset times and '—' for null", () => {
  const now = Date.UTC(2026, 4, 17, 12, 0, 0);
  assert.equal(formatCountdown(null, now), "—");
  assert.equal(formatCountdown(new Date(now - 60_000), now), "resets now");
});

test("formatCountdown floors sub-minute windows to 1m so the overlay never reads 'resets in 0m'", () => {
  const now = Date.UTC(2026, 4, 17, 12, 0, 0);
  const in30s = new Date(now + 30_000);
  assert.equal(formatCountdown(in30s, now), "resets in 1m");
});

test("formatFetchedAt pairs absolute clock time with a relative hint", () => {
  // 14:22 local. Use a local Date so the hh:mm matches the formatter's
  // getHours/getMinutes (which both return local time).
  const at = new Date(2026, 4, 17, 14, 22, 0);
  const twoMinLater = at.getTime() + 2 * 60_000;
  assert.equal(formatFetchedAt(at, twoMinLater), "14:22 (2m ago)");
});

test("formatFetchedAt uses 'just now' for sub-5s deltas", () => {
  const at = new Date(2026, 4, 17, 14, 22, 0);
  assert.equal(formatFetchedAt(at, at.getTime() + 1_000), "14:22 (just now)");
});
