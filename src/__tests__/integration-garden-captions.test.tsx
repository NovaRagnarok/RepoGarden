// Ink-level integration tests for the in-garden focus caption: real
// ReadyShell, fake TTY streams. The caption is painted by the garden
// engine's direct-stdout painter (src/garden/render.ts), NOT by Ink — it
// never appears in lastFrame(), so assertions go through the combined
// output() like the rooms divider-label test.
//
// The harness import MUST stay first so its env guards evaluate before any
// app module.
import { renderScreen, waitFor } from "./helpers/ink-harness";

import test from "node:test";
import assert from "node:assert/strict";

import { buildDemoCreatures } from "../lib/demo-roster";
import { ReadyShell } from "../screens/ReadyShell";
import type { RepoCreature } from "../lib/creature";
import type { Mood } from "../lib/vibe-types";

const WIDE = { columns: 120, rows: 40 };

// Small roster (plenty of canvas slack) with every creature carrying the
// same mood signal — the focused creature is whichever sorts first, so a
// uniform mood keeps the expected caption text deterministic without
// depending on sort order.
const rosterWithMood = (
  mood: Mood,
  confidence: number,
  moodReason: string,
  count = 3
): RepoCreature[] =>
  buildDemoCreatures()
    .slice(0, count)
    .map((creature) => ({
      ...creature,
      vibe: { ...creature.vibe, mood, confidence, moodReason }
    }));

const mountShell = (creatures: RepoCreature[]) =>
  renderScreen(
    <ReadyShell
      creatures={creatures}
      rootsLabel="~/work"
      view="garden"
      onSetView={() => undefined}
      usageBarDisabled
    />,
    WIDE
  );

test("focused creature with a high-confidence mood shows its caption in the garden", async () => {
  // Distinctive reason text that appears nowhere else in the shell chrome.
  // Single creature so no neighbour can force a gap-truncation of the
  // asserted full caption text.
  const harness = mountShell(rosterWithMood("proud", 0.9, "a shelf of finished work", 1));
  try {
    await waitFor(() => harness.lastFrame().includes("REPOGARDEN"), {
      onTimeout: () => harness.lastFrame()
    });
    await waitFor(() => harness.output().includes("proud — a shelf of finished work"), {
      onTimeout: () => harness.output().slice(-2000)
    });
    // Glyph travels with the caption (★ = proud; engine-painted, so it
    // lives in output() rather than lastFrame()).
    assert.ok(harness.output().includes("★"), "proud glyph should paint with the caption");
  } finally {
    harness.unmount();
  }
});

test("content and low-confidence moods paint no caption", async () => {
  for (const roster of [
    rosterWithMood("content", 0.9, "nothing remarkable"),
    rosterWithMood("excited", 0.4, "a burst of commits")
  ]) {
    const harness = mountShell(roster);
    try {
      await waitFor(() => harness.lastFrame().includes("REPOGARDEN"), {
        onTimeout: () => harness.lastFrame()
      });
      // Wait for the garden engine to paint at least one creature name,
      // so "no caption" is asserted against a painted scene rather than
      // an empty canvas.
      const firstName = roster[0].scan.name;
      await waitFor(() => harness.output().includes(firstName), {
        onTimeout: () => harness.output().slice(-2000)
      });
      assert.ok(
        !harness.output().includes("content —"),
        "content is the no-signal mood — no caption"
      );
      assert.ok(
        !harness.output().includes("excited —"),
        "low-confidence moods stay below the caption gate"
      );
    } finally {
      harness.unmount();
    }
  }
});
