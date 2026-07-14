import type { RepoCreature } from "@/lib/creature";
import type { JournalEvent } from "@/lib/events";
import { eventSummary } from "@/lib/event-summary";
import { buildActivityBuckets, parseEventTime } from "@/lib/journal";
import type { NotesState } from "@/lib/notes";
import { MOOD_DISPLAY_CONFIDENCE_THRESHOLD } from "@/lib/vibe";

export type PortraitSectionId =
  | "overview"
  | "actions"
  | "notes"
  | "activity"
  | "changes"
  | "commits";

export const PORTRAIT_SECTIONS: readonly PortraitSectionId[] = [
  "overview",
  "actions",
  "notes",
  "activity",
  "changes",
  "commits",
] as const;

export type PortraitSeverity = "success" | "info" | "warning" | "error";

export interface PortraitHealthScore {
  score: number;
  label: "excellent" | "steady" | "needs attention" | "critical";
  severity: PortraitSeverity;
  reasons: string[];
}

export interface PortraitChip {
  key: string;
  label: string;
  severity: PortraitSeverity | "muted";
}

export interface PortraitStat {
  key: string;
  label: string;
  value: string;
  detail?: string;
  severity?: PortraitSeverity | "muted";
}

export interface PortraitAction {
  id: string;
  title: string;
  detail: string;
  severity: PortraitSeverity;
  shortcut?: string;
  section?: PortraitSectionId;
}

export interface PortraitNoteSummary {
  id: string;
  name: string;
  preview: string;
  charCount: number;
  lineCount: number;
  updatedLabel: string;
  active: boolean;
  empty: boolean;
  kind: "blocker" | "future-self" | "regular";
}

export interface PortraitEventSummary {
  id: string;
  kind: JournalEvent["kind"];
  summary: string;
  timeLabel: string;
}

export interface PortraitCommitSummary {
  sha: string;
  shortSha: string;
  subject: string;
  author: string;
  timeLabel: string;
}

export interface PortraitChangeSummary {
  filename: string;
  oldLineCount: number;
  newLineCount: number;
  truncated: boolean;
}

export interface PortraitModel {
  score: PortraitHealthScore;
  chips: PortraitChip[];
  stats: PortraitStat[];
  actions: PortraitAction[];
  notes: PortraitNoteSummary[];
  events: PortraitEventSummary[];
  commits: PortraitCommitSummary[];
  changes: PortraitChangeSummary[];
  activityBuckets: number[];
  blocker?: string;
  futureSelf?: string;
}

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

const parseTime = (iso: string | undefined): number | null => {
  if (!iso) return null;
  const time = new Date(iso).getTime();
  return Number.isFinite(time) ? time : null;
};

const plural = (count: number, singular: string, pluralText = `${singular}s`): string =>
  `${count} ${count === 1 ? singular : pluralText}`;

const cap = (value: string, max: number): string => {
  if (max <= 1) return value.slice(0, max);
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
};

export const sectionLabel = (section: PortraitSectionId): string => {
  switch (section) {
    case "overview":
      return "overview";
    case "actions":
      return "actions";
    case "notes":
      return "notes";
    case "activity":
      return "activity";
    case "changes":
      return "changes";
    case "commits":
      return "commits";
  }
};

export const clampPortraitSectionIndex = (index: number): number =>
  clamp(Math.floor(Number.isFinite(index) ? index : 0), 0, PORTRAIT_SECTIONS.length - 1);

export const cyclePortraitSection = (current: number, direction: 1 | -1): number => {
  const start = clampPortraitSectionIndex(current);
  return (start + direction + PORTRAIT_SECTIONS.length) % PORTRAIT_SECTIONS.length;
};

/** Total scrollable items in a section, used together with `sectionPageSize`
 *  to clamp PgUp/PgDn offsets in PORTRAIT. Overview returns 0 — it isn't
 *  scrollable by design (the stats block + top-3 actions fit on every
 *  reasonable terminal). */
export const sectionItemCount = (
  section: PortraitSectionId,
  model: PortraitModel,
  creature: RepoCreature
): number => {
  switch (section) {
    case "actions":
      return model.actions.length;
    case "notes":
      return model.notes.length;
    case "activity":
      return model.events.length;
    case "changes":
      return creature.scan.dirtyFiles?.length ?? model.changes.length;
    case "commits":
      return model.commits.length;
    case "overview":
      return 0;
  }
};

/** Page size for each scrollable portrait section. Tracks the limit each
 *  section's renderer applies inline (`.slice(0, N)`). `detailsOpen` mirrors
 *  the `d` toggle. Overview is non-scrollable. */
export const sectionPageSize = (
  section: PortraitSectionId,
  detailsOpen: boolean
): number => {
  switch (section) {
    case "actions":
      return detailsOpen ? 8 : 5;
    case "notes":
      return detailsOpen ? 10 : 5;
    case "activity":
      return detailsOpen ? 8 : 5;
    case "changes":
      return detailsOpen ? 16 : 8;
    case "commits":
      return detailsOpen ? 10 : 6;
    case "overview":
      return 0;
  }
};

export const relativeAgeLabel = (iso: string | undefined, now = new Date()): string => {
  const time = parseTime(iso);
  if (time === null) return "unknown";
  const diff = Math.max(0, now.getTime() - time);
  if (diff < MS_PER_MINUTE) return "just now";
  if (diff < MS_PER_HOUR) return `${Math.floor(diff / MS_PER_MINUTE)}m ago`;
  if (diff < MS_PER_DAY) return `${Math.floor(diff / MS_PER_HOUR)}h ago`;
  const days = Math.floor(diff / MS_PER_DAY);
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
};

const daysSinceIso = (iso: string | undefined, now = new Date()): number | undefined => {
  const time = parseTime(iso);
  if (time === null) return undefined;
  return Math.max(0, Math.floor((now.getTime() - time) / MS_PER_DAY));
};

const firstMeaningfulLine = (body: string, fallback = "empty", max = 72): string => {
  const line = body
    .split("\n")
    .map((part) => part.trim())
    .find(Boolean);
  return cap(line ?? fallback, max);
};

const bodyLineCount = (body: string): number => {
  if (!body.trim()) return 0;
  return body.split("\n").length;
};

const bodyCharCount = (body: string): number => body.length;

const noteKind = (name: string): PortraitNoteSummary["kind"] => {
  const normalized = name.trim().toLowerCase();
  if (normalized === "blocker") return "blocker";
  if (normalized === "note to future self" || normalized === "future self") return "future-self";
  return "regular";
};

export const buildPortraitNoteSummaries = (
  notes: NotesState,
  now = new Date()
): PortraitNoteSummary[] => {
  return notes.index.order
    .map((id) => {
      const meta = notes.index.notes[id];
      if (!meta) return null;
      const body = notes.bodies[id] ?? "";
      const kind = noteKind(meta.name);
      return {
        id,
        name: meta.name,
        preview: firstMeaningfulLine(body, "empty"),
        charCount: bodyCharCount(body),
        lineCount: bodyLineCount(body),
        updatedLabel: relativeAgeLabel(meta.updatedAt, now),
        active: notes.index.active === id,
        empty: body.trim().length === 0,
        kind,
      } satisfies PortraitNoteSummary;
    })
    .filter((note): note is PortraitNoteSummary => note !== null);
};

export const buildPortraitEventSummaries = (
  events: readonly JournalEvent[],
  now = new Date(),
  limit = 6
): PortraitEventSummary[] => {
  return events
    .slice()
    .sort((a, b) => parseEventTime(b.ts) - parseEventTime(a.ts))
    .slice(0, Math.max(0, limit))
    .map((event, index) => ({
      id: `${event.ts}:${event.repoId}:${event.kind}:${index}`,
      kind: event.kind,
      summary: eventSummary(event, 90),
      timeLabel: relativeAgeLabel(event.ts, now),
    }));
};

export const buildPortraitCommitSummaries = (
  creature: RepoCreature,
  now = new Date(),
  limit = 6
): PortraitCommitSummary[] => {
  return (creature.scan.recentCommits ?? [])
    .slice(0, Math.max(0, limit))
    .map((commit) => ({
      sha: commit.sha,
      shortSha: commit.shortSha,
      subject: cap(commit.subject || "work", 96),
      author: commit.author || "unknown",
      timeLabel: relativeAgeLabel(commit.committedAt, now),
    }));
};

export const buildPortraitChangeSummaries = (creature: RepoCreature): PortraitChangeSummary[] => {
  return (creature.scan.dirtyChanges ?? []).map((change) => ({
    filename: change.filename,
    oldLineCount: bodyLineCount(change.oldText),
    newLineCount: bodyLineCount(change.newText),
    truncated: change.truncated,
  }));
};

export const computePortraitHealthScore = (
  creature: RepoCreature,
  notes: NotesState,
  now = new Date()
): PortraitHealthScore => {
  let score = 100;
  const reasons: string[] = [];
  const blocker = creature.memory.currentBlocker?.trim();

  if (creature.scan.scanError) {
    score -= 45;
    reasons.push("scan error");
  }

  if (blocker) {
    score -= 35;
    reasons.push("active blocker");
  }

  if (creature.scan.isDirty) {
    score -= 20;
    reasons.push("working tree has changes");
  }

  const behind = creature.scan.behind ?? 0;
  if (behind > 0) {
    score -= Math.min(25, behind * 8);
    reasons.push(`${plural(behind, "commit")} behind`);
  }

  const ahead = creature.scan.ahead ?? 0;
  if (ahead > 0) {
    score -= Math.min(10, ahead * 3);
    reasons.push(`${plural(ahead, "commit")} unpushed`);
  }

  const days = creature.vibe.daysSinceCommit ?? daysSinceIso(creature.scan.lastCommitAt, now);
  if (days !== undefined) {
    if (days >= 30) {
      score -= 25;
      reasons.push("no commits in 30d");
    } else if (days >= 14) {
      score -= 16;
      reasons.push("no commits in 14d");
    } else if (days >= 7) {
      score -= 8;
      reasons.push("quiet for 7d");
    }
  }

  const noteSummaries = buildPortraitNoteSummaries(notes, now);
  if (noteSummaries.length === 0 || noteSummaries.every((note) => note.empty)) {
    score -= 5;
    reasons.push("no repo notes yet");
  }

  const finalScore = clamp(Math.round(score), 0, 100);
  if (finalScore >= 85) {
    return { score: finalScore, label: "excellent", severity: "success", reasons };
  }
  if (finalScore >= 70) {
    return { score: finalScore, label: "steady", severity: "info", reasons };
  }
  if (finalScore >= 50) {
    return { score: finalScore, label: "needs attention", severity: "warning", reasons };
  }
  return { score: finalScore, label: "critical", severity: "error", reasons };
};

// Confidence floor for surfacing a mood chip — shared with the garden's
// focus caption / emotion cues so "is this mood worth showing?" answers
// the same everywhere (see MOOD_DISPLAY_CONFIDENCE_THRESHOLD in vibe.ts).
const MOOD_CHIP_CONFIDENCE_THRESHOLD = MOOD_DISPLAY_CONFIDENCE_THRESHOLD;

const moodChipSeverity = (mood: import("@/lib/vibe").Mood): PortraitChip["severity"] => {
  switch (mood) {
    case "confused": return "error";
    case "anxious": return "warning";
    case "excited": return "info";
    case "proud": return "success";
    case "curious": return "info";
    case "lonely": return "muted";
    case "content": return "muted";
  }
};

export const buildPortraitChips = (
  creature: RepoCreature,
  now = new Date()
): PortraitChip[] => {
  const chips: PortraitChip[] = [];
  if (creature.scan.branch) chips.push({ key: "branch", label: `⎇ ${cap(creature.scan.branch, 28)}`, severity: "muted" });
  if (creature.scan.primaryLanguage) chips.push({ key: "language", label: creature.scan.primaryLanguage, severity: "muted" });
  chips.push({
    key: "dirty",
    label: creature.scan.isDirty ? "dirty" : "clean",
    severity: creature.scan.isDirty ? "warning" : "success",
  });
  if ((creature.scan.ahead ?? 0) > 0) {
    chips.push({ key: "ahead", label: `↑${creature.scan.ahead}`, severity: "info" });
  }
  if ((creature.scan.behind ?? 0) > 0) {
    chips.push({ key: "behind", label: `↓${creature.scan.behind}`, severity: "warning" });
  }
  if (creature.scan.lastCommitAt) {
    chips.push({ key: "last", label: `last ${relativeAgeLabel(creature.scan.lastCommitAt, now)}`, severity: "muted" });
  }
  const { vibe, mood, confidence } = creature.vibe;
  const moodIsRedundant = mood === "lonely" && vibe === "sleepy";
  if (
    mood !== "content" &&
    confidence >= MOOD_CHIP_CONFIDENCE_THRESHOLD &&
    !moodIsRedundant
  ) {
    chips.push({ key: "mood", label: mood, severity: moodChipSeverity(mood) });
  }
  return chips;
};

export const buildPortraitStats = (
  creature: RepoCreature,
  notes: NotesState,
  events: readonly JournalEvent[],
  score: PortraitHealthScore,
  now = new Date()
): PortraitStat[] => {
  const noteSummaries = buildPortraitNoteSummaries(notes, now);
  const nonEmptyNotes = noteSummaries.filter((note) => !note.empty).length;
  const chars = noteSummaries.reduce((sum, note) => sum + note.charCount, 0);
  const weekAgo = now.getTime() - 7 * MS_PER_DAY;
  const weekEvents = events.filter((event) => parseEventTime(event.ts) >= weekAgo).length;
  const commitBuckets = creature.scan.recentCommitDays ?? [];
  const recentCommitCount = commitBuckets.reduce((sum, count) => sum + count, 0);

  return [
    {
      key: "health",
      label: "health",
      value: `${score.score}%`,
      detail: score.label,
      severity: score.severity,
    },
    {
      key: "commits",
      label: "commits",
      value: creature.scan.commitCount === undefined ? "—" : String(creature.scan.commitCount),
      detail: recentCommitCount > 0 ? `${recentCommitCount} in 30d` : "none in 30d",
      severity: recentCommitCount > 0 ? "muted" : "warning",
    },
    {
      key: "notes",
      label: "notes",
      value: `${nonEmptyNotes}/${noteSummaries.length}`,
      detail: chars > 0 ? `${chars} chars` : "empty",
      severity: nonEmptyNotes > 0 ? "muted" : "warning",
    },
    {
      key: "activity",
      label: "activity",
      value: String(weekEvents),
      detail: "events in 7d",
      severity: weekEvents > 0 ? "muted" : "info",
    },
  ];
};

export const buildPortraitActions = (
  creature: RepoCreature,
  notes: NotesState,
  events: readonly JournalEvent[],
  now = new Date()
): PortraitAction[] => {
  const actions: PortraitAction[] = [];
  const blocker = creature.memory.currentBlocker?.trim();
  const noteSummaries = buildPortraitNoteSummaries(notes, now);
  const hasPlanningNote = noteSummaries.some((note) =>
    /\b(next|todo|plan|decision|blocker)\b/i.test(note.name)
  );

  if (creature.scan.scanError) {
    actions.push({
      id: "scan-error",
      title: "fix scan error",
      detail: creature.scan.scanError,
      severity: "error",
      section: "overview",
    });
  }

  if (blocker) {
    actions.push({
      id: "blocker",
      title: "clear the active blocker",
      detail: firstMeaningfulLine(blocker, "blocker", 90),
      severity: "error",
      shortcut: "n",
      section: "notes",
    });
  }

  if ((creature.scan.behind ?? 0) > 0) {
    const behind = creature.scan.behind ?? 0;
    actions.push({
      id: "behind",
      title: "update from your terminal",
      detail: `${plural(behind, "commit")} behind remote; use your normal git workflow outside RepoGarden.`,
      severity: "warning",
      section: "commits",
    });
  }

  if (creature.scan.isDirty) {
    const count = creature.scan.dirtyFileCount ?? creature.scan.dirtyChanges?.length ?? 0;
    actions.push({
      id: "dirty",
      title: "review working tree",
      detail: count > 0 ? `${plural(count, "file")} changed; open changes for a quick diff.` : "uncommitted changes detected.",
      severity: "warning",
      shortcut: "d",
      section: "changes",
    });
  }

  if ((creature.scan.ahead ?? 0) > 0) {
    const ahead = creature.scan.ahead ?? 0;
    actions.push({
      id: "ahead",
      title: "push local commits",
      detail: `${plural(ahead, "commit")} ahead of remote.`,
      severity: "info",
      section: "commits",
    });
  }

  const days = creature.vibe.daysSinceCommit ?? daysSinceIso(creature.scan.lastCommitAt, now);
  if (days !== undefined && days >= 14) {
    actions.push({
      id: "stale",
      title: days >= 30 ? "decide whether this repo is dormant" : "wake up the thread",
      detail: `last commit was ${relativeAgeLabel(creature.scan.lastCommitAt, now)}; capture next step or archive the repo mentally.`,
      severity: days >= 30 ? "warning" : "info",
      shortcut: "n",
      section: "notes",
    });
  }

  if (noteSummaries.length === 0 || noteSummaries.every((note) => note.empty)) {
    actions.push({
      id: "empty-notes",
      title: "write one useful note",
      detail: "capture the next step, risk, or reason this repo matters.",
      severity: "info",
      shortcut: "n",
      section: "notes",
    });
  } else if (!hasPlanningNote) {
    actions.push({
      id: "planning-note",
      title: "name a planning note",
      detail: "a note named blocker, next, todo, plan, or decision makes the portrait easier to read later.",
      severity: "info",
      shortcut: "n",
      section: "notes",
    });
  }

  const recentEvents = events.filter((event) => parseEventTime(event.ts) >= now.getTime() - 7 * MS_PER_DAY).length;
  if (recentEvents === 0 && !creature.scan.scanError) {
    actions.push({
      id: "quiet-journal",
      title: "let the journal build signal",
      detail: "new commits and note edits will make this portrait more useful over time.",
      severity: "info",
      section: "activity",
    });
  }

  if (actions.length === 0) {
    actions.push({
      id: "healthy",
      title: "nothing urgent",
      detail: "clean working tree, no active blocker, and no obvious sync risk.",
      severity: "success",
      section: "overview",
    });
  }

  return actions;
};

export const buildPortraitModel = (
  creature: RepoCreature,
  notes: NotesState,
  events: readonly JournalEvent[],
  now = new Date()
): PortraitModel => {
  const score = computePortraitHealthScore(creature, notes, now);
  return {
    score,
    chips: buildPortraitChips(creature, now),
    stats: buildPortraitStats(creature, notes, events, score, now),
    actions: buildPortraitActions(creature, notes, events, now),
    notes: buildPortraitNoteSummaries(notes, now),
    events: buildPortraitEventSummaries(events, now),
    commits: buildPortraitCommitSummaries(creature, now),
    changes: buildPortraitChangeSummaries(creature),
    activityBuckets: buildActivityBuckets(events, 14, now),
    blocker: creature.memory.currentBlocker?.trim() || undefined,
    futureSelf: creature.memory.noteToFutureSelf?.trim() || undefined,
  };
};

export const buildPortraitClipboardText = (creature: RepoCreature, model: PortraitModel): string => {
  const { vibe, mood, confidence, moodReason } = creature.vibe;
  // Surface mood when we're confident enough and it adds information.
  // `content` is the default no-signal mood; `lonely` is redundant copy
  // when the sprite is already on the sleepy shelf.
  const showMood =
    confidence >= 0.5 &&
    mood !== "content" &&
    !(mood === "lonely" && vibe === "sleepy");
  const lines = [
    `${creature.scan.name} — ${model.score.label} (${model.score.score}%)`,
    `path: ${creature.scan.path}`,
    creature.scan.branch ? `branch: ${creature.scan.branch}` : undefined,
    `vibe: ${vibe} — ${creature.vibe.reason}`,
    showMood ? `feels: ${mood} — ${moodReason}` : undefined,
    creature.scan.isDirty ? `working tree: dirty` : `working tree: clean`,
    (creature.scan.ahead ?? 0) > 0 ? `ahead: ${creature.scan.ahead}` : undefined,
    (creature.scan.behind ?? 0) > 0 ? `behind: ${creature.scan.behind}` : undefined,
    "",
    "next actions:",
    ...model.actions.slice(0, 4).map((action) => `- ${action.title}: ${action.detail}`),
  ];

  return lines.filter((line): line is string => line !== undefined).join("\n").trimEnd();
};
