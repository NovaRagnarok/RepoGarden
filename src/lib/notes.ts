import {
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

import { appendEvent } from "./events";
import { loadMemory } from "./memory";

const INDEX_VERSION = 1;
const MAX_NOTE_NAME_LENGTH = 80;
const SAFE_NOTE_ID = /^[A-Za-z0-9_-]+$/;

export interface NoteMeta {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface NoteIndex {
  version: number;
  active: string;
  order: string[];
  notes: Record<string, NoteMeta>;
}

export interface NotesState {
  index: NoteIndex;
  bodies: Record<string, string>;
}

const storageDir = (): string => join(homedir(), ".repogarden");
const projectsDir = (): string => join(storageDir(), "projects");

const projectDir = (id: string): string => {
  if (!id || id === "." || id === ".." || basename(id) !== id) {
    throw new Error(`unsafe creature id: ${id}`);
  }
  const root = resolve(projectsDir());
  const project = resolve(root, id);
  if (dirname(project) !== root) {
    throw new Error(`unsafe creature id: ${id}`);
  }
  return project;
};
const notesDir = (id: string): string => join(projectDir(id), "notes");
const indexPath = (id: string): string => join(projectDir(id), "notes.json");
const isSafeNoteId = (id: string): boolean => SAFE_NOTE_ID.test(id);

const notePath = (creatureId: string, noteId: string): string => {
  if (!isSafeNoteId(noteId)) {
    throw new Error(`unsafe note id: ${noteId}`);
  }
  return join(notesDir(creatureId), `${noteId}.md`);
};

export const getNotePath = (creatureId: string, noteId: string): string =>
  notePath(creatureId, noteId);

export const getNotesDir = (creatureId: string): string => notesDir(creatureId);

type BoundaryResult =
  | { kind: "missing" }
  | { kind: "blocked" }
  | { kind: "ready"; lexical: string; real: string };

const isMissingFsError = (error: unknown): boolean =>
  Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === "ENOENT"
  );

/**
 * The projects root is the trusted relocation boundary. Users may symlink the
 * whole ~/.repogarden or projects root, so resolve that root once; child
 * project and notes directories must still be real direct descendants.
 */
const resolveProjectsBoundary = (create: boolean): BoundaryResult => {
  const lexical = projectsDir();
  if (create) {
    try {
      mkdirSync(lexical, { recursive: true });
    } catch {
      return { kind: "blocked" };
    }
  }

  try {
    const real = realpathSync(lexical);
    if (!lstatSync(real).isDirectory()) return { kind: "blocked" };
    return { kind: "ready", lexical, real };
  } catch (error) {
    return isMissingFsError(error) ? { kind: "missing" } : { kind: "blocked" };
  }
};

const resolveProjectBoundary = (creatureId: string, create: boolean): BoundaryResult => {
  let lexical: string;
  try {
    lexical = projectDir(creatureId);
  } catch {
    return { kind: "blocked" };
  }

  const root = resolveProjectsBoundary(create);
  if (root.kind !== "ready") return root;

  if (create) {
    try {
      mkdirSync(lexical);
    } catch {
      // Existing paths are validated below; every other failure becomes blocked.
    }
  }

  try {
    const stat = lstatSync(lexical);
    if (stat.isSymbolicLink() || !stat.isDirectory()) return { kind: "blocked" };
    const real = realpathSync(lexical);
    if (dirname(real) !== root.real) return { kind: "blocked" };
    return { kind: "ready", lexical, real };
  } catch (error) {
    return isMissingFsError(error) ? { kind: "missing" } : { kind: "blocked" };
  }
};

const resolveNotesBoundary = (creatureId: string, create: boolean): BoundaryResult => {
  const project = resolveProjectBoundary(creatureId, create);
  if (project.kind !== "ready") return project;
  const lexical = join(project.lexical, "notes");

  if (create) {
    try {
      mkdirSync(lexical);
    } catch {
      // Existing paths are validated below; every other failure becomes blocked.
    }
  }

  try {
    const stat = lstatSync(lexical);
    if (stat.isSymbolicLink() || !stat.isDirectory()) return { kind: "blocked" };
    const real = realpathSync(lexical);
    if (dirname(real) !== project.real) return { kind: "blocked" };
    return { kind: "ready", lexical, real };
  } catch (error) {
    return isMissingFsError(error) ? { kind: "missing" } : { kind: "blocked" };
  }
};

const now = (): string => new Date().toISOString();

let idCounter = 0;
const newId = (): string => {
  idCounter = (idCounter + 1) % 1_000_000;
  const random = Math.random().toString(36).slice(2, 8);
  return `n_${Date.now().toString(36)}_${idCounter.toString(36)}_${random}`;
};

const isIsoishString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

/**
 * Normalize user-facing note names before they hit the index. This keeps tabs,
 * the palette, and JSON index diffs readable even when a user pastes newlines
 * or control characters into a name prompt.
 */
export const sanitizeNoteName = (name: string, fallback = "scratch"): string => {
  const normalized = name
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const base = normalized || fallback;
  return base.length > MAX_NOTE_NAME_LENGTH
    ? `${base.slice(0, MAX_NOTE_NAME_LENGTH - 1)}…`
    : base;
};

const normalizeBodyText = (body: string): string =>
  body.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

const namesEqual = (a: string, b: string): boolean =>
  a.trim().toLowerCase() === b.trim().toLowerCase();

const uniqueNoteName = (
  state: NotesState,
  desired: string,
  excludeId?: string
): string => {
  const used = new Set(
    state.index.order
      .filter((id) => id !== excludeId)
      .map((id) => state.index.notes[id]?.name)
      .filter((name): name is string => typeof name === "string")
      .map((name) => name.trim().toLowerCase())
  );

  const clean = sanitizeNoteName(desired);
  if (!used.has(clean.trim().toLowerCase())) return clean;

  for (let suffix = 2; suffix < 1000; suffix++) {
    const suffixText = ` ${suffix}`;
    const room = MAX_NOTE_NAME_LENGTH - suffixText.length;
    const candidate = `${clean.slice(0, Math.max(1, room))}${suffixText}`;
    if (!used.has(candidate.trim().toLowerCase())) return candidate;
  }

  return `${newId().slice(0, 12)}`;
};

const atomicWriteFile = (path: string, contents: string): boolean => {
  const tmp = `${path}.${process.pid}.${Date.now()}.${Math.random()
    .toString(36)
    .slice(2)}.tmp`;
  try {
    writeFileSync(tmp, contents, "utf8");
    renameSync(tmp, path);
    return true;
  } catch {
    try {
      unlinkSync(tmp);
    } catch {
      // tmp may not exist.
    }
    return false;
  }
};

const normalizeMeta = (id: string, raw: unknown): NoteMeta | null => {
  if (!raw || typeof raw !== "object") return null;
  const meta = raw as Partial<NoteMeta>;
  const stamp = now();
  return {
    id,
    name: sanitizeNoteName(typeof meta.name === "string" ? meta.name : id, id),
    createdAt: isIsoishString(meta.createdAt) ? meta.createdAt : stamp,
    updatedAt: isIsoishString(meta.updatedAt) ? meta.updatedAt : stamp,
  };
};

type IndexReadResult =
  | { kind: "missing" }
  | { kind: "blocked" }
  | { kind: "unusable" }
  | { kind: "unsupported" }
  | { kind: "ready"; index: NoteIndex };

const readIndexFromDisk = (creatureId: string): IndexReadResult => {
  const project = resolveProjectBoundary(creatureId, false);
  if (project.kind !== "ready") return project;
  const path = indexPath(creatureId);

  try {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) return { kind: "blocked" };
    if (!stat.isFile()) {
      return stat.isDirectory() ? { kind: "unusable" } : { kind: "blocked" };
    }
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<NoteIndex>;
    if (typeof parsed.version === "number" && parsed.version !== INDEX_VERSION) {
      return { kind: "unsupported" };
    }
    if (parsed.version !== INDEX_VERSION) return { kind: "unusable" };
    if (!parsed.notes || typeof parsed.notes !== "object") return { kind: "unusable" };
    if (!Array.isArray(parsed.order)) return { kind: "unusable" };

    const notes: Record<string, NoteMeta> = {};
    const order: string[] = [];
    const seen = new Set<string>();
    for (const rawId of parsed.order) {
      if (typeof rawId !== "string" || !isSafeNoteId(rawId) || seen.has(rawId)) continue;
      const meta = normalizeMeta(rawId, parsed.notes[rawId]);
      if (!meta) continue;
      seen.add(rawId);
      order.push(rawId);
      notes[rawId] = meta;
    }

    if (order.length === 0) return { kind: "unusable" };
    const active =
      typeof parsed.active === "string" && notes[parsed.active]
        ? parsed.active
        : order[0];

    return {
      kind: "ready",
      index: { version: INDEX_VERSION, active, order, notes },
    };
  } catch (error) {
    return isMissingFsError(error) ? { kind: "missing" } : { kind: "unusable" };
  }
};

const isSafeFileDestination = (path: string, parentReal: string): boolean => {
  try {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink() || !stat.isFile()) return false;
    return dirname(realpathSync(path)) === parentReal;
  } catch (error) {
    return isMissingFsError(error);
  }
};

const writeIndexToDisk = (creatureId: string, index: NoteIndex): boolean => {
  const current = readIndexFromDisk(creatureId);
  if (current.kind === "unsupported" || current.kind === "blocked") return false;
  const project = resolveProjectBoundary(creatureId, true);
  if (project.kind !== "ready") return false;
  const path = indexPath(creatureId);
  if (!isSafeFileDestination(path, project.real)) return false;
  return atomicWriteFile(path, JSON.stringify(index, null, 2));
};

interface BodyFile {
  path: string;
  createdAt: string;
  updatedAt: string;
}

type BodyFileResult =
  | { kind: "missing" }
  | { kind: "blocked" }
  | { kind: "ready"; file: BodyFile };

const stableFileTimestamp = (...dates: Date[]): string => {
  for (const date of dates) {
    if (Number.isFinite(date.getTime())) return date.toISOString();
  }
  return new Date(0).toISOString();
};

const resolveBodyFile = (creatureId: string, noteId: string): BodyFileResult => {
  const boundary = resolveNotesBoundary(creatureId, false);
  if (boundary.kind !== "ready") return boundary;

  let path: string;
  try {
    path = notePath(creatureId, noteId);
  } catch {
    return { kind: "blocked" };
  }

  try {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink() || !stat.isFile()) return { kind: "blocked" };
    if (dirname(realpathSync(path)) !== boundary.real) return { kind: "blocked" };
    return {
      kind: "ready",
      file: {
        path,
        createdAt: stableFileTimestamp(stat.birthtime, stat.ctime, stat.mtime),
        updatedAt: stableFileTimestamp(stat.mtime, stat.ctime, stat.birthtime),
      },
    };
  } catch (error) {
    return isMissingFsError(error) ? { kind: "missing" } : { kind: "blocked" };
  }
};

const readBody = (creatureId: string, noteId: string): string => {
  const resolved = resolveBodyFile(creatureId, noteId);
  if (resolved.kind !== "ready") return "";
  try {
    return normalizeBodyText(readFileSync(resolved.file.path, "utf8"));
  } catch {
    return "";
  }
};

const writeBody = (creatureId: string, noteId: string, body: string): boolean => {
  const boundary = resolveNotesBoundary(creatureId, true);
  if (boundary.kind !== "ready") return false;
  let path: string;
  try {
    path = notePath(creatureId, noteId);
  } catch {
    return false;
  }
  if (!isSafeFileDestination(path, boundary.real)) return false;
  return atomicWriteFile(path, normalizeBodyText(body));
};

const deleteBody = (creatureId: string, noteId: string): void => {
  const resolved = resolveBodyFile(creatureId, noteId);
  if (resolved.kind !== "ready") return;
  try {
    unlinkSync(resolved.file.path);
  } catch {
    // file may not exist; treat as already gone.
  }
};

interface MaterializedNote {
  meta: NoteMeta;
  body: string;
}

const replaceBodyFromDisk = (
  creatureId: string,
  state: NotesState,
  noteId: string
): NotesState => ({
  ...state,
  bodies: {
    ...state.bodies,
    [noteId]: readBody(creatureId, noteId),
  },
});

const buildFreshScratch = (creatureId: string): MaterializedNote => {
  const id = newId();
  const stamp = now();
  const meta: NoteMeta = { id, name: "scratch", createdAt: stamp, updatedAt: stamp };
  writeBody(creatureId, id, "");
  return { meta, body: "" };
};

const buildUnavailableScratch = (): NotesState => {
  const id = "scratch";
  const stamp = new Date(0).toISOString();
  const meta: NoteMeta = { id, name: "scratch", createdAt: stamp, updatedAt: stamp };
  return {
    index: { version: INDEX_VERSION, active: id, order: [id], notes: { [id]: meta } },
    bodies: { [id]: "" },
  };
};

/**
 * Recover note bodies whose index metadata is missing or cannot be trusted.
 * Only regular files with ids accepted by notePath participate: directory
 * entries, symlinks, and names that could escape the notes directory are
 * ignored. ASCII lexical ordering makes the rebuilt active note and tabs
 * stable across reloads and platforms.
 */
const recoverNotesFromBodies = (
  creatureId: string,
  persistIndex: boolean
): NotesState | null => {
  const boundary = resolveNotesBoundary(creatureId, false);
  if (boundary.kind !== "ready") return null;

  let ids: string[];
  try {
    ids = readdirSync(boundary.lexical, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map((entry) => entry.name.slice(0, -3))
      .filter(isSafeNoteId)
      .sort();
  } catch {
    return null;
  }

  if (ids.length === 0) return null;

  const recovered = ids.flatMap((id) => {
    const resolved = resolveBodyFile(creatureId, id);
    return resolved.kind === "ready" ? [{ id, file: resolved.file }] : [];
  });
  if (recovered.length === 0) return null;

  const notes = Object.fromEntries(
    recovered.map(({ id, file }) => [
      id,
      {
        id,
        name: sanitizeNoteName(id, id),
        createdAt: file.createdAt,
        updatedAt: file.updatedAt,
      } satisfies NoteMeta,
    ])
  );
  const order = recovered.map(({ id }) => id);
  const bodies = Object.fromEntries(order.map((id) => [id, readBody(creatureId, id)]));
  const index: NoteIndex = {
    version: INDEX_VERSION,
    active: order[0],
    order,
    notes,
  };

  if (persistIndex) writeIndexToDisk(creatureId, index);
  return { index, bodies };
};

/**
 * Build a notes state for a creature, migrating from legacy ProjectMemory
 * (currentBlocker / noteToFutureSelf) on first access.
 */
export const loadNotes = (creatureId: string): NotesState => {
  const indexRead = readIndexFromDisk(creatureId);
  const notesBoundary = resolveNotesBoundary(creatureId, false);

  // Crafted child symlinks are never a notes store. Return a stable in-memory
  // scratch state without reading legacy data or attempting any disk writes.
  if (indexRead.kind === "blocked" || notesBoundary.kind === "blocked") {
    return buildUnavailableScratch();
  }

  if (indexRead.kind === "unsupported") {
    // A newer app owns this metadata schema. Surface safe bodies without
    // replacing its index; mutators below also refuse while it remains present.
    return recoverNotesFromBodies(creatureId, false) ?? buildUnavailableScratch();
  }

  if (indexRead.kind !== "ready") {
    // A missing index is only a true first run when no safe note bodies exist.
    // Unusable indexes take the same recovery path, so malformed metadata can
    // never replace otherwise readable user content with scratch/legacy seeds.
    const recovered = recoverNotesFromBodies(creatureId, true);
    if (recovered) return recovered;

    const legacy = loadMemory(creatureId);
    const seeded: MaterializedNote[] = [];
    const stamp = now();

    const blocker = legacy.currentBlocker?.trim();
    if (blocker) {
      const id = newId();
      const body = normalizeBodyText(legacy.currentBlocker ?? "");
      writeBody(creatureId, id, body);
      seeded.push({
        meta: { id, name: "blocker", createdAt: stamp, updatedAt: stamp },
        body,
      });
    }

    const future = legacy.noteToFutureSelf?.trim();
    if (future) {
      const id = newId();
      const body = normalizeBodyText(legacy.noteToFutureSelf ?? "");
      writeBody(creatureId, id, body);
      seeded.push({
        meta: { id, name: "note to future self", createdAt: stamp, updatedAt: stamp },
        body,
      });
    }

    if (seeded.length === 0) {
      seeded.push(buildFreshScratch(creatureId));
    }

    const index: NoteIndex = {
      version: INDEX_VERSION,
      active: seeded[0].meta.id,
      order: seeded.map((n) => n.meta.id),
      notes: Object.fromEntries(seeded.map((n) => [n.meta.id, n.meta])),
    };
    writeIndexToDisk(creatureId, index);
    const bodies = Object.fromEntries(seeded.map((n) => [n.meta.id, n.body]));
    return { index, bodies };
  }

  const existing = indexRead.index;

  // Reconcile against disk: a note in the index whose body file is missing
  // has been deleted out-of-band; drop it. If everything is gone, recreate
  // a scratch note so the editor never opens to an empty state.
  const survivingOrder: string[] = [];
  const survivingNotes: Record<string, NoteMeta> = {};
  const bodies: Record<string, string> = {};
  let hasBlockedBody = false;
  for (const id of existing.order) {
    const resolved = resolveBodyFile(creatureId, id);
    if (resolved.kind === "ready") {
      survivingOrder.push(id);
      survivingNotes[id] = existing.notes[id];
      bodies[id] = readBody(creatureId, id);
    } else if (resolved.kind === "blocked") {
      // Preserve valid metadata for an unsafe body entry, but never read it or
      // rewrite the index based on the partial view.
      hasBlockedBody = true;
      survivingOrder.push(id);
      survivingNotes[id] = existing.notes[id];
      bodies[id] = "";
    }
  }

  if (survivingOrder.length === 0) {
    const fresh = buildFreshScratch(creatureId);
    survivingOrder.push(fresh.meta.id);
    survivingNotes[fresh.meta.id] = fresh.meta;
    bodies[fresh.meta.id] = fresh.body;
  }

  const active =
    existing.active && survivingNotes[existing.active] ? existing.active : survivingOrder[0];

  const reconciled: NoteIndex = {
    version: INDEX_VERSION,
    active,
    order: survivingOrder,
    notes: survivingNotes,
  };

  if (
    !hasBlockedBody &&
    (reconciled.order.length !== existing.order.length ||
      reconciled.active !== existing.active ||
      reconciled.order.some((id) => reconciled.notes[id]?.name !== existing.notes[id]?.name))
  ) {
    writeIndexToDisk(creatureId, reconciled);
  }

  return { index: reconciled, bodies };
};

const canMutateNotes = (creatureId: string): boolean => {
  const indexRead = readIndexFromDisk(creatureId);
  if (indexRead.kind === "unsupported" || indexRead.kind === "blocked") return false;
  return resolveNotesBoundary(creatureId, false).kind !== "blocked";
};

export const saveNoteBody = (
  creatureId: string,
  state: NotesState,
  noteId: string,
  body: string,
  repoName = ""
): NotesState => {
  if (!state.index.notes[noteId] || !isSafeNoteId(noteId)) return state;
  if (!canMutateNotes(creatureId)) return state;
  const oldBody = normalizeBodyText(state.bodies[noteId] ?? "");
  const nextBody = normalizeBodyText(body);
  if (!writeBody(creatureId, noteId, nextBody)) {
    return replaceBodyFromDisk(creatureId, state, noteId);
  }
  const stamp = now();
  const nextIndex: NoteIndex = {
    ...state.index,
    notes: {
      ...state.index.notes,
      [noteId]: { ...state.index.notes[noteId], updatedAt: stamp },
    },
  };
  if (!writeIndexToDisk(creatureId, nextIndex)) {
    return {
      ...state,
      bodies: { ...state.bodies, [noteId]: nextBody },
    };
  }

  // Emit note-edited when content actually changed and a repoName is given.
  if (repoName) {
    const charsDelta = nextBody.length - oldBody.length;
    if (nextBody !== oldBody) {
      appendEvent({
        ts: stamp,
        repoId: creatureId,
        repoName,
        kind: "note-edited",
        payload: {
          noteId,
          name: state.index.notes[noteId].name,
          charsDelta,
        },
      });
    }
  }

  return { index: nextIndex, bodies: { ...state.bodies, [noteId]: nextBody } };
};

export const createNote = (
  creatureId: string,
  state: NotesState,
  name: string,
  repoName = ""
): { state: NotesState; id: string } => {
  if (!canMutateNotes(creatureId)) {
    return { state, id: state.index.active };
  }
  const id = newId();
  const stamp = now();
  const fallback = `note ${state.index.order.length + 1}`;
  const trimmed = uniqueNoteName(state, name.trim() ? name : fallback);
  const meta: NoteMeta = { id, name: trimmed, createdAt: stamp, updatedAt: stamp };
  if (!writeBody(creatureId, id, "")) {
    return { state, id: state.index.active };
  }
  const nextIndex: NoteIndex = {
    version: INDEX_VERSION,
    active: id,
    order: [...state.index.order, id],
    notes: { ...state.index.notes, [id]: meta },
  };
  if (!writeIndexToDisk(creatureId, nextIndex)) {
    deleteBody(creatureId, id);
    return { state, id: state.index.active };
  }

  // Emit note-created when a repoName is provided.
  if (repoName) {
    appendEvent({
      ts: stamp,
      repoId: creatureId,
      repoName,
      kind: "note-created",
      payload: { noteId: id, name: trimmed },
    });
  }

  return {
    state: { index: nextIndex, bodies: { ...state.bodies, [id]: "" } },
    id,
  };
};

export const deleteNote = (
  creatureId: string,
  state: NotesState,
  noteId: string,
  repoName = ""
): NotesState => {
  if (!state.index.notes[noteId] || !isSafeNoteId(noteId)) return state;
  if (!canMutateNotes(creatureId)) return state;

  const deletedName = state.index.notes[noteId].name;
  const nextOrder = state.index.order.filter((id) => id !== noteId);
  const nextNotes: Record<string, NoteMeta> = { ...state.index.notes };
  delete nextNotes[noteId];
  const nextBodies: Record<string, string> = { ...state.bodies };
  delete nextBodies[noteId];
  let replacementId: string | null = null;

  // Auto-create a fresh scratch when the user deletes the last note — the
  // editor never has a zero-note state (see notepad-editor-spec.md).
  if (nextOrder.length === 0) {
    const fresh = buildFreshScratch(creatureId);
    if (resolveBodyFile(creatureId, fresh.meta.id).kind !== "ready") {
      return state;
    }
    replacementId = fresh.meta.id;
    nextOrder.push(fresh.meta.id);
    nextNotes[fresh.meta.id] = fresh.meta;
    nextBodies[fresh.meta.id] = fresh.body;
  }

  const wasActive = state.index.active === noteId;
  // When the deleted note was active, prefer the note that visually replaced
  // it (same position in the order, or the previous one if it was last).
  let nextActive = state.index.active;
  if (wasActive) {
    const removedAt = state.index.order.indexOf(noteId);
    nextActive = nextOrder[Math.min(removedAt, nextOrder.length - 1)];
  }

  const nextIndex: NoteIndex = {
    version: INDEX_VERSION,
    active: nextActive,
    order: nextOrder,
    notes: nextNotes,
  };
  if (!writeIndexToDisk(creatureId, nextIndex)) {
    if (replacementId) {
      deleteBody(creatureId, replacementId);
    }
    return state;
  }

  deleteBody(creatureId, noteId);

  if (repoName) {
    appendEvent({
      ts: now(),
      repoId: creatureId,
      repoName,
      kind: "note-deleted",
      payload: { noteId, name: deletedName },
    });
  }

  return { index: nextIndex, bodies: nextBodies };
};

export const setActive = (
  creatureId: string,
  state: NotesState,
  noteId: string
): NotesState => {
  if (!state.index.notes[noteId] || !isSafeNoteId(noteId) || state.index.active === noteId) return state;
  if (!canMutateNotes(creatureId)) return state;
  const nextIndex: NoteIndex = { ...state.index, active: noteId };
  if (!writeIndexToDisk(creatureId, nextIndex)) return state;
  return { ...state, index: nextIndex };
};

/**
 * Return the body of the note named "blocker" (case-insensitive, trimmed) if
 * one exists and has non-empty content. The garden's vibe layer keys off
 * `ProjectMemory.currentBlocker` to mark a creature as `stuck`; mirroring
 * the blocker note into that field keeps the home scene reactive to the
 * notepad without making `inferVibe` aware of the notes layer.
 *
 * Returns `undefined` when there is no blocker note, when the blocker note is
 * empty, or when multiple notes happen to share the name (first match wins).
 */
export const deriveBlockerFromNotes = (state: NotesState): string | undefined => {
  for (const id of state.index.order) {
    const meta = state.index.notes[id];
    if (!meta) continue;
    if (!namesEqual(meta.name, "blocker")) continue;
    const body = (state.bodies[id] ?? "").trim();
    if (body) return body;
    return undefined;
  }
  return undefined;
};

export const renameNote = (
  creatureId: string,
  state: NotesState,
  noteId: string,
  name: string,
  repoName = ""
): NotesState => {
  if (!state.index.notes[noteId] || !isSafeNoteId(noteId)) return state;
  if (!canMutateNotes(creatureId)) return state;
  const trimmed = sanitizeNoteName(name, "");
  if (!trimmed) return state;
  const uniqueName = uniqueNoteName(state, trimmed, noteId);
  const currentName = state.index.notes[noteId].name;
  if (currentName === uniqueName) return state;
  const stamp = now();
  const nextIndex: NoteIndex = {
    ...state.index,
    notes: {
      ...state.index.notes,
      [noteId]: { ...state.index.notes[noteId], name: uniqueName, updatedAt: stamp },
    },
  };
  if (!writeIndexToDisk(creatureId, nextIndex)) return state;

  if (repoName) {
    appendEvent({
      ts: stamp,
      repoId: creatureId,
      repoName,
      kind: "note-renamed",
      payload: { noteId, from: currentName, to: uniqueName },
    });
  }

  return { ...state, index: nextIndex };
};
