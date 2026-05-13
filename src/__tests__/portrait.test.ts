import test from "node:test";
import assert from "node:assert/strict";

import type { RepoCreature } from "../lib/creature";
import type { JournalEvent } from "../lib/events";
import type { NotesState } from "../lib/notes";
import {
  buildPortraitClipboardText,
  buildPortraitModel,
  buildPortraitNoteSummaries,
  cyclePortraitSection,
  PORTRAIT_SECTIONS,
  relativeAgeLabel,
} from "../lib/portrait";

const NOW = new Date("2026-05-11T12:00:00.000Z");

const notesState = (overrides: Partial<NotesState> = {}): NotesState => ({
  index: {
    version: 1,
    active: "n1",
    order: ["n1", "n2"],
    notes: {
      n1: {
        id: "n1",
        name: "blocker",
        createdAt: "2026-05-10T10:00:00.000Z",
        updatedAt: "2026-05-11T09:00:00.000Z",
      },
      n2: {
        id: "n2",
        name: "plan",
        createdAt: "2026-05-09T10:00:00.000Z",
        updatedAt: "2026-05-10T09:00:00.000Z",
      },
    },
  },
  bodies: {
    n1: "build is failing on auth tests\nneed to mock token refresh",
    n2: "ship portrait dashboard next",
  },
  ...overrides,
});

const creature = (overrides: Partial<RepoCreature> = {}): RepoCreature => ({
  id: "alpha",
  scan: {
    id: "alpha",
    path: "/work/alpha",
    name: "alpha",
    branch: "main",
    isDirty: true,
    ahead: 2,
    behind: 1,
    lastCommitSubject: "wire portrait model",
    lastCommitSha: "abcdef123456",
    lastCommitAt: "2026-05-10T11:00:00.000Z",
    primaryLanguage: "TypeScript",
    recentCommitDays: new Array(25).fill(0).concat([1, 0, 2, 0, 1]),
    commitCount: 42,
    recentCommits: [
      {
        sha: "abcdef123456",
        shortSha: "abcdef1",
        subject: "wire portrait model",
        committedAt: "2026-05-10T11:00:00.000Z",
        author: "Sample Author",
      },
    ],
    dirtyChanges: [
      {
        filename: "src/app.ts",
        oldText: "old\ntext",
        newText: "new\ntext\nmore",
        truncated: false,
      },
    ],
    dirtyFiles: [
      {
        filename: "src/app.ts",
        code: " M",
        label: "modified",
        staged: false,
        unstaged: true,
        untracked: false,
      },
    ],
    dirtyFileCount: 1,
  },
  memory: {
    currentBlocker: "build is failing on auth tests",
  },
  vibe: {
    vibe: "blocked",
    reason: "blocker: build is failing on auth tests",
    daysSinceCommit: 1,
  },
  ...overrides,
});

const event = (kind: JournalEvent["kind"], ts: string, payload: Record<string, unknown>): JournalEvent => ({
  ts,
  repoId: "alpha",
  repoName: "alpha",
  kind,
  payload,
});

test("relativeAgeLabel returns compact human labels", () => {
  assert.equal(relativeAgeLabel("2026-05-11T11:59:30.000Z", NOW), "just now");
  assert.equal(relativeAgeLabel("2026-05-11T11:30:00.000Z", NOW), "30m ago");
  assert.equal(relativeAgeLabel("2026-05-10T11:30:00.000Z", NOW), "yesterday");
  assert.equal(relativeAgeLabel(undefined, NOW), "unknown");
});

test("cyclePortraitSection wraps across every section", () => {
  assert.equal(cyclePortraitSection(0, -1), PORTRAIT_SECTIONS.length - 1);
  assert.equal(cyclePortraitSection(PORTRAIT_SECTIONS.length - 1, 1), 0);
});

test("buildPortraitNoteSummaries classifies note signal", () => {
  const summaries = buildPortraitNoteSummaries(notesState(), NOW);
  assert.equal(summaries.length, 2);
  assert.equal(summaries[0].kind, "blocker");
  assert.equal(summaries[0].active, true);
  assert.equal(summaries[0].lineCount, 2);
  assert.match(summaries[1].preview, /portrait dashboard/);
});

test("buildPortraitModel turns repo state into score, actions, events, commits, and changes", () => {
  const model = buildPortraitModel(
    creature(),
    notesState(),
    [
      event("commit", "2026-05-11T08:00:00.000Z", { subject: "finish portrait" }),
      event("note-edited", "2026-05-10T08:00:00.000Z", { name: "plan", charsDelta: 20 }),
    ],
    NOW
  );

  assert.equal(model.score.severity, "error");
  assert.ok(model.score.score < 70);
  assert.ok(model.actions.some((action) => action.id === "blocker"));
  assert.ok(model.actions.some((action) => action.id === "behind"));
  assert.equal(model.events.length, 2);
  assert.equal(model.commits[0].shortSha, "abcdef1");
  assert.equal(model.changes[0].filename, "src/app.ts");
  assert.equal(model.activityBuckets.length, 14);
});

test("buildPortraitClipboardText produces a useful shareable briefing", () => {
  const model = buildPortraitModel(creature(), notesState(), [], NOW);
  const text = buildPortraitClipboardText(creature(), model);

  assert.match(text, /alpha —/);
  assert.match(text, /path: \/work\/alpha/);
  assert.match(text, /next actions:/);
  assert.match(text, /clear the active blocker/);
});
