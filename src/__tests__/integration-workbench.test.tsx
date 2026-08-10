// Ink-level integration tests for WorkbenchScreen. The harness import MUST
// stay first: WorkbenchScreen persists notes/memory under ~/.repogarden, and
// helpers/test-env.ts (pulled in by the harness) repoints HOME at a temp dir
// before any persistence module loads.
import { renderScreen, waitFor } from "./helpers/ink-harness";

import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { buildDemoCreatures } from "../lib/demo-roster";
import { readEvents } from "../lib/events";
import { loadMemory } from "../lib/memory";
import { createNote, getNotePath, loadNotes, saveNoteBody, setActive } from "../lib/notes";
import { WorkbenchScreen } from "../screens/WorkbenchScreen";
import { TEST_HOME } from "./helpers/test-env";

const CREATURE = buildDemoCreatures()[0];
const BEHIND_CREATURE = {
  ...CREATURE,
  scan: {
    ...CREATURE.scan,
    isDirty: false,
    ahead: 0,
    behind: 2,
  },
};

// 100×30 is exactly the "rich" tier floor — full (non-compact) workbench.
const SIZE = { columns: 100, rows: 30 };

const creatureForPersistenceTest = (id: string) => ({
  ...CREATURE,
  id,
  scan: {
    ...CREATURE.scan,
    id,
    name: id,
    path: join(TEST_HOME, "repos", id),
  },
});

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

test("Workbench keeps repository updates in the user's external git workflow", async () => {
  const harness = renderScreen(
    <WorkbenchScreen creature={BEHIND_CREATURE} onClose={() => {}} usageBarDisabled />,
    SIZE
  );
  try {
    await waitFor(() => harness.lastFrame().includes("1-6 section"), {
      onTimeout: () => harness.lastFrame()
    });

    harness.press("2");
    await waitFor(() => harness.lastFrame().includes("update from your terminal"), {
      onTimeout: () => harness.lastFrame()
    });
    const frame = harness.lastFrame();
    assert.match(frame, /normal git workflow outside RepoGarden/);
    assert.doesNotMatch(frame, /u pull|press u to pull|fast-forward only/);

    // `u` used to arm an in-workbench pull. It is intentionally inert now:
    // RepoGarden may report behind state, but never updates the repository.
    harness.press("u");
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.doesNotMatch(harness.lastFrame(), /press u again to pull|pulling…/);
  } finally {
    harness.unmount();
  }
});

test("Workbench command palette exposes no repository-mutating pull action", async () => {
  const harness = renderScreen(
    <WorkbenchScreen creature={CREATURE} onClose={() => {}} usageBarDisabled />,
    SIZE
  );
  try {
    await waitFor(() => harness.lastFrame().includes("1-6 section"), {
      onTimeout: () => harness.lastFrame()
    });
    harness.press("2", { ctrl: true });
    await waitFor(() => harness.lastFrame().includes("ctrl+1 portrait"), {
      onTimeout: () => harness.lastFrame()
    });
    harness.press("p", { ctrl: true });
    await waitFor(() => harness.lastFrame().includes(`palette · ${CREATURE.scan.name}`), {
      onTimeout: () => harness.lastFrame()
    });
    assert.doesNotMatch(harness.lastFrame(), /pull from remote/);

    harness.press("escape");
    await waitFor(() => !harness.lastFrame().includes(`palette · ${CREATURE.scan.name}`), {
      onTimeout: () => harness.lastFrame()
    });
    harness.press("1", { ctrl: true });
    await waitFor(() => harness.lastFrame().includes("1-6 section"), {
      onTimeout: () => harness.lastFrame()
    });
  } finally {
    // Keep the session-scoped default deterministic even if an assertion
    // above fails while NOTES or its palette is active.
    harness.press("escape");
    await new Promise((resolve) => setTimeout(resolve, 30));
    harness.press("1", { ctrl: true });
    await new Promise((resolve) => setTimeout(resolve, 30));
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

test("failed explicit saves keep tab, palette, mode, and close transitions retryable", async () => {
  const creature = creatureForPersistenceTest("workbench-body-write-fail");
  const initial = loadNotes(creature.id);
  const created = createNote(creature.id, initial, "retry note");
  const activeId = created.state.index.active;
  const bodyPath = getNotePath(creature.id, activeId);
  rmSync(bodyPath, { force: true });
  mkdirSync(bodyPath, { recursive: true });
  writeFileSync(join(bodyPath, ".keep"), "", "utf8");

  let closed = 0;
  const harness = renderScreen(
    <WorkbenchScreen creature={creature} onClose={() => (closed += 1)} usageBarDisabled />,
    SIZE
  );
  try {
    await waitFor(() => harness.lastFrame().includes("1-6 section"), {
      onTimeout: () => harness.lastFrame(),
    });
    harness.press("2", { ctrl: true });
    await waitFor(() => harness.lastFrame().includes("ctrl+1 portrait"), {
      onTimeout: () => harness.lastFrame(),
    });

    harness.press("x");
    await waitFor(() => harness.lastFrame().includes("│ x"), {
      onTimeout: () => harness.lastFrame(),
    });
    harness.press("s", { ctrl: true });
    await waitFor(() => harness.lastFrame().includes("not saved · local note write failed"), {
      onTimeout: () => harness.lastFrame(),
    });
    assert.match(harness.lastFrame(), /unsaved|not saved/);
    assert.deepEqual(readEvents({ repoId: creature.id }), []);

    const indexPath = join(TEST_HOME, ".repogarden", "projects", creature.id, "notes.json");
    harness.writeInput("\x1b[1;5D");
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(JSON.parse(readFileSync(indexPath, "utf8")).active, activeId);

    harness.press("p", { ctrl: true });
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.doesNotMatch(harness.lastFrame(), /palette ·/);

    harness.press("1", { ctrl: true });
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.match(harness.lastFrame(), /ctrl\+1 portrait/);
    assert.doesNotMatch(harness.lastFrame(), /1-6 section/);

    harness.press("escape");
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(closed, 0);
    assert.match(harness.lastFrame(), /not saved · local note write failed/);
  } finally {
    rmSync(bodyPath, { recursive: true, force: true });
    writeFileSync(bodyPath, "", "utf8");
    harness.press("s", { ctrl: true });
    await new Promise((resolve) => setTimeout(resolve, 40));
    harness.press("1", { ctrl: true });
    await new Promise((resolve) => setTimeout(resolve, 40));
    harness.unmount();
  }
});

test("index-write failure reports partial durability without note or blocker success", async () => {
  const creature = creatureForPersistenceTest("workbench-index-write-fail");
  const initial = loadNotes(creature.id);
  const activeId = initial.index.active;
  const project = join(TEST_HOME, ".repogarden", "projects", creature.id);
  const indexPath = join(project, "notes.json");
  rmSync(indexPath, { force: true });
  mkdirSync(indexPath, { recursive: true });
  writeFileSync(join(indexPath, ".keep"), "", "utf8");

  const harness = renderScreen(
    <WorkbenchScreen creature={creature} onClose={() => {}} usageBarDisabled />,
    SIZE
  );
  try {
    await waitFor(() => harness.lastFrame().includes("1-6 section"), {
      onTimeout: () => harness.lastFrame(),
    });
    harness.press("2", { ctrl: true });
    await waitFor(() => harness.lastFrame().includes("ctrl+1 portrait"), {
      onTimeout: () => harness.lastFrame(),
    });

    harness.press("y");
    await waitFor(() => harness.lastFrame().includes("│ y"), {
      onTimeout: () => harness.lastFrame(),
    });
    harness.press("s", { ctrl: true });
    await waitFor(() => harness.lastFrame().includes("partially saved"), {
      onTimeout: () => harness.lastFrame(),
    });
    assert.match(harness.lastFrame(), /index update failed · ctrl\+s to retry/);
    assert.equal(readFileSync(getNotePath(creature.id, activeId), "utf8"), "y");
    assert.deepEqual(readEvents({ repoId: creature.id }), []);
  } finally {
    rmSync(indexPath, { recursive: true, force: true });
    writeFileSync(indexPath, JSON.stringify(initial.index, null, 2), "utf8");
    harness.press("s", { ctrl: true });
    await new Promise((resolve) => setTimeout(resolve, 40));
    harness.press("1", { ctrl: true });
    await new Promise((resolve) => setTimeout(resolve, 40));
    harness.unmount();
  }
});

test("idle autosave reports a body-write failure and keeps the editor unsaved", async () => {
  const creature = creatureForPersistenceTest("workbench-autosave-fail");
  const initial = loadNotes(creature.id);
  const activeId = initial.index.active;
  const bodyPath = getNotePath(creature.id, activeId);
  rmSync(bodyPath, { force: true });
  mkdirSync(bodyPath, { recursive: true });
  writeFileSync(join(bodyPath, ".keep"), "", "utf8");

  const harness = renderScreen(
    <WorkbenchScreen creature={creature} onClose={() => {}} usageBarDisabled />,
    SIZE
  );
  try {
    await waitFor(() => harness.lastFrame().includes("1-6 section"), {
      onTimeout: () => harness.lastFrame(),
    });
    harness.press("2", { ctrl: true });
    await waitFor(() => harness.lastFrame().includes("ctrl+1 portrait"), {
      onTimeout: () => harness.lastFrame(),
    });
    harness.press("z");

    await waitFor(() => harness.lastFrame().includes("not saved · local note write failed"), {
      timeoutMs: 2_500,
      onTimeout: () => harness.lastFrame(),
    });
    assert.deepEqual(readEvents({ repoId: creature.id }), []);
  } finally {
    rmSync(bodyPath, { recursive: true, force: true });
    writeFileSync(bodyPath, "", "utf8");
    harness.press("s", { ctrl: true });
    await new Promise((resolve) => setTimeout(resolve, 40));
    harness.press("1", { ctrl: true });
    await new Promise((resolve) => setTimeout(resolve, 40));
    harness.unmount();
  }
});

test("blocker success waits for the durable legacy-memory mirror and can be retried", async () => {
  const creature = creatureForPersistenceTest("workbench-blocker-mirror-fail");
  const initial = loadNotes(creature.id);
  createNote(creature.id, initial, "blocker");
  const memoryPath = join(TEST_HOME, ".repogarden", "projects", `${creature.id}.json`);
  mkdirSync(memoryPath, { recursive: true });

  const harness = renderScreen(
    <WorkbenchScreen creature={creature} onClose={() => {}} usageBarDisabled />,
    SIZE
  );
  try {
    await waitFor(() => harness.lastFrame().includes("1-6 section"), {
      onTimeout: () => harness.lastFrame(),
    });
    harness.press("2", { ctrl: true });
    await waitFor(() => harness.lastFrame().includes("ctrl+1 portrait"), {
      onTimeout: () => harness.lastFrame(),
    });
    harness.press("b");
    await waitFor(() => harness.lastFrame().includes("│ b"), {
      onTimeout: () => harness.lastFrame(),
    });
    harness.press("s", { ctrl: true });

    await waitFor(
      () => harness.lastFrame().includes("note saved · blocker status not updated"),
      { onTimeout: () => harness.lastFrame() }
    );
    const beforeRetry = readEvents({ repoId: creature.id });
    assert.equal(beforeRetry.filter((event) => event.kind === "note-edited").length, 1);
    assert.equal(beforeRetry.filter((event) => event.kind === "blocker-added").length, 0);

    rmSync(memoryPath, { recursive: true, force: true });
    harness.press("s", { ctrl: true });
    await waitFor(
      () =>
        readEvents({ repoId: creature.id }).some((event) => event.kind === "blocker-added") &&
        harness.lastFrame().includes("blocker set"),
      { onTimeout: () => harness.lastFrame() }
    );
    assert.match(harness.lastFrame(), /blocker set/);
  } finally {
    rmSync(memoryPath, { recursive: true, force: true });
    harness.press("1", { ctrl: true });
    await new Promise((resolve) => setTimeout(resolve, 40));
    harness.unmount();
  }
});

test("saving a non-blocker note does not retry a failed blocker mirror", async () => {
  const creature = creatureForPersistenceTest("workbench-non-blocker-does-not-retry-mirror");
  const initial = loadNotes(creature.id);
  const scratchId = initial.index.active;
  const created = createNote(creature.id, initial, "blocker");
  const blockerSaved = saveNoteBody(creature.id, created.state, created.id, "still blocked");
  assert.equal(blockerSaved.outcome, "durable");
  setActive(creature.id, blockerSaved.state, scratchId);

  const memoryPath = join(TEST_HOME, ".repogarden", "projects", `${creature.id}.json`);
  mkdirSync(memoryPath, { recursive: true });
  const harness = renderScreen(
    <WorkbenchScreen creature={creature} onClose={() => {}} usageBarDisabled />,
    SIZE
  );
  try {
    await waitFor(
      () => harness.lastFrame().includes("note saved · blocker status not updated"),
      { onTimeout: () => harness.lastFrame() }
    );
    harness.press("2", { ctrl: true });
    await waitFor(() => harness.lastFrame().includes("ctrl+1 portrait"), {
      onTimeout: () => harness.lastFrame(),
    });
    await new Promise((resolve) => setTimeout(resolve, 40));

    rmSync(memoryPath, { recursive: true, force: true });
    harness.press("s", { ctrl: true });
    await new Promise((resolve) => setTimeout(resolve, 160));

    assert.equal(loadMemory(creature.id).currentBlocker, undefined);
    assert.equal(readEvents({ repoId: creature.id }).some((event) => event.kind === "blocker-added"), false);
    assert.doesNotMatch(harness.lastFrame(), /blocker status saved|blocker set · stuck/);
  } finally {
    rmSync(memoryPath, { recursive: true, force: true });
    harness.press("1", { ctrl: true });
    await new Promise((resolve) => setTimeout(resolve, 40));
    harness.unmount();
  }
});
