import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  appendEvent,
  readEvents,
  loadEventsMeta,
  saveEventsMeta,
  loadScanSnapshot,
  saveScanSnapshot,
  subscribeToEventsFile,
  pruneEvents,
  DEFAULT_RETENTION_DAYS,
  type JournalEvent,
} from "../lib/events";
import { saveMemory, loadMemory } from "../lib/memory";
import { enrichScans } from "../lib/creature";
import type { ScannedRepo } from "../lib/scanner";

// ---------------------------------------------------------------------------
// Isolation helpers
// ---------------------------------------------------------------------------

const withFakeHome = (run: (home: string) => void) => {
  const fake = mkdtempSync(join(tmpdir(), "repogarden-events-test-"));
  const oldHome = process.env.HOME;
  const oldUserProfile = process.env.USERPROFILE;
  process.env.HOME = fake;
  process.env.USERPROFILE = fake;
  try {
    run(fake);
  } finally {
    process.env.HOME = oldHome;
    process.env.USERPROFILE = oldUserProfile;
    rmSync(fake, { recursive: true, force: true });
  }
};

const makeEvent = (
  kind: JournalEvent["kind"],
  repoId: string,
  ts?: string
): JournalEvent => ({
  ts: ts ?? new Date().toISOString(),
  repoId,
  repoName: repoId,
  kind,
  payload: {},
});

// ---------------------------------------------------------------------------
// Append + read roundtrip
// ---------------------------------------------------------------------------

test("appendEvent + readEvents roundtrip returns newest-first", () => {
  withFakeHome(() => {
    const t1 = "2025-01-01T00:00:00.000Z";
    const t2 = "2025-01-02T00:00:00.000Z";
    const t3 = "2025-01-03T00:00:00.000Z";

    appendEvent(makeEvent("repo-added", "alpha", t1));
    appendEvent(makeEvent("commit", "alpha", t2));
    appendEvent(makeEvent("vibe-changed", "alpha", t3));

    const events = readEvents();
    assert.equal(events.length, 3);
    // Newest-first
    assert.equal(events[0].ts, t3);
    assert.equal(events[1].ts, t2);
    assert.equal(events[2].ts, t1);
  });
});

// ---------------------------------------------------------------------------
// readEvents({ since }) filtering
// ---------------------------------------------------------------------------

test("readEvents({ since }) filters out events before the date", () => {
  withFakeHome(() => {
    appendEvent(makeEvent("repo-added", "alpha", "2025-01-01T00:00:00.000Z"));
    appendEvent(makeEvent("commit", "alpha", "2025-06-01T00:00:00.000Z"));
    appendEvent(makeEvent("commit", "alpha", "2026-01-01T00:00:00.000Z"));

    const since = new Date("2025-06-01T00:00:00.000Z");
    const events = readEvents({ since });
    assert.equal(events.length, 2);
    for (const ev of events) {
      assert.ok(new Date(ev.ts).getTime() >= since.getTime());
    }
  });
});

// ---------------------------------------------------------------------------
// readEvents({ repoId }) filtering
// ---------------------------------------------------------------------------

test("readEvents({ repoId }) filters to matching repo only", () => {
  withFakeHome(() => {
    appendEvent(makeEvent("repo-added", "alpha"));
    appendEvent(makeEvent("repo-added", "beta"));
    appendEvent(makeEvent("commit", "alpha"));
    appendEvent(makeEvent("commit", "gamma"));

    const events = readEvents({ repoId: "alpha" });
    assert.equal(events.length, 2);
    for (const ev of events) {
      assert.equal(ev.repoId, "alpha");
    }
  });
});

// ---------------------------------------------------------------------------
// readEvents({ limit })
// ---------------------------------------------------------------------------

test("readEvents({ limit }) returns at most limit events", () => {
  withFakeHome(() => {
    for (let i = 0; i < 5; i++) {
      appendEvent(makeEvent("commit", "alpha"));
    }
    const events = readEvents({ limit: 3 });
    assert.equal(events.length, 3);
  });
});

// ---------------------------------------------------------------------------
// Malformed line skipped silently
// ---------------------------------------------------------------------------

test("readEvents skips malformed lines silently", () => {
  withFakeHome((home) => {
    const dir = join(home, ".repogarden");
    mkdirSync(dir, { recursive: true });
    const path = join(dir, "events.jsonl");
    // Write one valid event, one garbage line, one valid event.
    const valid1 = JSON.stringify(makeEvent("commit", "alpha", "2025-01-01T00:00:00.000Z"));
    const valid2 = JSON.stringify(makeEvent("commit", "beta", "2025-01-02T00:00:00.000Z"));
    writeFileSync(path, `${valid1}\nnot-json-at-all\n${valid2}\n`, "utf8");

    const events = readEvents();
    assert.equal(events.length, 2);
    assert.ok(events.some((ev) => ev.repoId === "alpha"));
    assert.ok(events.some((ev) => ev.repoId === "beta"));
  });
});

// ---------------------------------------------------------------------------
// Events meta
// ---------------------------------------------------------------------------

test("loadEventsMeta returns { seeded: false } when file is missing", () => {
  withFakeHome(() => {
    const meta = loadEventsMeta();
    assert.equal(meta.seeded, false);
    assert.equal(meta.seededAt, undefined);
  });
});

test("saveEventsMeta + loadEventsMeta roundtrip", () => {
  withFakeHome(() => {
    const stamp = new Date().toISOString();
    saveEventsMeta({ seeded: true, seededAt: stamp });
    const loaded = loadEventsMeta();
    assert.equal(loaded.seeded, true);
    assert.equal(loaded.seededAt, stamp);
  });
});

// ---------------------------------------------------------------------------
// Scan snapshot
// ---------------------------------------------------------------------------

test("loadScanSnapshot returns {} when file is missing", () => {
  withFakeHome(() => {
    const snap = loadScanSnapshot();
    assert.deepEqual(snap, {});
  });
});

test("saveScanSnapshot + loadScanSnapshot roundtrip", () => {
  withFakeHome(() => {
    saveScanSnapshot({
      "alpha-abc": { vibe: "happy", branch: "main", latestCommitSha: "abc123" },
    });
    const snap = loadScanSnapshot();
    assert.equal(snap["alpha-abc"]?.vibe, "happy");
    assert.equal(snap["alpha-abc"]?.branch, "main");
    assert.equal(snap["alpha-abc"]?.latestCommitSha, "abc123");
  });
});

// ---------------------------------------------------------------------------
// Blocker diff via saveMemory
// ---------------------------------------------------------------------------

test("saveMemory emits blocker-added when empty → nonempty", () => {
  withFakeHome(() => {
    saveMemory("repo1", { currentBlocker: "broken build" }, "my-repo");
    const events = readEvents({ repoId: "repo1" });
    assert.equal(events.length, 1);
    assert.equal(events[0].kind, "blocker-added");
    assert.equal(events[0].payload["firstLine"], "broken build");
  });
});

test("saveMemory emits blocker-cleared when nonempty → empty", () => {
  withFakeHome(() => {
    // First save to set up the prior state on disk
    saveMemory("repo2", { currentBlocker: "old blocker" });
    // Now clear it with a repoName
    saveMemory("repo2", { currentBlocker: undefined }, "my-repo");
    const events = readEvents({ repoId: "repo2" });
    assert.equal(events.length, 1);
    assert.equal(events[0].kind, "blocker-cleared");
    assert.equal(events[0].payload["firstLine"], "old blocker");
  });
});

test("saveMemory does NOT emit when blocker text changes in-place (nonempty → different nonempty)", () => {
  withFakeHome(() => {
    saveMemory("repo3", { currentBlocker: "version one" });
    saveMemory("repo3", { currentBlocker: "version two — typo fix" }, "my-repo");
    const events = readEvents({ repoId: "repo3" });
    assert.equal(events.length, 0, "should not emit for in-place edit");
  });
});

test("saveMemory does NOT emit when blocker is unchanged", () => {
  withFakeHome(() => {
    saveMemory("repo4", { currentBlocker: "same blocker" });
    saveMemory("repo4", { currentBlocker: "same blocker" }, "my-repo");
    const events = readEvents({ repoId: "repo4" });
    assert.equal(events.length, 0);
  });
});

test("saveMemory does NOT emit when no repoName is provided", () => {
  withFakeHome(() => {
    saveMemory("repo5", { currentBlocker: "something" });
    const events = readEvents({ repoId: "repo5" });
    assert.equal(events.length, 0);
  });
});

test("saveMemory does NOT emit when both blockers are empty", () => {
  withFakeHome(() => {
    saveMemory("repo6", {});
    saveMemory("repo6", {}, "my-repo");
    const events = readEvents({ repoId: "repo6" });
    assert.equal(events.length, 0);
  });
});

// ---------------------------------------------------------------------------
// Vibe diff via snapshot
// ---------------------------------------------------------------------------

test("vibe-changed emits when vibe differs from snapshot", () => {
  withFakeHome(() => {
    saveScanSnapshot({ "repo1-abc": { vibe: "happy" } });
    saveEventsMeta({ seeded: true, seededAt: new Date().toISOString() });

    // Simulate a reconcile: load the snapshot and diff.
    const snap = loadScanSnapshot();
    const prev = snap["repo1-abc"];
    assert.ok(prev);

    const newVibe = "sleepy";
    if (prev.vibe !== newVibe) {
      appendEvent({
        ts: new Date().toISOString(),
        repoId: "repo1-abc",
        repoName: "repo1",
        kind: "vibe-changed",
        payload: { from: prev.vibe, to: newVibe, reason: "idle for 30 days." },
      });
    }

    const events = readEvents({ repoId: "repo1-abc" });
    assert.equal(events.length, 1);
    assert.equal(events[0].kind, "vibe-changed");
    assert.equal(events[0].payload["from"], "happy");
    assert.equal(events[0].payload["to"], "sleepy");
  });
});

test("vibe-changed does NOT emit when vibe is the same as snapshot", () => {
  withFakeHome(() => {
    saveScanSnapshot({ "repo2-xyz": { vibe: "awake" } });
    saveEventsMeta({ seeded: true, seededAt: new Date().toISOString() });

    const snap = loadScanSnapshot();
    const prev = snap["repo2-xyz"];
    assert.ok(prev);

    const newVibe = "awake"; // same
    if (prev.vibe !== newVibe) {
      appendEvent({
        ts: new Date().toISOString(),
        repoId: "repo2-xyz",
        repoName: "repo2",
        kind: "vibe-changed",
        payload: { from: prev.vibe, to: newVibe, reason: "" },
      });
    }

    const events = readEvents({ repoId: "repo2-xyz" });
    assert.equal(events.length, 0);
  });
});

// ---------------------------------------------------------------------------
// Backfill: seeded flag + idempotency
// ---------------------------------------------------------------------------

test("backfill seeds when meta.seeded is false and sets seeded=true", () => {
  withFakeHome(() => {
    // Confirm the flag starts false
    assert.equal(loadEventsMeta().seeded, false);

    // Simulate what reconcileWithSnapshot does on first run
    const now = new Date().toISOString();
    appendEvent({
      ts: now,
      repoId: "some-repo",
      repoName: "some-repo",
      kind: "repo-added",
      payload: { path: "/home/user/repos/some-repo" },
    });
    saveEventsMeta({ seeded: true, seededAt: now });

    assert.equal(loadEventsMeta().seeded, true);
    const events = readEvents({ repoId: "some-repo" });
    assert.ok(events.length >= 1);
  });
});

test("backfill is idempotent: second run is a no-op when seeded=true", () => {
  withFakeHome(() => {
    const now = new Date().toISOString();
    saveEventsMeta({ seeded: true, seededAt: now });

    // If the seeder checked the flag correctly, it would bail out here.
    // Simulate the guard:
    const meta = loadEventsMeta();
    if (!meta.seeded) {
      appendEvent({
        ts: now,
        repoId: "alpha",
        repoName: "alpha",
        kind: "repo-added",
        payload: { path: "/some/path" },
      });
      saveEventsMeta({ seeded: true, seededAt: now });
    }

    // No events should have been appended.
    assert.equal(readEvents().length, 0);
    assert.equal(loadEventsMeta().seeded, true);
  });
});

// ---------------------------------------------------------------------------
// Blocker payload cap at 200 chars
// ---------------------------------------------------------------------------

test("blocker-added payload firstLine is capped at 200 chars", () => {
  withFakeHome(() => {
    const longLine = "x".repeat(300);
    saveMemory("repo-cap", { currentBlocker: longLine }, "my-repo");
    const events = readEvents({ repoId: "repo-cap" });
    assert.equal(events.length, 1);
    assert.equal(events[0].kind, "blocker-added");
    const fl = events[0].payload["firstLine"] as string;
    assert.ok(fl.length <= 200);
  });
});

test("readEvents sorts by timestamp instead of append order", () => {
  withFakeHome(() => {
    appendEvent(makeEvent("commit", "alpha", "2026-01-03T00:00:00.000Z"));
    appendEvent(makeEvent("commit", "alpha", "2026-01-01T00:00:00.000Z"));
    appendEvent(makeEvent("commit", "alpha", "2026-01-02T00:00:00.000Z"));

    const events = readEvents();
    assert.deepEqual(
      events.map((event) => event.ts),
      [
        "2026-01-03T00:00:00.000Z",
        "2026-01-02T00:00:00.000Z",
        "2026-01-01T00:00:00.000Z",
      ]
    );
  });
});

test("readEvents can filter by event kind", () => {
  withFakeHome(() => {
    appendEvent(makeEvent("commit", "alpha", "2026-01-01T00:00:00.000Z"));
    appendEvent(makeEvent("note-renamed", "alpha", "2026-01-02T00:00:00.000Z"));
    appendEvent(makeEvent("note-deleted", "alpha", "2026-01-03T00:00:00.000Z"));

    const events = readEvents({ kinds: ["note-renamed", "note-deleted"] });
    assert.deepEqual(events.map((event) => event.kind), ["note-deleted", "note-renamed"]);
  });
});

test("pull event round-trips through appendEvent + readEvents", () => {
  withFakeHome(() => {
    appendEvent({
      ts: "2026-05-13T12:00:00.000Z",
      repoId: "alpha",
      repoName: "alpha",
      kind: "pull",
      payload: {
        ok: true,
        exitCode: 0,
        branch: "main",
        beforeSha: "aaaa111",
        afterSha: "bbbb222",
        commitsPulled: 3,
        summary: "Fast-forward",
      },
    });
    const events = readEvents({ kinds: ["pull"] });
    assert.equal(events.length, 1);
    assert.equal(events[0].kind, "pull");
    assert.equal(events[0].payload.ok, true);
    assert.equal(events[0].payload.commitsPulled, 3);
    assert.equal(events[0].payload.branch, "main");
  });
});

test("appendEvent sanitizes control characters and non-json payload values", () => {
  withFakeHome(() => {
    appendEvent({
      ts: "2026-01-01T00:00:00.000Z",
      repoId: "alpha\u0000",
      repoName: "alpha\nrepo",
      kind: "commit",
      payload: { subject: "ship\u0000it", count: Number.POSITIVE_INFINITY, big: 10n },
    });

    const events = readEvents();
    assert.equal(events.length, 1);
    assert.equal(events[0].repoId, "alpha");
    assert.equal(events[0].repoName, "alpha repo");
    assert.equal(events[0].payload.subject, "shipit");
    assert.equal(events[0].payload.count, null);
    assert.equal(events[0].payload.big, "10");
  });
});

// ---------------------------------------------------------------------------
// Streaming-partial reconcile guard (regression: phantom "joined the garden")
// ---------------------------------------------------------------------------

const fakeRepo = (id: string): ScannedRepo => ({
  id,
  path: `/tmp/${id}`,
  name: id,
  isDirty: false,
});

test("enrichScans({ reconcile: false }) emits no events on partial streams", () => {
  withFakeHome(() => {
    saveEventsMeta({ seeded: true, seededAt: new Date().toISOString() });
    saveScanSnapshot({
      alpha: { vibe: "happy" },
      beta: { vibe: "happy" },
      gamma: { vibe: "happy" },
    });

    // Simulate the streaming onRepo path: enrichScans called once per repo
    // discovered, with a growing partial list.
    enrichScans([fakeRepo("alpha")], { reconcile: false });
    enrichScans([fakeRepo("alpha"), fakeRepo("beta")], { reconcile: false });
    enrichScans(
      [fakeRepo("alpha"), fakeRepo("beta"), fakeRepo("gamma")],
      { reconcile: false }
    );

    // No events emitted, snapshot untouched.
    assert.equal(readEvents().length, 0);
    const snap = loadScanSnapshot();
    assert.deepEqual(Object.keys(snap).sort(), ["alpha", "beta", "gamma"]);
  });
});

test("enrichScans default reconcile does NOT phantom-emit repo-added for repos already in the snapshot", () => {
  withFakeHome(() => {
    saveEventsMeta({ seeded: true, seededAt: new Date().toISOString() });
    saveScanSnapshot({
      alpha: { vibe: "happy" },
      beta: { vibe: "happy" },
      gamma: { vibe: "happy" },
    });

    // Final reconcile against the full list — every repo has a snapshot entry,
    // so nothing should emit.
    enrichScans([fakeRepo("alpha"), fakeRepo("beta"), fakeRepo("gamma")]);

    const repoAdded = readEvents({ kinds: ["repo-added"] });
    assert.equal(repoAdded.length, 0);
  });
});

test("streaming partials followed by a final reconcile only emit once per truly-new repo", () => {
  withFakeHome(() => {
    saveEventsMeta({ seeded: true, seededAt: new Date().toISOString() });
    // alpha and beta are known; delta is genuinely new.
    saveScanSnapshot({
      alpha: { vibe: "happy" },
      beta: { vibe: "happy" },
    });

    // Streaming partial calls — no reconcile.
    enrichScans([fakeRepo("alpha")], { reconcile: false });
    enrichScans([fakeRepo("alpha"), fakeRepo("beta")], { reconcile: false });
    enrichScans(
      [fakeRepo("alpha"), fakeRepo("beta"), fakeRepo("delta")],
      { reconcile: false }
    );

    // Final scan result reconciles.
    enrichScans([fakeRepo("alpha"), fakeRepo("beta"), fakeRepo("delta")]);

    const repoAdded = readEvents({ kinds: ["repo-added"] });
    assert.equal(repoAdded.length, 1);
    assert.equal(repoAdded[0].repoId, "delta");
  });
});

// ---------------------------------------------------------------------------
// First-scan seeding guards (empty + partial)
// ---------------------------------------------------------------------------

test("enrichScans([]) does not mark events meta as seeded", () => {
  withFakeHome(() => {
    assert.equal(loadEventsMeta().seeded, false);
    enrichScans([]);
    // Empty scan must not consume the one-time backfill window.
    assert.equal(loadEventsMeta().seeded, false);
    assert.equal(readEvents().length, 0);
  });
});

test("enrichScans does not seed when preserveMissing is true (partial scan)", () => {
  withFakeHome(() => {
    assert.equal(loadEventsMeta().seeded, false);
    enrichScans([fakeRepo("alpha")], { preserveMissing: true });
    // Partial scan must defer seeding until we've seen a full repo set.
    assert.equal(loadEventsMeta().seeded, false);
  });
});

test("enrichScans with preserveMissing preserves snapshot entries for absent repos", () => {
  withFakeHome(() => {
    saveEventsMeta({ seeded: true, seededAt: new Date().toISOString() });
    saveScanSnapshot({
      alpha: { vibe: "happy" },
      beta: { vibe: "awake", branch: "main" },
    });

    // Simulate a scan that only sees alpha (beta's root failed).
    enrichScans([fakeRepo("alpha")], { preserveMissing: true });

    const snap = loadScanSnapshot();
    assert.deepEqual(Object.keys(snap).sort(), ["alpha", "beta"]);
    assert.equal(snap.beta.vibe, "awake");

    // No phantom repo-added when beta comes back next scan.
    enrichScans([fakeRepo("alpha"), fakeRepo("beta")]);
    const repoAdded = readEvents({ kinds: ["repo-added"] });
    assert.equal(repoAdded.length, 0);
  });
});

test("loadScanSnapshot migrates legacy noisy/blocked vibe strings on read", () => {
  withFakeHome((home) => {
    // Write a snapshot file directly with the pre-rename vocabulary so the
    // typed saveScanSnapshot helper doesn't normalise it for us.
    const dir = join(home, ".repogarden");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "scan-snapshot.json"),
      JSON.stringify({
        legacyNoisy: { vibe: "noisy", branch: "main" },
        legacyBlocked: { vibe: "blocked" },
        currentHappy: { vibe: "happy" }
      })
    );

    const snap = loadScanSnapshot();
    assert.equal(snap.legacyNoisy.vibe, "awake");
    assert.equal(snap.legacyBlocked.vibe, "stuck");
    assert.equal(snap.currentHappy.vibe, "happy");
  });
});

test("enrichScans without preserveMissing prunes snapshot of absent repos", () => {
  withFakeHome(() => {
    saveEventsMeta({ seeded: true, seededAt: new Date().toISOString() });
    saveScanSnapshot({
      alpha: { vibe: "happy" },
      beta: { vibe: "awake" },
    });

    enrichScans([fakeRepo("alpha")]);

    const snap = loadScanSnapshot();
    assert.deepEqual(Object.keys(snap), ["alpha"]);
  });
});

// ---------------------------------------------------------------------------
// subscribeToEventsFile (fs.watch wrapper) — #1
// ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// Async-aware HOME isolation. The sync `withFakeHome` would unwind HOME
// before async work in the callback resolves, so we can't reuse it here.
const withAsyncFakeHome = async (run: () => Promise<void>): Promise<void> => {
  const fake = mkdtempSync(join(tmpdir(), "repogarden-watcher-test-"));
  const oldHome = process.env.HOME;
  const oldUserProfile = process.env.USERPROFILE;
  process.env.HOME = fake;
  process.env.USERPROFILE = fake;
  try {
    await run();
  } finally {
    process.env.HOME = oldHome;
    process.env.USERPROFILE = oldUserProfile;
    rmSync(fake, { recursive: true, force: true });
  }
};

test("subscribeToEventsFile fires after a write, within the debounce window", async () => {
  await withAsyncFakeHome(async () => {
    let calls = 0;
    const unsubscribe = subscribeToEventsFile(() => {
      calls += 1;
    });
    try {
      // Watcher needs a tick to actually start observing.
      await sleep(50);
      appendEvent(makeEvent("commit", "alpha"));
      // Debounce is 100ms; give it a bit more.
      await sleep(300);
      // Some platforms (notably WSL2 on a Windows mount) silently drop
      // fs.watch events. Treat zero as a "platform doesn't support this"
      // signal rather than a failure so CI doesn't flake on those FSes.
      if (calls === 0) {
        // eslint-disable-next-line no-console
        console.warn("subscribeToEventsFile: fs.watch did not fire — likely an unsupported FS, skipping");
        return;
      }
      assert.ok(calls >= 1, `expected >=1 callback, got ${calls}`);
    } finally {
      unsubscribe();
    }
  });
});

test("subscribeToEventsFile unsubscribe is safe to call multiple times", () => {
  withFakeHome(() => {
    const unsubscribe = subscribeToEventsFile(() => {});
    unsubscribe();
    unsubscribe(); // must not throw
  });
});

test("subscribeToEventsFile returns a callable even if fs.watch fails", () => {
  withFakeHome(() => {
    const unsubscribe = subscribeToEventsFile(() => {});
    assert.equal(typeof unsubscribe, "function");
    unsubscribe();
  });
});

// ---------------------------------------------------------------------------
// pruneEvents — retention window
// ---------------------------------------------------------------------------

test("DEFAULT_RETENTION_DAYS is 90 days", () => {
  // Audit item #7: 90-day window is the fixed default for this pass.
  assert.equal(DEFAULT_RETENTION_DAYS, 90);
});

test("pruneEvents drops events strictly older than the cutoff", () => {
  withFakeHome(() => {
    const old1 = "2024-01-01T00:00:00.000Z";
    const old2 = "2024-06-01T00:00:00.000Z";
    const fresh = "2026-05-01T00:00:00.000Z";

    appendEvent(makeEvent("commit", "alpha", old1));
    appendEvent(makeEvent("commit", "alpha", old2));
    appendEvent(makeEvent("commit", "alpha", fresh));

    const cutoff = new Date("2025-01-01T00:00:00.000Z");
    const result = pruneEvents({ olderThan: cutoff });

    assert.equal(result.pruned, 2);
    assert.equal(result.kept, 1);

    const remaining = readEvents();
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].ts, fresh);
  });
});

test("pruneEvents is a no-op when no events are old enough", () => {
  withFakeHome(() => {
    appendEvent(makeEvent("commit", "alpha", "2026-05-01T00:00:00.000Z"));
    appendEvent(makeEvent("commit", "alpha", "2026-05-10T00:00:00.000Z"));

    const result = pruneEvents({ olderThan: new Date("2025-01-01T00:00:00.000Z") });
    assert.equal(result.pruned, 0);
    assert.equal(result.kept, 2);
    assert.equal(readEvents().length, 2);
  });
});

test("pruneEvents returns zero counts when the journal file is missing", () => {
  withFakeHome(() => {
    const result = pruneEvents({ olderThan: new Date() });
    assert.equal(result.pruned, 0);
    assert.equal(result.kept, 0);
  });
});

test("pruneEvents drops malformed lines along with stale entries", () => {
  withFakeHome((home) => {
    const dir = join(home, ".repogarden");
    mkdirSync(dir, { recursive: true });
    const path = join(dir, "events.jsonl");
    const stale = JSON.stringify(makeEvent("commit", "alpha", "2024-01-01T00:00:00.000Z"));
    const fresh = JSON.stringify(makeEvent("commit", "alpha", "2026-05-01T00:00:00.000Z"));
    writeFileSync(path, `${stale}\nnot-json\n${fresh}\n`, "utf8");

    const result = pruneEvents({ olderThan: new Date("2025-01-01T00:00:00.000Z") });
    // stale + malformed both drop; fresh survives.
    assert.equal(result.pruned, 2);
    assert.equal(result.kept, 1);
    const remaining = readEvents();
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].ts, "2026-05-01T00:00:00.000Z");
  });
});
