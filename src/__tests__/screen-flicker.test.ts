import test from "node:test";
import assert from "node:assert/strict";

import { analyzeScreenFlicker, formatScreenFlickerReport } from "../lib/screen-flicker";

test("screen flicker analysis pads lines to terminal width before diffing", () => {
  const report = analyzeScreenFlicker(
    [
      { label: "frame-1", frame: "AB" },
      { label: "frame-2", frame: "A" }
    ],
    { width: 2, height: 1 }
  );

  assert.equal(report.changedTransitionCount, 1);
  assert.equal(report.totalChangedCells, 1);
  assert.deepEqual(report.hotspots, [
    {
      top: 1,
      left: 2,
      bottom: 1,
      right: 2,
      cells: 1,
      hits: 1,
      transitions: 1
    }
  ]);
});

test("screen flicker analysis groups recurring nearby changes into hotspots", () => {
  const report = analyzeScreenFlicker(
    [
      { label: "frame-1", frame: "abcd\nwxyz" },
      { label: "frame-2", frame: "abXd\nwxYz" },
      { label: "frame-3", frame: "abZd\nwxQz" }
    ],
    { width: 4, height: 2 }
  );

  assert.equal(report.changedTransitionCount, 2);
  assert.equal(report.totalChangedCells, 4);
  assert.deepEqual(report.hotspots, [
    {
      top: 1,
      left: 3,
      bottom: 2,
      right: 3,
      cells: 2,
      hits: 4,
      transitions: 2
    }
  ]);
  assert.equal(report.transitions[0].changedCells, 2);
  assert.deepEqual(report.transitions[0].bounds, {
    top: 1,
    left: 3,
    bottom: 2,
    right: 3
  });
});

test("screen flicker formatter reports stable captures explicitly", () => {
  const report = analyzeScreenFlicker(
    [
      { label: "frame-1", frame: "same" },
      { label: "frame-2", frame: "same" }
    ],
    { width: 4, height: 1 }
  );

  assert.match(formatScreenFlickerReport(report), /No changed cells detected/);
});
