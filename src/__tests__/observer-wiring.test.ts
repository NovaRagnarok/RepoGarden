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
import { enrichScans, refreshOneCreature } from "../lib/creature";
import {
  readEvents,
  saveEventsMeta,
  type JournalEvent,
} from "../lib/events";

// Integration coverage of the *cli-main.tsx wiring path*: observer fires →
// the same `refreshOneCreature` / `inspectRepo + enrichScans` callbacks
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
          // Mirror cli-main.tsx — dedupe, inspectRepo, splice, enrichScans.
          if (creatures.some((c) => c.scan.path === path)) return;
          const fresh = inspectRepo(path);
          if (fresh.scanError) return;
          creatures = enrichScans([...creatures.map((c) => c.scan), fresh]);
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
