import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  watch,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import type { Vibe } from "./vibe";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export const JOURNAL_EVENT_KINDS = [
  "commit",
  "blocker-added",
  "blocker-cleared",
  "note-created",
  "note-edited",
  "note-renamed",
  "note-deleted",
  "vibe-changed",
  "repo-added",
  "branch-switched",
  "pull",
] as const;

export type JournalEventKind = (typeof JOURNAL_EVENT_KINDS)[number];

export type JournalEvent = {
  ts: string;
  repoId: string;
  repoName: string;
  kind: JournalEventKind;
  payload: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// Path helpers — all derived from homedir() to match memory.ts / notes.ts
// ---------------------------------------------------------------------------

const globalDir = (): string => join(homedir(), ".repogarden");
const eventsPath = (): string => join(globalDir(), "events.jsonl");
const eventsMetaPath = (): string => join(globalDir(), "events.meta.json");
const scanSnapshotPath = (): string => join(globalDir(), "scan-snapshot.json");

const ensureGlobalDir = (): void => {
  try {
    mkdirSync(globalDir(), { recursive: true });
  } catch {
    // Directory may already exist or be unwritable; callers handle gracefully.
  }
};

const ensureDir = (path: string): void => {
  try {
    mkdirSync(path, { recursive: true });
  } catch {
    // best-effort; downstream writes handle failures.
  }
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

// ---------------------------------------------------------------------------
// Event validation / normalization
// ---------------------------------------------------------------------------

const KIND_SET = new Set<string>(JOURNAL_EVENT_KINDS);
const MAX_STRING_PAYLOAD = 2_000;
const MAX_PAYLOAD_KEYS = 40;
const MAX_PAYLOAD_DEPTH = 3;

const stripControls = (value: string): string =>
  value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");

const cleanInlineString = (value: string, fallback = ""): string => {
  const normalized = stripControls(value).replace(/\s+/g, " ").trim();
  return normalized || fallback;
};

const isFiniteIsoDate = (value: string): boolean => {
  const time = new Date(value).getTime();
  return Number.isFinite(time);
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const sanitizePayloadValue = (value: unknown, depth = 0): unknown => {
  if (value === null) return null;
  if (typeof value === "string") {
    const cleaned = stripControls(value);
    return cleaned.length > MAX_STRING_PAYLOAD
      ? `${cleaned.slice(0, MAX_STRING_PAYLOAD - 1)}…`
      : cleaned;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString() : null;
  if (Array.isArray(value)) {
    if (depth >= MAX_PAYLOAD_DEPTH) return [];
    return value.slice(0, MAX_PAYLOAD_KEYS).map((item) => sanitizePayloadValue(item, depth + 1));
  }
  if (isPlainObject(value)) {
    if (depth >= MAX_PAYLOAD_DEPTH) return {};
    const entries = Object.entries(value).slice(0, MAX_PAYLOAD_KEYS);
    return Object.fromEntries(
      entries.map(([key, item]) => [
        cleanInlineString(key).slice(0, 80) || "key",
        sanitizePayloadValue(item, depth + 1),
      ])
    );
  }
  if (value === undefined || typeof value === "function" || typeof value === "symbol") {
    return undefined;
  }
  return String(value);
};

export const normalizeJournalEvent = (raw: unknown): JournalEvent | null => {
  if (!isPlainObject(raw)) return null;

  const ts = typeof raw.ts === "string" ? raw.ts : "";
  const repoId = typeof raw.repoId === "string" ? cleanInlineString(raw.repoId) : "";
  const repoName = typeof raw.repoName === "string" ? cleanInlineString(raw.repoName, repoId) : repoId;
  const kind = typeof raw.kind === "string" && KIND_SET.has(raw.kind)
    ? (raw.kind as JournalEventKind)
    : null;

  if (!ts || !isFiniteIsoDate(ts) || !repoId || !repoName || !kind) return null;

  const payload = isPlainObject(raw.payload)
    ? (sanitizePayloadValue(raw.payload) as Record<string, unknown>)
    : {};

  return { ts, repoId, repoName, kind, payload };
};

const eventTime = (event: JournalEvent): number => new Date(event.ts).getTime();

// ---------------------------------------------------------------------------
// Core event API
// ---------------------------------------------------------------------------

/**
 * Append a single event to the global events.jsonl file.
 * Synchronous — these calls happen off the render path.
 */
export const appendEvent = (ev: JournalEvent): void => {
  const normalized = normalizeJournalEvent(ev);
  if (!normalized) return;

  ensureGlobalDir();
  try {
    appendFileSync(eventsPath(), JSON.stringify(normalized) + "\n", "utf8");
  } catch {
    // best-effort; event log is non-critical
  }
};

export interface ReadEventsOptions {
  since?: Date;
  limit?: number;
  repoId?: string;
  kinds?: readonly JournalEventKind[];
}

/**
 * Read events from disk, skipping malformed lines silently.
 * Returns newest-first by timestamp, not by file append order. Applies filters
 * before slicing to `limit`, so timeline filters do not accidentally hide
 * matching older events behind unrelated recent ones.
 */
export const readEvents = (opts: ReadEventsOptions = {}): JournalEvent[] => {
  const path = eventsPath();
  if (!existsSync(path)) return [];

  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return [];
  }

  const rows: Array<{ event: JournalEvent; lineIndex: number }> = [];
  const lines = raw.split("\n");
  lines.forEach((line, lineIndex) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      const normalized = normalizeJournalEvent(JSON.parse(trimmed));
      if (normalized) rows.push({ event: normalized, lineIndex });
    } catch {
      // malformed line — skip
    }
  });

  let filtered = rows;
  if (opts.since !== undefined) {
    const sinceTime = opts.since.getTime();
    if (Number.isFinite(sinceTime)) {
      filtered = filtered.filter(({ event }) => eventTime(event) >= sinceTime);
    }
  }
  if (opts.repoId !== undefined) {
    const rid = opts.repoId;
    filtered = filtered.filter(({ event }) => event.repoId === rid);
  }
  if (opts.kinds !== undefined && opts.kinds.length > 0) {
    const allowed = new Set(opts.kinds);
    filtered = filtered.filter(({ event }) => allowed.has(event.kind));
  }

  filtered.sort((a, b) => {
    const byTime = eventTime(b.event) - eventTime(a.event);
    return byTime !== 0 ? byTime : b.lineIndex - a.lineIndex;
  });

  const events = filtered.map(({ event }) => event);
  return opts.limit !== undefined && opts.limit > 0
    ? events.slice(0, opts.limit)
    : events;
};

// ---------------------------------------------------------------------------
// File-change subscription
// ---------------------------------------------------------------------------

const WATCHER_DEBOUNCE_MS = 100;

/**
 * Subscribe to changes on the events.jsonl file via `fs.watch`. The callback
 * fires after a short debounce (which absorbs the multi-event chatter
 * appendFileSync triggers on macOS FSEvents and gives the writer time to
 * flush).
 *
 * Watches the parent directory rather than the file directly so a missing
 * file (first-launch / post-reset) still resolves once it appears. Falls
 * back silently when fs.watch is unsupported (network mounts, some WSL
 * paths, certain VM-mounted filesystems) — callers should keep a slow
 * safety-net poll so updates still arrive in those environments.
 *
 * Returns an unsubscribe function. Always safe to call.
 */
export const subscribeToEventsFile = (onChange: () => void): (() => void) => {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let watcher: ReturnType<typeof watch> | null = null;
  let closed = false;

  const fire = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      if (!closed) onChange();
    }, WATCHER_DEBOUNCE_MS);
  };

  try {
    ensureGlobalDir();
    watcher = watch(globalDir(), (_eventType, filename) => {
      // `filename` is null on some platforms; treat that as "definitely
      // possibly relevant" rather than dropping the event.
      if (filename === null || filename === "events.jsonl") {
        fire();
      }
    });
    watcher.on("error", () => {
      try { watcher?.close(); } catch { /* already closed */ }
      watcher = null;
    });
  } catch {
    // fs.watch isn't supported here. Caller's safety-net poll covers us.
  }

  return () => {
    closed = true;
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    if (watcher) {
      try { watcher.close(); } catch { /* already closed */ }
      watcher = null;
    }
  };
};

// ---------------------------------------------------------------------------
// Events meta (seeded flag)
// ---------------------------------------------------------------------------

export interface EventsMeta {
  seeded: boolean;
  seededAt?: string;
}

export const loadEventsMeta = (): EventsMeta => {
  const path = eventsMetaPath();
  if (!existsSync(path)) return { seeded: false };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<EventsMeta>;
    return {
      seeded: parsed.seeded === true,
      seededAt:
        typeof parsed.seededAt === "string" && isFiniteIsoDate(parsed.seededAt)
          ? parsed.seededAt
          : undefined,
    };
  } catch {
    return { seeded: false };
  }
};

export const saveEventsMeta = (meta: EventsMeta): void => {
  const normalized: EventsMeta = {
    seeded: meta.seeded === true,
    seededAt:
      typeof meta.seededAt === "string" && isFiniteIsoDate(meta.seededAt)
        ? meta.seededAt
        : undefined,
  };
  atomicWriteFile(eventsMetaPath(), JSON.stringify(normalized, null, 2));
};

// ---------------------------------------------------------------------------
// Scan snapshot — tracks last-known vibe/branch/sha per repo for diffing
// ---------------------------------------------------------------------------

export interface SnapEntry {
  vibe: Vibe;
  branch?: string;
  latestCommitSha?: string;
}

const VIBES = new Set<Vibe>(["happy", "sleepy", "noisy", "blocked"]);

const normalizeSnapEntry = (raw: unknown): SnapEntry | null => {
  if (!isPlainObject(raw)) return null;
  const vibe = typeof raw.vibe === "string" && VIBES.has(raw.vibe as Vibe)
    ? (raw.vibe as Vibe)
    : null;
  if (!vibe) return null;
  return {
    vibe,
    branch: typeof raw.branch === "string" ? cleanInlineString(raw.branch) : undefined,
    latestCommitSha:
      typeof raw.latestCommitSha === "string" ? cleanInlineString(raw.latestCommitSha) : undefined,
  };
};

export const loadScanSnapshot = (): Record<string, SnapEntry> => {
  const path = scanSnapshotPath();
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    if (!isPlainObject(parsed)) return {};
    const snapshot: Record<string, SnapEntry> = {};
    for (const [repoId, entry] of Object.entries(parsed)) {
      const cleanRepoId = cleanInlineString(repoId);
      const normalized = normalizeSnapEntry(entry);
      if (cleanRepoId && normalized) snapshot[cleanRepoId] = normalized;
    }
    return snapshot;
  } catch {
    return {};
  }
};

export const saveScanSnapshot = (snap: Record<string, SnapEntry>): void => {
  const normalized: Record<string, SnapEntry> = {};
  for (const [repoId, entry] of Object.entries(snap)) {
    const cleanRepoId = cleanInlineString(repoId);
    const cleanEntry = normalizeSnapEntry(entry);
    if (cleanRepoId && cleanEntry) normalized[cleanRepoId] = cleanEntry;
  }
  atomicWriteFile(scanSnapshotPath(), JSON.stringify(normalized, null, 2));
};
