/**
 * event-summary.ts — affectionate prose summaries for JournalEvents.
 *
 * All text is lowercase, warm, non-numeric-aggregate.
 */

import type { JournalEvent } from "@/lib/events";

const clean = (value: unknown): string => String(value ?? "").trim();

const cap = (value: string, max: number): string => {
  if (max <= 1) return value.slice(0, max);
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
};

const quote = (value: unknown, fallback = "untitled", max = 40): string =>
  `"${cap(clean(value) || fallback, max)}"`;

// Pre-rename journal events still carry "noisy"/"blocked" in their payload.
// Normalising at the call site lets the verb table speak only the current
// vocabulary while old summaries still render with the right transition verb.
const normaliseLegacyVibe = (raw: string): string => {
  if (raw === "noisy") return "awake";
  if (raw === "blocked") return "stuck";
  return raw;
};

// Reads the transition direction, not the destination state, so entries
// don't read like "happy: clean" (which sounds like a status snapshot,
// not a change). Falls back to a generic "became <to>" if the pair is
// unknown — defensive for future vibe additions.
const vibeTransitionVerb = (fromRaw: string, toRaw: string): string => {
  const from = normaliseLegacyVibe(fromRaw);
  const to = normaliseLegacyVibe(toRaw);
  switch (`${from}->${to}`) {
    case "happy->awake": return "got busy";
    case "happy->stuck": return "hit a blocker";
    case "happy->sleepy": return "wound down";
    case "awake->happy": return "settled";
    case "awake->stuck": return "hit a blocker";
    case "awake->sleepy": return "trailed off";
    case "stuck->happy": return "back in flow";
    case "stuck->awake": return "back at it";
    case "stuck->sleepy": return "stalled out";
    case "sleepy->happy": return "woke up";
    case "sleepy->awake": return "stirred";
    case "sleepy->stuck": return "woke into a blocker";
    default: return to ? `became ${to}` : "vibe shifted";
  }
};

// `inferVibe` produces reasons like "blocker: <text>" and "clean." — the
// "blocker:" prefix doubles up after the verb, and trailing periods read
// as awkward when followed by an em-dash. Strip both before joining.
const trimVibeReason = (reason: string): string =>
  reason
    .replace(/^blocker:\s*/i, "")
    .replace(/[.\s]+$/, "")
    .trim();

// Mood transitions are narrated separately from vibe shifts — moods are
// softer, vibey adjectives, so the verbs read more like emotional weather
// than status changes. Unknown moods fall through to a generic phrase.
const moodTransitionVerb = (from: string, to: string): string => {
  switch (`${from}->${to}`) {
    case "content->excited": return "perked up";
    case "content->anxious": return "got anxious";
    case "content->confused": return "got tangled";
    case "content->proud": return "stood tall";
    case "content->curious": return "started exploring";
    case "content->lonely": return "drifted off";
    case "excited->content": return "calmed down";
    case "anxious->content": return "relaxed";
    case "confused->content": return "found its footing";
    case "proud->content": return "settled back";
    case "curious->content": return "found its rhythm";
    case "lonely->content": return "came back";
    case "anxious->confused": return "tangled up";
    case "confused->anxious": return "still anxious";
    case "excited->proud": return "kept going";
    case "proud->excited": return "caught fire";
    case "lonely->curious": return "perked up";
    case "curious->lonely": return "lost interest";
    default: return to ? `feels ${to}` : "mood shifted";
  }
};

export const eventSummary = (
  event: JournalEvent,
  maxSubjectLen = 40
): string => {
  const { kind, payload } = event;

  switch (kind) {
    case "commit": {
      const subject = clean(payload.subject);
      return `shipped ${quote(subject, "work", maxSubjectLen)}`;
    }

    case "blocker-added": {
      const first = clean(payload.firstLine);
      return first ? `blocker: ${quote(first, "blocker", 40)}` : "blocker added";
    }

    case "blocker-cleared": {
      const first = clean(payload.firstLine);
      return first ? `cleared: ${quote(first, "blocker", 36)}` : "blocker cleared";
    }

    case "note-created":
      return `started note ${quote(payload.name, "untitled")}`;

    case "note-edited": {
      const name = quote(payload.name, "note", 36);
      const delta = Number(payload.charsDelta ?? 0);
      if (!Number.isFinite(delta) || delta === 0) return `updated note ${name}`;
      if (delta > 0) return `wrote +${delta} chars to ${name}`;
      return `trimmed ${Math.abs(delta)} chars in ${name}`;
    }

    case "note-renamed":
      return `renamed note ${quote(payload.from, "note", 24)} → ${quote(payload.to, "note", 24)}`;

    case "note-deleted":
      return `deleted note ${quote(payload.name, "note", 36)}`;

    case "vibe-changed": {
      const from = clean(payload.from);
      const to = clean(payload.to);
      const reason = trimVibeReason(clean(payload.reason));
      const verb = vibeTransitionVerb(from, to);
      return reason ? `${verb} — ${reason}` : verb;
    }

    case "mood-changed": {
      const from = clean(payload.from);
      const to = clean(payload.to);
      const reason = clean(payload.reason).replace(/[.\s]+$/, "");
      const verb = moodTransitionVerb(from, to);
      return reason ? `${verb} — ${cap(reason, 60)}` : verb;
    }

    case "repo-added":
      return "joined the garden";

    case "branch-switched": {
      const from = clean(payload.from);
      const to = clean(payload.to);
      if (from && to) return `switched ${from} → ${to}`;
      return to ? `switched to ${to}` : "branch switched";
    }

    case "pull": {
      const ok = payload.ok === true;
      const branch = clean(payload.branch);
      const onto = branch ? ` onto ${branch}` : "";
      if (ok) {
        const rawCommits = payload.commitsPulled;
        if (rawCommits === undefined || rawCommits === null) {
          return `pulled changes${onto}`;
        }
        const commits = Number(rawCommits);
        if (!Number.isFinite(commits) || commits <= 0) {
          return branch ? `already up to date with ${branch}` : "already up to date";
        }
        const noun = commits === 1 ? "commit" : "commits";
        return `pulled ${commits} ${noun}${onto}`;
      }
      const reason = clean(payload.summary);
      return reason ? `pull failed: ${cap(reason, 60)}` : "pull failed";
    }

    default:
      return kind;
  }
};
