import test from "node:test";
import assert from "node:assert/strict";

import {
  bootPhaseForScanOutcome,
  countVibeFlips,
  nextGardenDensity,
  parseScanRoots,
  shouldRingVibeBell
} from "../lib/app-shell-state";

test("parseScanRoots accepts comma and newline separated roots", () => {
  assert.deepEqual(parseScanRoots(" ~/code ,\n/tmp/repos\n\n/work "), [
    "~/code",
    "/tmp/repos",
    "/work"
  ]);
});

test("bootPhaseForScanOutcome enters ready only after a successful non-empty scan", () => {
  assert.deepEqual(
    bootPhaseForScanOutcome({ ok: true, count: 2, message: "found 2" }),
    { phase: "ready" }
  );
  assert.deepEqual(
    bootPhaseForScanOutcome({ ok: true, count: 0, message: "none" }),
    { phase: "onboarding", scanStatus: { kind: "error", message: "none" } }
  );
  assert.deepEqual(
    bootPhaseForScanOutcome({ ok: false, count: 0, message: "boom" }),
    { phase: "onboarding", scanStatus: { kind: "error", message: "boom" } }
  );
});

test("nextGardenDensity cycles through every density option", () => {
  assert.equal(nextGardenDensity("cozy"), "comfortable");
  assert.equal(nextGardenDensity("comfortable"), "dense");
  assert.equal(nextGardenDensity("dense"), "cozy");
});

test("vibe bell state counts only existing repo flips and gates side effects", () => {
  const previous = new Map([
    ["a", "happy"],
    ["b", "awake"]
  ]);
  const current = new Map([
    ["a", "sleepy"],
    ["b", "awake"],
    ["c", "happy"]
  ]);

  const flips = countVibeFlips(previous, current);
  assert.equal(flips, 1);
  assert.equal(
    shouldRingVibeBell({
      enabled: true,
      phase: "ready",
      isRescanning: false,
      flips,
      isTTY: true
    }),
    true
  );
  assert.equal(
    shouldRingVibeBell({
      enabled: true,
      phase: "workbench",
      isRescanning: false,
      flips,
      isTTY: true
    }),
    false
  );
  assert.equal(
    shouldRingVibeBell({
      enabled: true,
      phase: "ready",
      isRescanning: true,
      flips,
      isTTY: true
    }),
    false
  );
});
