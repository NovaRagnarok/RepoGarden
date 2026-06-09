// Ink-level integration tests for WorkbenchScreen. The harness import MUST
// stay first: WorkbenchScreen persists notes/memory under ~/.repogarden, and
// helpers/test-env.ts (pulled in by the harness) repoints HOME at a temp dir
// before any persistence module loads.
import { renderScreen, waitFor } from "./helpers/ink-harness";

import test from "node:test";
import assert from "node:assert/strict";

import { buildDemoCreatures } from "../lib/demo-roster";
import { WorkbenchScreen } from "../screens/WorkbenchScreen";

const CREATURE = buildDemoCreatures()[0];

// 100×30 is exactly the "rich" tier floor — full (non-compact) workbench.
const SIZE = { columns: 100, rows: 30 };

// NOTE on ordering: WorkbenchScreen remembers the last-used mode in a
// module-level variable (session-scoped, intentionally not persisted), so a
// test that leaves the screen in NOTES mode would make the next mount default
// to NOTES. The mode-toggle test below flips back to PORTRAIT before
// unmounting; keep that invariant if more tests are added here.

test("WorkbenchScreen mounts in PORTRAIT mode with portrait sections", async () => {
  let closed = 0;
  const harness = renderScreen(
    <WorkbenchScreen creature={CREATURE} onClose={() => (closed += 1)} usageBarDisabled />,
    SIZE
  );
  try {
    await waitFor(() => harness.lastFrame().includes(CREATURE.scan.name), {
      onTimeout: () => harness.lastFrame()
    });

    const frame = harness.lastFrame();
    // Header identity block.
    assert.match(frame, new RegExp(`branch ${CREATURE.scan.branch}`));
    assert.ok(frame.includes(`~/work/${CREATURE.scan.name}`), "tildified repo path renders");
    // Mode toggle badges.
    assert.match(frame, /PORTRAIT/);
    assert.match(frame, /NOTES/);
    // Portrait section navigation ("1 overview · 2 actions · …" strip) and
    // the health score badge ("NN% · LABEL").
    assert.match(frame, /1 overview/);
    assert.match(frame, /2 actions/);
    assert.match(frame, /6 commits/);
    assert.match(frame, /\d+% · /);
    // Portrait footer hint (also proves we're in portrait mode, not notes).
    assert.match(frame, /1-6 section/);
    assert.equal(closed, 0);
  } finally {
    harness.unmount();
  }
});

test("Esc closes the workbench via onClose", async () => {
  let closed = 0;
  const harness = renderScreen(
    <WorkbenchScreen creature={CREATURE} onClose={() => (closed += 1)} usageBarDisabled />,
    SIZE
  );
  try {
    await waitFor(() => harness.lastFrame().includes(CREATURE.scan.name), {
      onTimeout: () => harness.lastFrame()
    });

    // A bare ESC byte through Ink's parser: Ink buffers the lone \x1b as a
    // possible escape-sequence prefix and auto-flushes it as an "escape"
    // keypress after its internal 20ms pending-input timer — no follow-up
    // byte needed. (cli-main's 30ms mouse-filter flush is a separate layer
    // the harness bypasses.) waitFor absorbs the flush delay.
    harness.press("escape");
    await waitFor(() => closed === 1, { onTimeout: () => harness.lastFrame() });
    assert.equal(closed, 1);
  } finally {
    harness.unmount();
  }
});

test("ctrl+2 switches PORTRAIT → NOTES and ctrl+1 switches back", async () => {
  const harness = renderScreen(
    <WorkbenchScreen creature={CREATURE} onClose={() => {}} usageBarDisabled />,
    SIZE
  );
  try {
    await waitFor(() => harness.lastFrame().includes("1-6 section"), {
      onTimeout: () => harness.lastFrame()
    });

    // ctrl+digit has no legacy terminal byte — the harness encodes it as the
    // kitty CSI-u sequence (\x1b[50;5u), which Ink parses to
    // input "2" + key.ctrl, matching WorkbenchScreen's ctrl+2 binding.
    harness.press("2", { ctrl: true });
    // Notes-mode footer hint replaces the portrait one.
    await waitFor(() => harness.lastFrame().includes("ctrl+1 portrait"), {
      onTimeout: () => harness.lastFrame()
    });
    const notesFrame = harness.lastFrame();
    // Note count badge ("1 NOTE") next to the toggle, and the default
    // "scratch" note's tab. (The full notes footer hint is truncate-end
    // clipped at 100 columns, so assert on the stable leading part only.)
    assert.match(notesFrame, /1 NOTE/);
    assert.match(notesFrame, /• scratch/);
    assert.doesNotMatch(notesFrame, /1-6 section/);
    // Empty fixture note → the editor placeholder shows.
    assert.match(notesFrame, /start typing\. auto-saves on idle\./);

    // ctrl+1 returns to PORTRAIT (and resets the module-level last-used mode
    // so later-mounted workbenches still default to portrait).
    harness.press("1", { ctrl: true });
    await waitFor(() => harness.lastFrame().includes("1-6 section"), {
      onTimeout: () => harness.lastFrame()
    });
    assert.match(harness.lastFrame(), /2 actions/);
  } finally {
    harness.unmount();
  }
});
