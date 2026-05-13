import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

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

const projectDir = (id: string): string => join(homedir(), ".repogarden", "projects", id);
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

const ensureDir = (path: string): void => {
  try {
    mkdirSync(path, { recursive: true });
  } catch {
    // best-effort; downstream writes will surface failures.
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
  ensureDir(dirname(path));
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

const readIndexFromDisk = (creatureId: string): NoteIndex | null => {
  const path = indexPath(creatureId);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<NoteIndex>;
    if (parsed.version !== INDEX_VERSION) return null;
    if (!parsed.notes || typeof parsed.notes !== "object") return null;
    if (!Array.isArray(parsed.order)) return null;

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

    if (order.length === 0) return null;
    const active =
      typeof parsed.active === "string" && notes[parsed.active]
        ? parsed.active
        : order[0];

    return { version: INDEX_VERSION, active, order, notes };
  } catch {
    return null;
  }
};

const writeIndexToDisk = (creatureId: string, index: NoteIndex): boolean =>
  atomicWriteFile(indexPath(creatureId), JSON.stringify(index, null, 2));

const readBody = (creatureId: string, noteId: string): string => {
  const path = notePath(creatureId, noteId);
  if (!existsSync(path)) return "";
  try {
    return normalizeBodyText(readFileSync(path, "utf8"));
  } catch {
    return "";
  }
};

const writeBody = (creatureId: string, noteId: string, body: string): boolean =>
  atomicWriteFile(notePath(creatureId, noteId), normalizeBodyText(body));

const deleteBody = (creatureId: string, noteId: string): void => {
  try {
    unlinkSync(notePath(creatureId, noteId));
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

/**
 * Build a notes state for a creature, migrating from legacy ProjectMemory
 * (currentBlocker / noteToFutureSelf) on first access.
 */
export const loadNotes = (creatureId: string): NotesState => {
  const existing = readIndexFromDisk(creatureId);

  if (!existing) {
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

  // Reconcile against disk: a note in the index whose body file is missing
  // has been deleted out-of-band; drop it. If everything is gone, recreate
  // a scratch note so the editor never opens to an empty state.
  const survivingOrder: string[] = [];
  const survivingNotes: Record<string, NoteMeta> = {};
  const bodies: Record<string, string> = {};
  for (const id of existing.order) {
    if (existsSync(notePath(creatureId, id))) {
      survivingOrder.push(id);
      survivingNotes[id] = existing.notes[id];
      bodies[id] = readBody(creatureId, id);
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
    reconciled.order.length !== existing.order.length ||
    reconciled.active !== existing.active ||
    reconciled.order.some((id) => reconciled.notes[id]?.name !== existing.notes[id]?.name)
  ) {
    writeIndexToDisk(creatureId, reconciled);
  }

  return { index: reconciled, bodies };
};

export const saveNoteBody = (
  creatureId: string,
  state: NotesState,
  noteId: string,
  body: string,
  repoName = ""
): NotesState => {
  if (!state.index.notes[noteId] || !isSafeNoteId(noteId)) return state;
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
    if (!existsSync(notePath(creatureId, fresh.meta.id))) {
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
  const nextIndex: NoteIndex = { ...state.index, active: noteId };
  if (!writeIndexToDisk(creatureId, nextIndex)) return state;
  return { ...state, index: nextIndex };
};

/**
 * Return the body of the note named "blocker" (case-insensitive, trimmed) if
 * one exists and has non-empty content. The garden's vibe layer keys off
 * `ProjectMemory.currentBlocker` to mark a creature as `blocked`; mirroring
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
