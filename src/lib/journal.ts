import { eventSummary } from "@/lib/event-summary";
import {
  JOURNAL_EVENT_KINDS,
  type JournalEvent,
  type JournalEventKind,
} from "@/lib/events";

export type JournalScopeMode = "focused" | "all";
export type JournalKindFilter = "all" | JournalEventKind;
export type JournalRangeId = "all" | "today" | "7d" | "30d";

export const JOURNAL_KIND_FILTERS: readonly JournalKindFilter[] = [
  "all",
  ...JOURNAL_EVENT_KINDS,
];

export const JOURNAL_RANGE_FILTERS: readonly JournalRangeId[] = [
  "all",
  "today",
  "7d",
  "30d",
];

export interface JournalFilterOptions {
  scope: JournalScopeMode;
  repoId?: string;
  query?: string;
  kind?: JournalKindFilter;
  range?: JournalRangeId;
  now?: Date;
}

export interface JournalStats {
  total: number;
  repoCount: number;
  commitCount: number;
  noteCount: number;
  blockerCount: number;
  branchSwitchCount: number;
  vibeChangeCount: number;
  topRepo?: { repoName: string; count: number };
  kindCounts: Record<JournalEventKind, number>;
}

export interface JournalDetailRow {
  label: string;
  value: string;
}

const MS_PER_DAY = 86_400_000;

export const parseEventTime = (ts: string): number => {
  const time = new Date(ts).getTime();
  return Number.isFinite(time) ? time : 0;
};

export const startOfLocalDay = (date: Date): Date =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate());

export const localDateKey = (ts: string): string => {
  const d = new Date(ts);
  if (!Number.isFinite(d.getTime())) return "unknown";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

export const dayLabel = (ts: string, today: Date): string => {
  const d = new Date(ts);
  if (!Number.isFinite(d.getTime())) return "unknown day";
  const eventDay = startOfLocalDay(d);
  const todayDay = startOfLocalDay(today);
  const diffDays = Math.round((todayDay.getTime() - eventDay.getTime()) / MS_PER_DAY);
  if (diffDays === 0) return "today";
  if (diffDays === 1) return "yesterday";
  if (diffDays > 1 && diffDays < 7) return `${diffDays} days ago`;

  const weekdays = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  const months = [
    "jan",
    "feb",
    "mar",
    "apr",
    "may",
    "jun",
    "jul",
    "aug",
    "sep",
    "oct",
    "nov",
    "dec",
  ];
  return `${weekdays[d.getDay()]} ${months[d.getMonth()]} ${d.getDate()}`;
};

export const formatEventTime = (ts: string): string => {
  const d = new Date(ts);
  if (!Number.isFinite(d.getTime())) return "??:??";
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
};

export const formatEventTimestamp = (ts: string): string => {
  const d = new Date(ts);
  if (!Number.isFinite(d.getTime())) return ts;
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${formatEventTime(ts)}`;
};

const rangeStart = (range: JournalRangeId, now: Date): number | null => {
  const todayStart = startOfLocalDay(now).getTime();
  switch (range) {
    case "today":
      return todayStart;
    case "7d":
      return todayStart - 6 * MS_PER_DAY;
    case "30d":
      return todayStart - 29 * MS_PER_DAY;
    default:
      return null;
  }
};

export const eventMatchesRange = (
  event: JournalEvent,
  range: JournalRangeId,
  now = new Date()
): boolean => {
  const start = rangeStart(range, now);
  if (start === null) return true;
  return parseEventTime(event.ts) >= start;
};

export const journalKindLabel = (kind: JournalKindFilter): string => {
  switch (kind) {
    case "all":
      return "all events";
    case "blocker-added":
      return "blockers added";
    case "blocker-cleared":
      return "blockers cleared";
    case "note-created":
      return "notes created";
    case "note-edited":
      return "notes edited";
    case "note-renamed":
      return "notes renamed";
    case "note-deleted":
      return "notes deleted";
    case "vibe-changed":
      return "vibe shifts";
    case "repo-added":
      return "new repos";
    case "branch-switched":
      return "branch switches";
    default:
      return kind;
  }
};

export const journalRangeLabel = (range: JournalRangeId): string => {
  switch (range) {
    case "today":
      return "today";
    case "7d":
      return "7d";
    case "30d":
      return "30d";
    default:
      return "all time";
  }
};

const payloadSearchText = (payload: Record<string, unknown>): string =>
  Object.values(payload)
    .flatMap((value) => {
      if (value === null || value === undefined) return [];
      if (typeof value === "string") return [value];
      if (typeof value === "number" || typeof value === "boolean") return [String(value)];
      if (Array.isArray(value)) return value.map((item) => String(item));
      return [];
    })
    .join(" ");

export const eventSearchText = (event: JournalEvent): string =>
  [
    event.repoName,
    event.repoId,
    event.kind,
    journalKindLabel(event.kind),
    eventSummary(event, 200),
    payloadSearchText(event.payload),
  ]
    .join(" ")
    .toLowerCase();

export const eventMatchesQuery = (event: JournalEvent, query = ""): boolean => {
  const words = query
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return true;
  const haystack = eventSearchText(event);
  return words.every((word) => haystack.includes(word));
};

export const filterJournalEvents = (
  events: readonly JournalEvent[],
  options: JournalFilterOptions
): JournalEvent[] => {
  const scope = options.scope;
  const kind = options.kind ?? "all";
  const range = options.range ?? "all";
  const now = options.now ?? new Date();
  const query = options.query ?? "";

  return events.filter((event) => {
    if (scope === "focused" && options.repoId && event.repoId !== options.repoId) return false;
    if (kind !== "all" && event.kind !== kind) return false;
    if (!eventMatchesRange(event, range, now)) return false;
    if (!eventMatchesQuery(event, query)) return false;
    return true;
  });
};

export const computeJournalStats = (events: readonly JournalEvent[]): JournalStats => {
  const repoCounts = new Map<string, { repoName: string; count: number }>();
  const kindCounts = Object.fromEntries(
    JOURNAL_EVENT_KINDS.map((kind) => [kind, 0])
  ) as Record<JournalEventKind, number>;

  for (const event of events) {
    kindCounts[event.kind] += 1;
    const current = repoCounts.get(event.repoId) ?? { repoName: event.repoName, count: 0 };
    current.count += 1;
    current.repoName = event.repoName || current.repoName;
    repoCounts.set(event.repoId, current);
  }

  const topRepo = [...repoCounts.values()].sort((a, b) => b.count - a.count)[0];

  return {
    total: events.length,
    repoCount: repoCounts.size,
    commitCount: kindCounts.commit,
    noteCount:
      kindCounts["note-created"] +
      kindCounts["note-edited"] +
      kindCounts["note-renamed"] +
      kindCounts["note-deleted"],
    blockerCount: kindCounts["blocker-added"] + kindCounts["blocker-cleared"],
    branchSwitchCount: kindCounts["branch-switched"],
    vibeChangeCount: kindCounts["vibe-changed"],
    topRepo,
    kindCounts,
  };
};

export const buildActivityBuckets = (
  events: readonly JournalEvent[],
  days = 14,
  now = new Date()
): number[] => {
  const safeDays = Math.max(1, Math.min(60, Math.floor(days)));
  const todayStart = startOfLocalDay(now).getTime();
  const buckets = Array.from({ length: safeDays }, () => 0);

  for (const event of events) {
    const eventStart = startOfLocalDay(new Date(event.ts)).getTime();
    if (!Number.isFinite(eventStart)) continue;
    const age = Math.round((todayStart - eventStart) / MS_PER_DAY);
    if (age < 0 || age >= safeDays) continue;
    buckets[safeDays - 1 - age] += 1;
  }

  return buckets;
};

export const clampJournalIndex = (index: number, eventCount: number): number => {
  if (eventCount <= 0) return 0;
  return Math.max(0, Math.min(eventCount - 1, index));
};

const field = (label: string, value: unknown): JournalDetailRow | null => {
  if (value === null || value === undefined || value === "") return null;
  return { label, value: String(value) };
};

export const journalDetailRows = (event: JournalEvent): JournalDetailRow[] => {
  const p = event.payload;
  const rows: Array<JournalDetailRow | null> = [
    field("summary", eventSummary(event, 160)),
    field("kind", journalKindLabel(event.kind)),
    field("repo", event.repoName),
    field("time", formatEventTimestamp(event.ts)),
  ];

  switch (event.kind) {
    case "commit":
      rows.push(field("commit", p.shortSha ?? p.sha));
      rows.push(field("subject", p.subject));
      break;
    case "blocker-added":
    case "blocker-cleared":
      rows.push(field("blocker", p.firstLine));
      break;
    case "note-created":
    case "note-edited":
    case "note-deleted":
      rows.push(field("note", p.name));
      if (event.kind === "note-edited") rows.push(field("delta", p.charsDelta));
      break;
    case "note-renamed":
      rows.push(field("from", p.from));
      rows.push(field("to", p.to));
      break;
    case "vibe-changed":
      rows.push(field("from", p.from));
      rows.push(field("to", p.to));
      rows.push(field("reason", p.reason));
      break;
    case "repo-added":
      rows.push(field("path", p.path));
      break;
    case "branch-switched":
      rows.push(field("from", p.from));
      rows.push(field("to", p.to));
      break;
    default:
      break;
  }

  return rows.filter((row): row is JournalDetailRow => row !== null);
};
