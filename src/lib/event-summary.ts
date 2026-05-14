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
      const reason = clean(payload.reason);
      if (from === "sleepy" && to === "happy") {
        return `woke up${reason ? ` — ${reason}` : ""}`;
      }
      if (from === "sleepy") {
        return `drifted into ${to}${reason ? ` — ${reason}` : ""}`;
      }
      if (reason) return `${to}: ${reason}`;
      return `became ${to}`;
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
