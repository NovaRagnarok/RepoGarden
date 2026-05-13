import test from "node:test";
import assert from "node:assert/strict";

import {
  extractClaudeOauth,
  isUsageFeatureDisabled,
  parseClaudeUsageBody,
  parseCodexUsageBody,
} from "../lib/usage";

test("parseClaudeUsageBody converts utilization into remaining", () => {
  const body = {
    five_hour: { utilization: 12, resets_at: "2026-05-11T13:00:00Z" },
    seven_day: { utilization: 47, resets_at: "2026-05-18T12:00:00Z" },
  };
  const { fiveHour, weekly } = parseClaudeUsageBody(body);
  assert.equal(fiveHour?.percent, 88, "12% used ⇒ 88% remaining");
  assert.equal(weekly?.percent, 53);
  assert.ok(fiveHour?.resetsAt instanceof Date);
  assert.ok(weekly?.resetsAt instanceof Date);
});

test("parseClaudeUsageBody falls back to weekly + remaining_percent + epoch seconds", () => {
  // Older Anthropic response shape uses `weekly` and `remaining_percent`,
  // with reset times as unix-epoch seconds rather than ISO strings.
  const body = {
    five_hour: { remaining_percent: 80, reset_at: 1700000000 },
    weekly: { used_percent: 53, resetTime: 1700500000 },
  };
  const { fiveHour, weekly } = parseClaudeUsageBody(body);
  assert.equal(fiveHour?.percent, 80, "remaining_percent passes through");
  assert.equal(weekly?.percent, 47, "53% used ⇒ 47% remaining");
  assert.equal(fiveHour?.resetsAt?.getTime(), 1700000000 * 1000);
  assert.equal(weekly?.resetsAt?.getTime(), 1700500000 * 1000);
});

test("parseClaudeUsageBody returns nulls for missing windows", () => {
  const { fiveHour, weekly } = parseClaudeUsageBody({});
  assert.equal(fiveHour, null);
  assert.equal(weekly, null);
});

test("parseCodexUsageBody converts used_percent to remaining for both windows", () => {
  const body = {
    rate_limits: {
      primary: { used_percent: 18, window_minutes: 300, resets_at: 1700000000 },
      secondary: { used_percent: 49, window_minutes: 10080, resets_at: 1700500000 },
    },
  };
  const { fiveHour, weekly } = parseCodexUsageBody(body);
  assert.equal(fiveHour?.percent, 82, "18% used ⇒ 82% remaining");
  assert.equal(weekly?.percent, 51);
});

test("parseCodexUsageBody passes percent_left through unchanged", () => {
  const body = {
    rate_limits: {
      primary: { percent_left: 73, resets_at: 1700000000 },
      secondary: { remaining_percent: 22, resets_at: 1700500000 },
    },
  };
  const { fiveHour, weekly } = parseCodexUsageBody(body);
  assert.equal(fiveHour?.percent, 73);
  assert.equal(weekly?.percent, 22);
});

test("parseCodexUsageBody disambiguates by window seconds when one slot is empty", () => {
  // Some responses report only one window in `primary`. If its length is >= 6
  // days it should be surfaced as the weekly window, not the 5h.
  const body = {
    rate_limits: {
      primary: {
        used_percent: 42,
        limit_window_seconds: 7 * 24 * 3600,
        resets_at: 1700000000,
      },
    },
  };
  const { fiveHour, weekly } = parseCodexUsageBody(body);
  assert.equal(fiveHour, null);
  assert.equal(weekly?.percent, 58, "42% used ⇒ 58% remaining");
});

test("parseCodexUsageBody clamps percent to [0, 100]", () => {
  const body = {
    rate_limits: {
      primary: { used_percent: 120 },
      secondary: { used_percent: -5 },
    },
  };
  const { fiveHour, weekly } = parseCodexUsageBody(body);
  assert.equal(fiveHour?.percent, 0, "over-100% used ⇒ 0% remaining");
  assert.equal(weekly?.percent, 100);
});

test("extractClaudeOauth handles both nested and flat credential shapes", () => {
  const nested = extractClaudeOauth({
    claudeAiOauth: { accessToken: "tok", refreshToken: "ref" },
  });
  assert.ok(nested);
  assert.equal(nested!.accessToken, "tok");

  const flat = extractClaudeOauth({ accessToken: "tok2", refreshToken: "ref2" });
  assert.ok(flat);
  assert.equal(flat!.accessToken, "tok2");

  const snake = extractClaudeOauth({ access_token: "tok3" });
  assert.ok(snake);

  assert.equal(extractClaudeOauth({ unrelated: 1 }), null);
});

test("isUsageFeatureDisabled recognizes truthy env values", () => {
  const prior = process.env.REPOGARDEN_DISABLE_USAGE;

  process.env.REPOGARDEN_DISABLE_USAGE = "1";
  assert.equal(isUsageFeatureDisabled(), true);

  process.env.REPOGARDEN_DISABLE_USAGE = "true";
  assert.equal(isUsageFeatureDisabled(), true);

  process.env.REPOGARDEN_DISABLE_USAGE = "FALSE";
  assert.equal(isUsageFeatureDisabled(), false);

  if (prior === undefined) {
    delete process.env.REPOGARDEN_DISABLE_USAGE;
  } else {
    process.env.REPOGARDEN_DISABLE_USAGE = prior;
  }
});
