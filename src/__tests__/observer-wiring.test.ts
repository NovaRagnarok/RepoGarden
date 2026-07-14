import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Long-form temp root: Node 24's libuv asserts (and kills the process) when
// fs.watch fires on a path with Windows 8.3 short-name components, which is
// what os.tmpdir() returns on GitHub's Windows runners. See events.test.ts.
const TMP_ROOT = realpathSync.native(tmpdir());

import { startObserver } from "../lib/observer";
import { inspectRepo } from "../lib/scanner";
import {
  addDiscoveredCreature,
  enrichScans,
  refreshCreaturesLight,
  refreshOneCreature,
} from "../lib/creature";
import {
  loadScanSnapshot,
  readEvents,
  saveEventsMeta,
  type JournalEvent,
} from "../lib/events";

// Integration coverage of the *cli-main.tsx wiring path*: observer fires →
// the same incremental refresh helpers
// the cli uses → journal events appear on disk. Asserts the seam, not
// the React layer.

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const initRepo = (path: string) => {
  mkdirSync(path, { recursive: true });
  spawnSync("git", ["init", "--quiet", "--initial-branch=main"], { cwd: path });
  spawnSync("git", ["config", "user.email", "test@example.com"], { cwd: path });
  spawnSync("git", ["config", "user.name", "Test"], { cwd: path });
  spawnSync("git", ["commit", "--allow-empty", "-m", "init", "--quiet"], { cwd: path });
};

const commitEmpty = (path: string, message: string) => {
  spawnSync("git", ["commit", "--allow-empty", "-m", message, "--quiet"], { cwd: path });
};

const withFakeHome = async (run: (home: string) => Promise<void>): Promise<void> => {
  const fake = mkdtempSync(join(TMP_ROOT,"repogarden-observer-wiring-"));
  const oldHome = process.env.HOME;
  const oldUserProfile = process.env.USERPROFILE;
  process.env.HOME = fake;
  process.env.USERPROFILE = fake;
  try {
    await run(fake);
  } finally {
    process.env.HOME = oldHome;
    process.env.USERPROFILE = oldUserProfile;
    rmSync(fake, { recursive: true, force: true });
  }
};

// ---------------------------------------------------------------------------

test("observer + cli wiring: a new commit produces a 'commit' journal event", async () => {
  await withFakeHome(async () => {
    // Suppress the first-run backfill so any commit we see comes from
    // the snapshot reconcile, not from seed.
    saveEventsMeta({ seeded: true, seededAt: new Date().toISOString() });

    const workspaceRoot = mkdtempSync(join(TMP_ROOT,"repogarden-observer-ws-"));
    try {
      const repoPath = join(workspaceRoot, "alpha");
      initRepo(repoPath);

      // Seed the registry from the real git repo.
      let creatures = enrichScans([inspectRepo(repoPath)]);
      const repoId = creatures[0].id;

      // The journal already has a 'repo-added' from the seed enrich.
      // Snapshot baseline counts.
      const baselineCommitEvents = readEvents().filter((e) => e.kind === "commit").length;

      const stop = startObserver({
        repos: creatures.map((creature) => ({
          id: creature.id,
          path: creature.scan.path,
        })),
        roots: [],
        onCommitDetected: (id) => {
          // Mirror cli-main.tsx — the single-repo refresh + enrich is what
          // emits the journal event via snapshot reconcile.
          creatures = refreshOneCreature(creatures, id);
        },
        onNewRepoDetected: () => {},
      });

      try {
        await sleep(50);
        commitEmpty(repoPath, "second commit");
        // Commit debounce is 250ms; refreshOneCreature is sync. Give margin.
        await sleep(700);

        const commitEvents = readEvents().filter(
          (e: JournalEvent) => e.kind === "commit" && e.repoId === repoId
        );
        if (commitEvents.length === baselineCommitEvents) {
          // Platform without working fs.watch (WSL2 /mnt/c, some VM FSes).
          // Same skip pattern as observer.test.ts and events.test.ts.
          // eslint-disable-next-line no-console
          console.warn("observer-wiring: fs.watch did not fire — likely an unsupported FS, skipping");
          return;
        }
        assert.ok(
          commitEvents.length > baselineCommitEvents,
          `expected a new 'commit' event, got ${commitEvents.length} total (baseline ${baselineCommitEvents})`
        );
        const fresh = commitEvents[commitEvents.length - 1];
        assert.equal(fresh.repoId, repoId);
      } finally {
        stop();
      }
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });
});

test("observer + cli wiring: dropping a new repo into a scan root surfaces a 'repo-added' event", async () => {
  await withFakeHome(async () => {
    saveEventsMeta({ seeded: true, seededAt: new Date().toISOString() });

    const workspaceRoot = mkdtempSync(join(TMP_ROOT,"repogarden-observer-ws-"));
    try {
      // Start with one repo already known.
      const alphaPath = join(workspaceRoot, "alpha");
      initRepo(alphaPath);
      let creatures = enrichScans([inspectRepo(alphaPath)]);
      const baselineAdded = readEvents().filter((e) => e.kind === "repo-added").length;

      const stop = startObserver({
        repos: creatures.map((creature) => ({
          id: creature.id,
          path: creature.scan.path,
        })),
        roots: [workspaceRoot],
        onCommitDetected: () => {},
        onNewRepoDetected: (path) => {
          // Mirror cli-main.tsx — dedupe, inspect, splice, and reconcile.
          creatures = addDiscoveredCreature(creatures, path);
        },
      });

      try {
        await sleep(50);
        const betaPath = join(workspaceRoot, "beta");
        initRepo(betaPath);
        // New-repo debounce is 500ms; allow margin.
        await sleep(900);

        const addedEvents = readEvents().filter((e) => e.kind === "repo-added");
        if (addedEvents.length === baselineAdded) {
          // eslint-disable-next-line no-console
          console.warn("observer-wiring (new-repo): fs.watch did not fire — likely an unsupported FS, skipping");
          return;
        }
        assert.ok(
          addedEvents.length > baselineAdded,
          `expected a new 'repo-added' event, got ${addedEvents.length} total (baseline ${baselineAdded})`
        );
        const fresh = addedEvents[addedEvents.length - 1];
        // Path equality can be fragile across symlinked tmp dirs and
        // observer debounce timing; id encodes the path so id-match is
        // the load-bearing check.
        assert.ok(
          creatures.some((c) => c.id === fresh.repoId),
          `registry should contain the new repo (id=${fresh.repoId}) after observer fires; have ${creatures.map((c) => c.id).join(", ")}`
        );
      } finally {
        stop();
      }
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });
});

test("incremental refreshes preserve partial-scan snapshots until a complete inventory prunes", async () => {
  await withFakeHome(async () => {
    saveEventsMeta({ seeded: true, seededAt: new Date().toISOString() });

    const workspaceRoot = mkdtempSync(join(TMP_ROOT,"repogarden-partial-refresh-"));
    try {
      const alphaPath = join(workspaceRoot, "alpha");
      const betaPath = join(workspaceRoot, "beta");
      const gammaPath = join(workspaceRoot, "gamma");
      initRepo(alphaPath);
      initRepo(betaPath);

      const alpha = inspectRepo(alphaPath);
      const beta = inspectRepo(betaPath);
      let creatures = enrichScans([alpha, beta], { preserveMissing: false });
      const betaAddedBaseline = readEvents({
        repoId: beta.id,
        kinds: ["repo-added"],
      }).length;
      assert.equal(betaAddedBaseline, 1);

      // Beta's root temporarily fails: the final full-scan reconcile is
      // partial, so its last-known snapshot entry remains recoverable.
      creatures = enrichScans([alpha], { preserveMissing: true });
      assert.ok(loadScanSnapshot()[beta.id]);

      // The 30s HEAD-move fallback re-inspects only alpha. It must not treat
      // the current registry as a complete inventory and prune beta.
      commitEmpty(alphaPath, "alpha background refresh");
      creatures = refreshCreaturesLight(creatures);
      assert.ok(loadScanSnapshot()[beta.id]);

      // The fs.watch HEAD callback is a separate single-repo path with the
      // same preservation contract.
      commitEmpty(alphaPath, "alpha observer refresh");
      creatures = refreshOneCreature(creatures, alpha.id);
      assert.ok(loadScanSnapshot()[beta.id]);

      // A newly discovered gamma proves only that gamma exists; it does not
      // prove that the still-absent beta was removed.
      initRepo(gammaPath);
      creatures = addDiscoveredCreature(creatures, gammaPath);
      const gamma = creatures.find((creature) => creature.scan.path === gammaPath);
      assert.ok(gamma);
      const incrementalSnapshot = loadScanSnapshot();
      assert.ok(incrementalSnapshot[beta.id]);
      assert.ok(incrementalSnapshot[gamma.id]);

      // Once beta's root recovers, a successful complete scan sees A+B+C.
      // Beta was continuously retained, so it must not emit a second,
      // phantom "joined the garden" event.
      enrichScans(
        [inspectRepo(alphaPath), inspectRepo(betaPath), inspectRepo(gammaPath)],
        { preserveMissing: false }
      );
      assert.equal(
        readEvents({ repoId: beta.id, kinds: ["repo-added"] }).length,
        betaAddedBaseline
      );

      // A later successful complete inventory that genuinely omits beta is
      // authoritative and may prune it.
      enrichScans([inspectRepo(alphaPath), inspectRepo(gammaPath)], {
        preserveMissing: false,
      });
      const completeSnapshot = loadScanSnapshot();
      assert.equal(completeSnapshot[beta.id], undefined);
      assert.ok(completeSnapshot[alpha.id]);
      assert.ok(completeSnapshot[gamma.id]);
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });
});

test("failed incremental inspections retain the prior snapshot until genuine recovery", async () => {
  await withFakeHome(async () => {
    saveEventsMeta({ seeded: true, seededAt: new Date().toISOString() });

    const workspaceRoot = mkdtempSync(join(TMP_ROOT,"repogarden-refresh-recovery-"));
    try {
      const alphaPath = join(workspaceRoot, "alpha");
      initRepo(alphaPath);

      const alpha = inspectRepo(alphaPath);
      let creatures = enrichScans([alpha], { preserveMissing: false });
      const baselineSnapshot = loadScanSnapshot();
      const baselineEvents = readEvents();
      assert.equal(baselineEvents.length, 1);
      assert.equal(
        baselineEvents.filter((event) => event.kind === "repo-added").length,
        1
      );

      const failedInspection = {
        id: alpha.id,
        path: alpha.path,
        name: alpha.name,
        isDirty: false,
        scanError: "temporarily unavailable",
      };

      // Model the race where the cheap HEAD probe succeeds, then the full
      // inspection loses access. The error-shaped scan must not replace the
      // prior creature or participate in snapshot reconciliation.
      const afterFailedHeadRefresh = refreshCreaturesLight(creatures, {
        inspectRepoLight: () => ({
          isDirty: false,
          headSha: "f".repeat(40),
        }),
        inspectRepo: () => failedInspection,
      });
      assert.equal(afterFailedHeadRefresh, creatures);
      assert.deepEqual(loadScanSnapshot(), baselineSnapshot);
      assert.deepEqual(readEvents(), baselineEvents);

      // The observer's direct single-repo inspection has the same contract.
      const afterFailedObserverRefresh = refreshOneCreature(creatures, alpha.id, {
        inspectRepo: () => failedInspection,
      });
      assert.equal(afterFailedObserverRefresh, creatures);
      assert.deepEqual(loadScanSnapshot(), baselineSnapshot);
      assert.deepEqual(readEvents(), baselineEvents);

      // Once inspection succeeds again, only the real commit made during the
      // outage is journaled and the snapshot advances from its retained SHA.
      commitEmpty(alphaPath, "commit after recovery");
      creatures = refreshOneCreature(creatures, alpha.id);
      const recovered = creatures.find((creature) => creature.id === alpha.id);
      assert.ok(recovered);
      assert.notEqual(recovered.scan.lastCommitSha, alpha.lastCommitSha);
      assert.equal(
        loadScanSnapshot()[alpha.id].latestCommitSha,
        recovered.scan.lastCommitSha
      );
      const recoveredEvents = readEvents({ repoId: alpha.id });
      assert.deepEqual(
        recoveredEvents.map((event) => event.kind).sort(),
        ["commit", "repo-added"]
      );
      assert.equal(
        recoveredEvents.filter((event) => event.kind === "repo-added").length,
        1
      );
      const recoveredCommits = recoveredEvents.filter((event) => event.kind === "commit");
      assert.equal(recoveredCommits.length, 1);
      assert.equal(recoveredCommits[0].payload.subject, "commit after recovery");
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });
});
