import test from "node:test";
import assert from "node:assert/strict";

import {
  buildActivityBuckets,
  clampJournalIndex,
  computeJournalStats,
  dayLabel,
  eventMatchesQuery,
  filterJournalEvents,
  journalDetailRows,
} from "../lib/journal";
import type { JournalEvent } from "../lib/events";

const event = (
  kind: JournalEvent["kind"],
  repoId: string,
  ts: string,
  payload: Record<string, unknown> = {}
): JournalEvent => ({
  ts,
  repoId,
  repoName: repoId,
  kind,
  payload,
});

test("filterJournalEvents combines scope, kind, range, and search query", () => {
  const now = new Date("2026-05-11T12:00:00.000Z");
  const events: JournalEvent[] = [
    event("commit", "alpha", "2026-05-11T08:00:00.000Z", { subject: "ship journal filters" }),
    event("note-edited", "alpha", "2026-05-10T08:00:00.000Z", { name: "plan", charsDelta: 12 }),
    event("commit", "beta", "2026-04-01T08:00:00.000Z", { subject: "old work" }),
  ];

  const filtered = filterJournalEvents(events, {
    scope: "focused",
    repoId: "alpha",
    kind: "commit",
    range: "7d",
    query: "filters",
    now,
  });

  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].repoId, "alpha");
  assert.equal(filtered[0].kind, "commit");
});

test("eventMatchesQuery searches repo, kind labels, summaries, and payload text", () => {
  const ev = event("branch-switched", "repo-one", "2026-05-11T08:00:00.000Z", {
    from: "main",
    to: "feature/journal",
  });

  assert.equal(eventMatchesQuery(ev, "branch journal"), true);
  assert.equal(eventMatchesQuery(ev, "missing"), false);
});

test("computeJournalStats counts event categories and busiest repo", () => {
  const events: JournalEvent[] = [
    event("commit", "alpha", "2026-05-11T08:00:00.000Z"),
    event("note-created", "alpha", "2026-05-11T09:00:00.000Z"),
    event("note-deleted", "beta", "2026-05-11T10:00:00.000Z"),
    event("blocker-added", "alpha", "2026-05-11T11:00:00.000Z"),
  ];

  const stats = computeJournalStats(events);
  assert.equal(stats.total, 4);
  assert.equal(stats.repoCount, 2);
  assert.equal(stats.commitCount, 1);
  assert.equal(stats.noteCount, 2);
  assert.equal(stats.blockerCount, 1);
  assert.deepEqual(stats.topRepo, { repoName: "alpha", count: 3 });
});

test("buildActivityBuckets counts events oldest to newest by local day", () => {
  const now = new Date("2026-05-11T12:00:00.000Z");
  const events: JournalEvent[] = [
    event("commit", "alpha", "2026-05-09T08:00:00.000Z"),
    event("commit", "alpha", "2026-05-11T08:00:00.000Z"),
    event("commit", "beta", "2026-05-11T09:00:00.000Z"),
  ];

  assert.deepEqual(buildActivityBuckets(events, 3, now), [1, 0, 2]);
});

test("dayLabel uses relative labels for recent days", () => {
  const today = new Date("2026-05-11T12:00:00.000Z");
  assert.equal(dayLabel("2026-05-11T08:00:00.000Z", today), "today");
  assert.equal(dayLabel("2026-05-10T08:00:00.000Z", today), "yesterday");
  assert.equal(dayLabel("2026-05-08T08:00:00.000Z", today), "3 days ago");
});

test("journalDetailRows exposes useful fields for selected event inspector", () => {
  const rows = journalDetailRows(
    event("note-renamed", "alpha", "2026-05-11T08:00:00.000Z", {
      from: "scratch",
      to: "design",
    })
  );

  assert.ok(rows.some((row) => row.label === "from" && row.value === "scratch"));
  assert.ok(rows.some((row) => row.label === "to" && row.value === "design"));
});

test("clampJournalIndex keeps selection valid when filters shrink", () => {
  assert.equal(clampJournalIndex(8, 3), 2);
  assert.equal(clampJournalIndex(-4, 3), 0);
  assert.equal(clampJournalIndex(4, 0), 0);
});
