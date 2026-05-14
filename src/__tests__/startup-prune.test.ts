import test from "node:test";
import assert from "node:assert/strict";

import {
  retentionCutoff,
  runStartupPrune,
} from "../lib/startup-prune";
import { DEFAULT_RETENTION_DAYS } from "../lib/events";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

test("retentionCutoff returns now - DEFAULT_RETENTION_DAYS by default", () => {
  const now = new Date("2026-05-14T00:00:00.000Z");
  const cutoff = retentionCutoff(undefined, now);
  assert.equal(
    cutoff.getTime(),
    now.getTime() - DEFAULT_RETENTION_DAYS * MS_PER_DAY
  );
});

test("retentionCutoff honours a custom retention window", () => {
  const now = new Date("2026-05-14T00:00:00.000Z");
  const cutoff = retentionCutoff(7, now);
  assert.equal(cutoff.getTime(), now.getTime() - 7 * MS_PER_DAY);
});

test("runStartupPrune calls the injected pruner with a 90-day cutoff", () => {
  const now = new Date("2026-05-14T00:00:00.000Z");
  const calls: Array<{ olderThan: Date }> = [];
  runStartupPrune({
    now,
    prune: (opts) => {
      calls.push(opts);
      return { pruned: 0, kept: 0 };
    },
  });
  assert.equal(calls.length, 1);
  const expected = now.getTime() - DEFAULT_RETENTION_DAYS * MS_PER_DAY;
  assert.equal(calls[0].olderThan.getTime(), expected);
});

test("runStartupPrune swallows pruner errors so boot never crashes", () => {
  assert.doesNotThrow(() => {
    runStartupPrune({
      prune: () => {
        throw new Error("disk on fire");
      },
    });
  });
});

test("runStartupPrune stays silent on the happy path", () => {
  // No throw, no console noise. We can't easily assert on console output
  // without monkey-patching, so settle for "didn't throw + returned void".
  const previous = process.env.REPOGARDEN_DEBUG;
  delete process.env.REPOGARDEN_DEBUG;
  try {
    const result = runStartupPrune({
      prune: () => ({ pruned: 5, kept: 100 }),
    });
    assert.equal(result, undefined);
  } finally {
    if (previous === undefined) {
      delete process.env.REPOGARDEN_DEBUG;
    } else {
      process.env.REPOGARDEN_DEBUG = previous;
    }
  }
});
