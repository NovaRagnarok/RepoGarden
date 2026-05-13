import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadMemory, saveMemory, touchMemory } from "../lib/memory";

const withFakeHome = (run: () => void) => {
  const fake = mkdtempSync(join(tmpdir(), "repogarden-home-"));
  const oldHome = process.env.HOME;
  process.env.HOME = fake;
  try {
    run();
  } finally {
    process.env.HOME = oldHome;
    rmSync(fake, { recursive: true, force: true });
  }
};

test("saveMemory + loadMemory roundtrip", () => {
  withFakeHome(() => {
    saveMemory("alpha", { currentBlocker: "fix builds", noteToFutureSelf: "look at CI logs" });
    const loaded = loadMemory("alpha");
    assert.equal(loaded.currentBlocker, "fix builds");
    assert.equal(loaded.noteToFutureSelf, "look at CI logs");
  });
});

test("loadMemory returns empty for unknown ids", () => {
  withFakeHome(() => {
    const loaded = loadMemory("nope");
    assert.deepEqual(loaded, {});
  });
});

test("touchMemory stamps lastVisitedAt", () => {
  withFakeHome(() => {
    const before = new Date().toISOString();
    const next = touchMemory("beta", { currentBlocker: "x" });
    assert.ok(next.lastVisitedAt);
    assert.ok(next.lastVisitedAt! >= before);
    const reloaded = loadMemory("beta");
    assert.equal(reloaded.lastVisitedAt, next.lastVisitedAt);
  });
});

test("saveMemory + loadMemory roundtrip garden placement", () => {
  withFakeHome(() => {
    saveMemory("gamma", { gardenPlacement: { offsetX: 4, offsetY: -2 } });
    const loaded = loadMemory("gamma");
    assert.deepEqual(loaded.gardenPlacement, { offsetX: 4, offsetY: -2 });
  });
});

test("loadMemory ignores malformed garden placement", () => {
  withFakeHome(() => {
    saveMemory("delta", {
      gardenPlacement: { offsetX: Number.POSITIVE_INFINITY, offsetY: 3 }
    });
    const loaded = loadMemory("delta");
    assert.equal(loaded.gardenPlacement, undefined);
  });
});
