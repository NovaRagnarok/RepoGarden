import test from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readEvents } from "../lib/events";
import { saveMemory } from "../lib/memory";
import {
  createNote,
  deleteNote,
  deriveBlockerFromNotes,
  loadNotes,
  renameNote,
  sanitizeNoteName,
  saveNoteBody,
  setActive,
} from "../lib/notes";
import { inferVibe } from "../lib/vibe";
import { loadMemory } from "../lib/memory";
import { buildCreature } from "../lib/creature";
import type { ScannedRepo } from "../lib/scanner";

const withFakeHome = (run: () => void) => {
  const fake = mkdtempSync(join(tmpdir(), "repogarden-home-notes-"));
  const oldHome = process.env.HOME;
  const oldUserProfile = process.env.USERPROFILE;
  process.env.HOME = fake;
  process.env.USERPROFILE = fake;
  try {
    run();
  } finally {
    process.env.HOME = oldHome;
    process.env.USERPROFILE = oldUserProfile;
    rmSync(fake, { recursive: true, force: true });
  }
};

test("loadNotes seeds a single scratch note on a true empty first run", () => {
  withFakeHome(() => {
    const state = loadNotes("alpha");
    assert.equal(state.index.order.length, 1);
    const only = state.index.notes[state.index.order[0]];
    assert.equal(only.name, "scratch");
    assert.equal(state.index.active, only.id);
    assert.equal(state.bodies[only.id], "");

    const reloaded = loadNotes("alpha");
    assert.deepEqual(reloaded.index, state.index);
    assert.deepEqual(reloaded.bodies, state.bodies);
  });
});

test("loadNotes recovers safe note bodies when the index is missing", () => {
  withFakeHome(() => {
    const project = join(process.env.HOME!, ".repogarden", "projects", "missing-index");
    const notes = join(project, "notes");
    mkdirSync(notes, { recursive: true });
    writeFileSync(join(notes, "zeta.md"), "last", "utf8");
    writeFileSync(join(notes, "alpha.md"), "first\r\nsecond", "utf8");
    writeFileSync(join(notes, "unsafe.name.md"), "ignore me", "utf8");
    mkdirSync(join(notes, "directory.md"));

    const recovered = loadNotes("missing-index");
    assert.deepEqual(recovered.index.order, ["alpha", "zeta"]);
    assert.equal(recovered.index.active, "alpha");
    assert.equal(recovered.index.notes.alpha.name, "alpha");
    assert.equal(recovered.bodies.alpha, "first\nsecond");
    assert.equal(recovered.bodies.zeta, "last");
    assert.equal(recovered.bodies["unsafe.name"], undefined);
    assert.equal(recovered.bodies.directory, undefined);

    const reloaded = loadNotes("missing-index");
    assert.deepEqual(reloaded, recovered);
  });
});

test("loadNotes recovers bodies from malformed index JSON instead of re-seeding", () => {
  withFakeHome(() => {
    const project = join(process.env.HOME!, ".repogarden", "projects", "malformed-index");
    const notes = join(project, "notes");
    mkdirSync(notes, { recursive: true });
    writeFileSync(join(notes, "kept.md"), "keep this body", "utf8");
    writeFileSync(join(project, "notes.json"), "{ definitely not json", "utf8");
    saveMemory("malformed-index", { currentBlocker: "legacy fallback" });

    const recovered = loadNotes("malformed-index");
    assert.deepEqual(recovered.index.order, ["kept"]);
    assert.equal(recovered.index.notes.kept.name, "kept");
    assert.equal(recovered.bodies.kept, "keep this body");
    assert.equal(Object.values(recovered.bodies).includes("legacy fallback"), false);

    assert.deepEqual(loadNotes("malformed-index"), recovered);
  });
});

test("loadNotes preserves an unsupported future index while surfacing every safe body", () => {
  withFakeHome(() => {
    const project = join(process.env.HOME!, ".repogarden", "projects", "future-index");
    const notes = join(project, "notes");
    mkdirSync(notes, { recursive: true });
    writeFileSync(join(notes, "second.md"), "two", "utf8");
    writeFileSync(join(notes, "first.md"), "one", "utf8");
    const futureIndexPath = join(project, "notes.json");
    const futureIndex = JSON.stringify(
      {
        version: 999,
        active: "second",
        order: ["second", "first"],
        notes: {
          first: { id: "first", name: "valuable first name", futureColor: "amber" },
          second: { id: "second", name: "valuable second name", futureColor: "blue" },
        },
        futureMetadata: { layout: "manual", unknownButValuable: true },
      },
      null,
      2
    );
    writeFileSync(futureIndexPath, futureIndex, "utf8");

    const recovered = loadNotes("future-index");
    assert.deepEqual(recovered.index.order, ["first", "second"]);
    assert.deepEqual(recovered.bodies, { first: "one", second: "two" });
    assert.equal(readFileSync(futureIndexPath, "utf8"), futureIndex);

    const refused = saveNoteBody("future-index", recovered, "first", "do not downgrade");
    assert.deepEqual(refused, recovered);
    assert.equal(readFileSync(join(notes, "first.md"), "utf8"), "one");
    assert.equal(readFileSync(futureIndexPath, "utf8"), futureIndex);
    assert.deepEqual(loadNotes("future-index"), recovered);
  });
});

test("loadNotes recovers safe bodies when every indexed note is invalid", () => {
  withFakeHome(() => {
    const project = join(process.env.HOME!, ".repogarden", "projects", "invalid-index");
    const notes = join(project, "notes");
    mkdirSync(notes, { recursive: true });
    writeFileSync(join(notes, "safe_id.md"), "safe body", "utf8");
    writeFileSync(join(notes, "unsafe.name.md"), "unsafe body", "utf8");
    writeFileSync(
      join(project, "notes.json"),
      JSON.stringify({
        version: 1,
        active: "../escape",
        order: ["../escape", "bad.id"],
        notes: {
          "../escape": { name: "escape" },
          "bad.id": { name: "bad" },
        },
      }),
      "utf8"
    );

    const recovered = loadNotes("invalid-index");
    assert.deepEqual(recovered.index.order, ["safe_id"]);
    assert.equal(recovered.index.active, "safe_id");
    assert.equal(recovered.bodies.safe_id, "safe body");
    assert.equal(recovered.bodies["unsafe.name"], undefined);
    assert.deepEqual(loadNotes("invalid-index"), recovered);
  });
});

test("loadNotes keeps a valid index authoritative over an unindexed body", () => {
  withFakeHome(() => {
    const initial = loadNotes("authoritative-index");
    const created = createNote("authoritative-index", initial, "temporary");
    const deleted = deleteNote("authoritative-index", created.state, created.id);
    const orphanPath = join(
      process.env.HOME!,
      ".repogarden",
      "projects",
      "authoritative-index",
      "notes",
      `${created.id}.md`
    );

    // Simulate the index commit succeeding before a body unlink failed.
    writeFileSync(orphanPath, "must stay deleted", "utf8");

    const reloaded = loadNotes("authoritative-index");
    assert.deepEqual(reloaded.index.order, deleted.index.order);
    assert.equal(reloaded.index.notes[created.id], undefined);
    assert.equal(reloaded.bodies[created.id], undefined);
    assert.equal(readFileSync(orphanPath, "utf8"), "must stay deleted");
  });
});

test("loadNotes surfaces recovered bodies even when index repair cannot be written", () => {
  withFakeHome(() => {
    const project = join(process.env.HOME!, ".repogarden", "projects", "repair-write-fail");
    const notes = join(project, "notes");
    mkdirSync(notes, { recursive: true });
    writeFileSync(join(notes, "kept.md"), "still visible", "utf8");
    // A directory at the index path makes both the read and atomic replacement
    // fail consistently, including when tests run with elevated permissions.
    mkdirSync(join(project, "notes.json"));

    const recovered = loadNotes("repair-write-fail");
    assert.deepEqual(recovered.index.order, ["kept"]);
    assert.equal(recovered.bodies.kept, "still visible");

    const retried = loadNotes("repair-write-fail");
    assert.deepEqual(retried, recovered);
  });
});

test("note storage permits relocating the whole projects root", () => {
  withFakeHome(() => {
    const stateRoot = join(process.env.HOME!, ".repogarden");
    const relocated = join(process.env.HOME!, "relocated-projects");
    mkdirSync(stateRoot, { recursive: true });
    mkdirSync(relocated);
    symlinkSync(
      relocated,
      join(stateRoot, "projects"),
      process.platform === "win32" ? "junction" : "dir"
    );

    const initial = loadNotes("relocated-root");
    const id = initial.index.active;
    const saved = saveNoteBody("relocated-root", initial, id, "inside relocated state");

    assert.equal(saved.bodies[id], "inside relocated state");
    assert.equal(
      readFileSync(join(relocated, "relocated-root", "notes", `${id}.md`), "utf8"),
      "inside relocated state"
    );
    assert.deepEqual(loadNotes("relocated-root"), saved);
  });
});

test("loadNotes rejects a symlinked notes directory without reading or writing its target", () => {
  withFakeHome(() => {
    const project = join(process.env.HOME!, ".repogarden", "projects", "linked-notes");
    const external = join(process.env.HOME!, "external-note-store");
    mkdirSync(project, { recursive: true });
    mkdirSync(external);
    const externalBody = join(external, "outside.md");
    writeFileSync(externalBody, "external sentinel", "utf8");
    symlinkSync(
      external,
      join(project, "notes"),
      process.platform === "win32" ? "junction" : "dir"
    );

    const loaded = loadNotes("linked-notes");
    assert.deepEqual(loaded.index.order, ["scratch"]);
    assert.equal(Object.values(loaded.bodies).includes("external sentinel"), false);

    const refused = saveNoteBody(
      "linked-notes",
      loaded,
      loaded.index.active,
      "must not escape"
    );
    assert.deepEqual(refused, loaded);
    assert.equal(readFileSync(externalBody, "utf8"), "external sentinel");
    assert.equal(existsSync(join(project, "notes.json")), false);
    assert.deepEqual(loadNotes("linked-notes"), loaded);
  });
});

test("loadNotes rejects a symlinked project directory without touching its target", () => {
  withFakeHome(() => {
    const projects = join(process.env.HOME!, ".repogarden", "projects");
    const externalProject = join(process.env.HOME!, "external-project");
    const externalNotes = join(externalProject, "notes");
    mkdirSync(projects, { recursive: true });
    mkdirSync(externalNotes, { recursive: true });
    const externalBody = join(externalNotes, "outside.md");
    writeFileSync(externalBody, "project sentinel", "utf8");
    symlinkSync(
      externalProject,
      join(projects, "linked-project"),
      process.platform === "win32" ? "junction" : "dir"
    );

    const loaded = loadNotes("linked-project");
    assert.deepEqual(loaded.index.order, ["scratch"]);
    assert.equal(Object.values(loaded.bodies).includes("project sentinel"), false);

    const refused = createNote("linked-project", loaded, "must not escape");
    assert.deepEqual(refused.state, loaded);
    assert.equal(readFileSync(externalBody, "utf8"), "project sentinel");
    assert.equal(existsSync(join(externalProject, "notes.json")), false);
  });
});

test("loadNotes migrates legacy blocker + future-self into named notes", () => {
  withFakeHome(() => {
    saveMemory("beta", {
      currentBlocker: "stuck on auth",
      noteToFutureSelf: "rotate the keys monday",
    });
    const state = loadNotes("beta");
    assert.equal(state.index.order.length, 2);
    const names = state.index.order.map((id) => state.index.notes[id].name);
    assert.deepEqual(names, ["blocker", "note to future self"]);
    const blockerId = state.index.order[0];
    const futureId = state.index.order[1];
    assert.equal(state.bodies[blockerId], "stuck on auth");
    assert.equal(state.bodies[futureId], "rotate the keys monday");
    assert.equal(state.index.active, blockerId);
  });
});

test("loadNotes is idempotent: subsequent calls do not re-migrate", () => {
  withFakeHome(() => {
    saveMemory("gamma", { currentBlocker: "x" });
    const first = loadNotes("gamma");
    assert.equal(first.index.order.length, 1);
    saveMemory("gamma", { currentBlocker: "y" }); // change legacy after first load
    const second = loadNotes("gamma");
    assert.equal(second.index.order.length, 1);
    // The body should still be the original migrated value, not the changed legacy.
    assert.equal(second.bodies[second.index.order[0]], "x");
  });
});

test("saveNoteBody persists and bumps updatedAt", async () => {
  withFakeHome(() => {
    saveMemory("delta", { currentBlocker: "old" });
    const initial = loadNotes("delta");
    const id = initial.index.order[0];
    const originalUpdatedAt = initial.index.notes[id].updatedAt;
    // Spin for a millisecond so the timestamp can advance.
    const start = Date.now();
    while (Date.now() === start) {
      /* spin */
    }
    const next = saveNoteBody("delta", initial, id, "new content");
    assert.equal(next.bodies[id], "new content");
    assert.notEqual(next.index.notes[id].updatedAt, originalUpdatedAt);
    const reloaded = loadNotes("delta");
    assert.equal(reloaded.bodies[id], "new content");
  });
});

test("createNote appends a new note and makes it active", () => {
  withFakeHome(() => {
    const initial = loadNotes("epsilon");
    const { state: after, id } = createNote("epsilon", initial, "design sketch");
    assert.equal(after.index.order.length, 2);
    assert.equal(after.index.notes[id].name, "design sketch");
    assert.equal(after.index.active, id);
    const reloaded = loadNotes("epsilon");
    assert.equal(reloaded.index.order.length, 2);
    assert.equal(reloaded.index.active, id);
  });
});

test("createNote falls back to numbered name when given empty string", () => {
  withFakeHome(() => {
    const initial = loadNotes("zeta");
    const { state: after, id } = createNote("zeta", initial, "   ");
    assert.equal(after.index.notes[id].name, "note 2");
  });
});


test("sanitizeNoteName strips controls, collapses whitespace, and caps length", () => {
  const long = `${"x".repeat(90)}\nignored`;
  const sanitized = sanitizeNoteName(`  sprint\n\tplan  `);
  assert.equal(sanitized, "sprint plan");
  const capped = sanitizeNoteName(long);
  assert.equal(capped.length, 80);
  assert.equal(capped.endsWith("…"), true);
});

test("createNote deduplicates note names case-insensitively", () => {
  withFakeHome(() => {
    const initial = loadNotes("sigma");
    const first = createNote("sigma", initial, "scratch").state;
    const second = createNote("sigma", first, "Scratch").state;
    const names = second.index.order.map((id) => second.index.notes[id].name);
    assert.deepEqual(names, ["scratch", "scratch 2", "Scratch 3"]);
  });
});

test("deleteNote removes file and reassigns active", () => {
  withFakeHome(() => {
    saveMemory("eta", {
      currentBlocker: "a",
      noteToFutureSelf: "b",
    });
    const initial = loadNotes("eta");
    const [firstId, secondId] = initial.index.order;
    const after = deleteNote("eta", initial, firstId);
    assert.equal(after.index.order.length, 1);
    assert.equal(after.index.order[0], secondId);
    assert.equal(after.index.active, secondId);
    assert.equal(after.bodies[firstId], undefined);
    // File on disk gone.
    const path = join(
      process.env.HOME!,
      ".repogarden",
      "projects",
      "eta",
      "notes",
      `${firstId}.md`
    );
    assert.equal(existsSync(path), false);
  });
});

test("deleteNote on the only note auto-creates a fresh scratch", () => {
  withFakeHome(() => {
    const initial = loadNotes("theta");
    const onlyId = initial.index.order[0];
    const after = deleteNote("theta", initial, onlyId);
    assert.equal(after.index.order.length, 1);
    const replacementId = after.index.order[0];
    assert.notEqual(replacementId, onlyId);
    assert.equal(after.index.notes[replacementId].name, "scratch");
    assert.equal(after.bodies[replacementId], "");
  });
});

test("setActive switches the active note and persists", () => {
  withFakeHome(() => {
    saveMemory("iota", { currentBlocker: "a", noteToFutureSelf: "b" });
    const initial = loadNotes("iota");
    const secondId = initial.index.order[1];
    const after = setActive("iota", initial, secondId);
    assert.equal(after.index.active, secondId);
    const reloaded = loadNotes("iota");
    assert.equal(reloaded.index.active, secondId);
  });
});

test("renameNote updates display name without changing id", () => {
  withFakeHome(() => {
    const initial = loadNotes("kappa");
    const id = initial.index.order[0];
    const after = renameNote("kappa", initial, id, "  fresh name  ");
    assert.equal(after.index.notes[id].name, "fresh name");
    assert.equal(after.index.order[0], id);
    const reloaded = loadNotes("kappa");
    assert.equal(reloaded.index.notes[id].name, "fresh name");
  });
});


test("renameNote deduplicates against other notes", () => {
  withFakeHome(() => {
    const initial = loadNotes("tau");
    const scratchId = initial.index.active;
    const { state } = createNote("tau", initial, "design");
    const renamed = renameNote("tau", state, scratchId, "DESIGN");
    assert.equal(renamed.index.notes[scratchId].name, "DESIGN 2");
  });
});

test("deriveBlockerFromNotes returns body of the 'blocker' note", () => {
  withFakeHome(() => {
    saveMemory("mu", { currentBlocker: "auth flow", noteToFutureSelf: "look later" });
    const state = loadNotes("mu");
    assert.equal(deriveBlockerFromNotes(state), "auth flow");
  });
});

test("deriveBlockerFromNotes is case-insensitive and trims the name", () => {
  withFakeHome(() => {
    const initial = loadNotes("nu");
    const { state } = createNote("nu", initial, "  BLOCKER  ");
    const blockerId = state.index.active;
    const written = saveNoteBody("nu", state, blockerId, "the thing");
    assert.equal(deriveBlockerFromNotes(written), "the thing");
  });
});

test("deriveBlockerFromNotes returns undefined when blocker note is empty", () => {
  withFakeHome(() => {
    saveMemory("xi", { currentBlocker: "   " });
    const state = loadNotes("xi");
    assert.equal(deriveBlockerFromNotes(state), undefined);
  });
});

test("deriveBlockerFromNotes returns undefined when no blocker note exists", () => {
  withFakeHome(() => {
    const state = loadNotes("omicron");
    assert.equal(deriveBlockerFromNotes(state), undefined);
  });
});

test("blocker note still drives the 'stuck' vibe via memory mirror", () => {
  withFakeHome(() => {
    // Simulate the workbench's sync effect: load notes, derive, write to memory.
    saveMemory("pi", { currentBlocker: "stuck on migration" });
    const state = loadNotes("pi");
    const derived = deriveBlockerFromNotes(state);
    saveMemory("pi", { ...loadMemory("pi"), currentBlocker: derived });
    const memory = loadMemory("pi");
    const vibe = inferVibe({
      repo: {
        id: "pi",
        name: "pi",
        path: "/tmp/pi",
        isDirty: false,
        ahead: 0,
        lastCommitAt: new Date().toISOString(),
      },
      memory,
    });
    assert.equal(vibe.vibe, "stuck");
    assert.match(vibe.reason, /stuck on migration/);
  });
});

test("emptying the blocker note clears the legacy mirror", () => {
  withFakeHome(() => {
    saveMemory("rho", { currentBlocker: "initial" });
    const initial = loadNotes("rho");
    const blockerId = initial.index.order[0];
    const cleared = saveNoteBody("rho", initial, blockerId, "");
    const derived = deriveBlockerFromNotes(cleared);
    saveMemory("rho", { ...loadMemory("rho"), currentBlocker: derived });
    assert.equal(loadMemory("rho").currentBlocker, undefined);
  });
});

test("loadNotes reconciles when a note file is removed out-of-band", () => {
  withFakeHome(() => {
    saveMemory("lambda", { currentBlocker: "a", noteToFutureSelf: "b" });
    const initial = loadNotes("lambda");
    const firstId = initial.index.order[0];
    rmSync(
      join(process.env.HOME!, ".repogarden", "projects", "lambda", "notes", `${firstId}.md`)
    );
    const reloaded = loadNotes("lambda");
    assert.equal(reloaded.index.order.length, 1);
    assert.equal(reloaded.index.order.includes(firstId), false);
  });
});


test("createNote and renameNote sanitize pasted whitespace in names", () => {
  withFakeHome(() => {
    const initial = loadNotes("upsilon");
    const { state, id } = createNote("upsilon", initial, "  design\n\t sketch  ");
    assert.equal(state.index.notes[id].name, "design sketch");

    const renamed = renameNote("upsilon", state, id, "  renamed\r\nthing  ");
    assert.equal(renamed.index.notes[id].name, "renamed thing");
  });
});

test("saveNoteBody normalizes CRLF and CR bodies to LF", () => {
  withFakeHome(() => {
    const initial = loadNotes("phi");
    const id = initial.index.active;
    const next = saveNoteBody("phi", initial, id, "a\r\nb\rc");
    assert.equal(next.bodies[id], "a\nb\nc");

    const path = join(process.env.HOME!, ".repogarden", "projects", "phi", "notes", `${id}.md`);
    assert.equal(readFileSync(path, "utf8"), "a\nb\nc");
    assert.equal(loadNotes("phi").bodies[id], "a\nb\nc");
  });
});

test("loadNotes ignores unsafe note ids from a hand-edited index", () => {
  withFakeHome(() => {
    const project = join(process.env.HOME!, ".repogarden", "projects", "chi");
    const notesDir = join(project, "notes");
    mkdirSync(notesDir, { recursive: true });
    const stamp = new Date().toISOString();
    writeFileSync(
      join(project, "notes.json"),
      JSON.stringify(
        {
          version: 1,
          active: "../escape",
          order: ["../escape", "safe_id"],
          notes: {
            "../escape": { id: "../escape", name: "bad", createdAt: stamp, updatedAt: stamp },
            safe_id: { id: "safe_id", name: "safe", createdAt: stamp, updatedAt: stamp },
          },
        },
        null,
        2
      ),
      "utf8"
    );
    writeFileSync(join(notesDir, "safe_id.md"), "safe body", "utf8");

    const loaded = loadNotes("chi");
    assert.deepEqual(loaded.index.order, ["safe_id"]);
    assert.equal(loaded.index.active, "safe_id");
    assert.equal(loaded.bodies.safe_id, "safe body");
  });
});

test("saveNoteBody emits note-edited for same-length content edits", () => {
  withFakeHome(() => {
    const initial = loadNotes("psi");
    const id = initial.index.active;
    const first = saveNoteBody("psi", initial, id, "ab", "repo psi");
    saveNoteBody("psi", first, id, "cd", "repo psi");
    const events = readEvents({ repoId: "psi" });
    assert.equal(
      events.some((event) => event.kind === "note-edited" && event.payload.charsDelta === 0),
      true
    );
  });
});

test("saveNoteBody does not advance metadata or emit events when the body write fails", () => {
  withFakeHome(() => {
    const initial = loadNotes("persist-fail-body");
    const id = initial.index.active;
    const persisted = saveNoteBody("persist-fail-body", initial, id, "stable body");
    const previousUpdatedAt = persisted.index.notes[id].updatedAt;
    const project = join(process.env.HOME!, ".repogarden", "projects", "persist-fail-body");
    const bodyPath = join(project, "notes", `${id}.md`);

    // Structural failure: replace the body file with a non-empty directory so
    // atomicWriteFile's final rename(tmp → bodyPath) fails (ENOTEMPTY/EISDIR)
    // regardless of process permissions. The previous chmod-based simulation
    // was a no-op when the test ran as root (e.g., container CI).
    rmSync(bodyPath, { force: true });
    mkdirSync(bodyPath, { recursive: true });
    writeFileSync(join(bodyPath, ".keep"), "");

    const failed = saveNoteBody(
      "persist-fail-body",
      persisted,
      id,
      "lost body",
      "persist fail body repo"
    );

    // Core invariants: index metadata was not advanced, no event leaked out,
    // and the failed body text was not silently adopted into in-memory state.
    assert.equal(failed.index.notes[id].updatedAt, previousUpdatedAt);
    assert.deepEqual(readEvents({ repoId: "persist-fail-body" }), []);
    assert.notEqual(failed.bodies[id], "lost body");
  });
});

test("saveNoteBody keeps the new body but skips metadata when the index write fails", () => {
  withFakeHome(() => {
    const initial = loadNotes("persist-fail-index");
    const id = initial.index.active;
    const previousUpdatedAt = initial.index.notes[id].updatedAt;
    const project = join(process.env.HOME!, ".repogarden", "projects", "persist-fail-index");
    const bodyPath = join(project, "notes", `${id}.md`);
    const notesIndexPath = join(project, "notes.json");

    rmSync(notesIndexPath, { recursive: true, force: true });
    mkdirSync(notesIndexPath, { recursive: true });
    writeFileSync(join(notesIndexPath, ".keep"), "");

    const failed = saveNoteBody(
      "persist-fail-index",
      initial,
      id,
      "durable body",
      "persist fail index repo"
    );

    assert.equal(failed.bodies[id], "durable body");
    assert.equal(failed.index.notes[id].updatedAt, previousUpdatedAt);
    assert.equal(readFileSync(bodyPath, "utf8"), "durable body");
    assert.deepEqual(readEvents({ repoId: "persist-fail-index" }), []);

    rmSync(notesIndexPath, { recursive: true, force: true });
    writeFileSync(
      notesIndexPath,
      JSON.stringify(initial.index, null, 2),
      "utf8"
    );
    const reloaded = loadNotes("persist-fail-index");
    assert.equal(reloaded.bodies[id], "durable body");
    assert.equal(reloaded.index.notes[id].updatedAt, previousUpdatedAt);
  });
});

test("renameNote emits note-renamed when repoName is provided", () => {
  withFakeHome(() => {
    const initial = loadNotes("omega");
    const id = initial.index.active;
    renameNote("omega", initial, id, "journal plan", "omega repo");
    const events = readEvents({ repoId: "omega" });
    assert.equal(events.length, 1);
    assert.equal(events[0].kind, "note-renamed");
    assert.equal(events[0].payload.from, "scratch");
    assert.equal(events[0].payload.to, "journal plan");
  });
});

test("deleteNote emits note-deleted when repoName is provided", () => {
  withFakeHome(() => {
    const initial = loadNotes("omega-delete");
    const id = initial.index.active;
    deleteNote("omega-delete", initial, id, "omega delete repo");
    const events = readEvents({ repoId: "omega-delete" });
    assert.equal(events.length, 1);
    assert.equal(events[0].kind, "note-deleted");
    assert.equal(events[0].payload.name, "scratch");
  });
});

// ---------------------------------------------------------------------------
// Audit #5: blocker → vibe propagation after a workbench edit
// ---------------------------------------------------------------------------

const makeScan = (id: string): ScannedRepo => ({
  id,
  path: `/tmp/${id}`,
  name: id,
  isDirty: false,
  // A recent commit so the baseline vibe is "happy" — confirms the blocker
  // is what flips us to "stuck" and rules out the sleepy fallback.
  lastCommitAt: new Date().toISOString(),
});

test("workbench blocker note flips a creature's vibe to stuck via buildCreature", () => {
  withFakeHome(() => {
    const scan = makeScan("audit5-set");
    // Baseline: no blocker, no memory file → creature reads as happy.
    const before = buildCreature(scan);
    assert.equal(before.vibe.vibe, "happy");

    // Simulate the workbench flow: create a note named "blocker" with a body,
    // then mirror it into ProjectMemory exactly the way WorkbenchScreen's sync
    // effect does. cli-main.tsx's handleSaveMemory then calls buildCreature, which
    // re-reads memory from disk — we replay that step here.
    const initial = loadNotes(scan.id);
    const { state: withBlockerNote } = createNote(scan.id, initial, "blocker");
    const blockerId = withBlockerNote.index.active;
    const filled = saveNoteBody(scan.id, withBlockerNote, blockerId, "auth flow", scan.name);
    const derived = deriveBlockerFromNotes(filled);
    saveMemory(scan.id, { ...loadMemory(scan.id), currentBlocker: derived }, scan.name);

    const after = buildCreature(scan);
    assert.equal(after.vibe.vibe, "stuck");
    assert.match(after.vibe.reason, /auth flow/);
  });
});

test("clearing a workbench blocker note flips the vibe back off stuck", () => {
  withFakeHome(() => {
    const scan = makeScan("audit5-clear");
    // Seed a blocker so the creature starts stuck.
    saveMemory(scan.id, { currentBlocker: "needs reproducer" }, scan.name);
    const stuck = buildCreature(scan);
    assert.equal(stuck.vibe.vibe, "stuck");

    // Simulate emptying the blocker note in the workbench: deriveBlockerFromNotes
    // returns undefined for an empty body, and the sync effect writes that back.
    const state = loadNotes(scan.id);
    const blockerId = state.index.order.find(
      (id) => state.index.notes[id].name === "blocker"
    );
    assert.ok(blockerId, "blocker note should exist after migration");
    const emptied = saveNoteBody(scan.id, state, blockerId, "", scan.name);
    const derived = deriveBlockerFromNotes(emptied);
    saveMemory(scan.id, { ...loadMemory(scan.id), currentBlocker: derived }, scan.name);

    const cleared = buildCreature(scan);
    assert.notEqual(cleared.vibe.vibe, "stuck");
    assert.equal(loadMemory(scan.id).currentBlocker, undefined);
  });
});
