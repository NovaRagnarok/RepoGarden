import { performance } from "node:perf_hooks";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { argv } from "node:process";
import { join } from "node:path";

import { scanRoots, scanRootsProgressive } from "../src/lib/scanner";

const root = argv[2];
if (!root) {
  console.error("Usage: tsx scripts/bench-scan.ts <directory-of-repos>");
  console.error("");
  console.error("  Runs the legacy sync scanner and the new parallel 4-phase");
  console.error("  scanner against <directory-of-repos>, then re-runs the parallel");
  console.error("  scanner against a freshly-warmed cache so you can see the");
  console.error("  per-launch speedup. Cache lives in a tmp dir, so this won't");
  console.error("  touch ~/.repogarden/scan-cache.json.");
  process.exit(2);
}
// Use a tmp cache file so the bench doesn't dirty the user's real
// ~/.repogarden/scan-cache.json. The cold-cache run starts with this
// empty file; the warm-cache run uses what cold wrote into it.
const cacheDir = mkdtempSync(join(tmpdir(), "repogarden-bench-cache-"));
const cacheFile = join(cacheDir, "scan-cache.json");

const fmt = (ms: number): string => `${ms.toFixed(0)}ms`;

const main = async () => {
  console.log(`benchmarking scan of: ${root}\n`);

  // Warm git's fs cache so the cold-cache penalty doesn't bias the first run.
  console.log("warming fs cache...");
  scanRoots([root], 4);
  console.log("warm.\n");

  // --- legacy sync path -----------------------------------------------------
  console.log("sync scanRoots (legacy):");
  const syncStart = performance.now();
  const syncResult = scanRoots([root], 4);
  const syncTotal = performance.now() - syncStart;
  const dirtyCount = syncResult.repos.filter((r) => r.isDirty).length;
  console.log(`  total: ${fmt(syncTotal)}`);
  console.log(`  repos: ${syncResult.repos.length} (${dirtyCount} dirty)`);
  console.log("");

  // --- new parallel path (cold cache) ---------------------------------------
  console.log("scanRootsProgressive (parallel, 4-phase, cold cache):");
  let firstSkeleton: number | undefined;
  let lastSkeleton: number | undefined;
  let firstStatus: number | undefined;
  let lastStatus: number | undefined;
  let lastEnrich: number | undefined;
  let lastExtras: number | undefined;
  const progStart = performance.now();
  const progResult = await scanRootsProgressive([root], {
    onRepoSkeleton: () => {
      if (firstSkeleton === undefined) firstSkeleton = performance.now() - progStart;
      lastSkeleton = performance.now() - progStart;
    },
    onRepoStatus: () => {
      if (firstStatus === undefined) firstStatus = performance.now() - progStart;
      lastStatus = performance.now() - progStart;
    },
    onRepo: () => {
      lastEnrich = performance.now() - progStart;
    },
    onRepoExtras: () => {
      lastExtras = performance.now() - progStart;
    }
  }, 4, { cacheFile });
  const progTotal = performance.now() - progStart;
  console.log(`  first skeleton (phase 0): ${firstSkeleton !== undefined ? fmt(firstSkeleton) : "—"}`);
  console.log(`  all skeletons (phase 0):  ${lastSkeleton !== undefined ? fmt(lastSkeleton) : "—"}`);
  console.log(`  first status   (phase 1): ${firstStatus !== undefined ? fmt(firstStatus) : "—"}`);
  console.log(`  all status     (phase 1): ${lastStatus !== undefined ? fmt(lastStatus) : "—"}`);
  console.log(`  all enrichment (phase 2): ${lastEnrich !== undefined ? fmt(lastEnrich) : "—"}`);
  console.log(`  all extras     (phase 3): ${lastExtras !== undefined ? fmt(lastExtras) : "—"}`);
  console.log(`  total (promise resolve):  ${fmt(progTotal)}`);
  console.log(`  repos: ${progResult.repos.length}`);
  console.log("");

  // --- comparison -----------------------------------------------------------
  const speedup = syncTotal / progTotal;
  console.log("comparison:");
  console.log(`  total speedup:           ${speedup.toFixed(2)}x  (${fmt(syncTotal)} → ${fmt(progTotal)})`);
  if (firstSkeleton !== undefined) {
    console.log(`  time-to-first-row:       ${(syncTotal / firstSkeleton).toFixed(2)}x  (sync ${fmt(syncTotal)} → first skeleton ${fmt(firstSkeleton)})`);
  }
  if (lastSkeleton !== undefined) {
    console.log(`  time-to-named-list:      ${(syncTotal / lastSkeleton).toFixed(2)}x  (sync ${fmt(syncTotal)} → all skeletons ${fmt(lastSkeleton)})`);
  }
  if (lastStatus !== undefined) {
    console.log(`  time-to-status-list:     ${(syncTotal / lastStatus).toFixed(2)}x  (sync ${fmt(syncTotal)} → all status ${fmt(lastStatus)})`);
  }
  console.log(`  repo count match:        ${syncResult.repos.length === progResult.repos.length ? "yes" : `NO (${syncResult.repos.length} vs ${progResult.repos.length})`}`);
  console.log("");

  // --- warm cache run -------------------------------------------------------
  // Cold-cache run above wrote `cacheFile`. This run should hit the cache
  // for every repo whose HEAD hasn't moved (i.e., all of them).
  console.log("scanRootsProgressive (parallel, 4-phase, WARM cache):");
  let warmFirstSkeleton: number | undefined;
  let warmLastSkeleton: number | undefined;
  let warmLastExtras: number | undefined;
  const warmStart = performance.now();
  const warmResult = await scanRootsProgressive([root], {
    onRepoSkeleton: () => {
      if (warmFirstSkeleton === undefined) warmFirstSkeleton = performance.now() - warmStart;
      warmLastSkeleton = performance.now() - warmStart;
    },
    onRepoExtras: () => {
      warmLastExtras = performance.now() - warmStart;
    }
  }, 4, { cacheFile });
  const warmTotal = performance.now() - warmStart;
  console.log(`  first skeleton:           ${warmFirstSkeleton !== undefined ? fmt(warmFirstSkeleton) : "—"}`);
  console.log(`  all skeletons:            ${warmLastSkeleton !== undefined ? fmt(warmLastSkeleton) : "—"}`);
  console.log(`  all extras (full data):   ${warmLastExtras !== undefined ? fmt(warmLastExtras) : "—"}`);
  console.log(`  total:                    ${fmt(warmTotal)}`);
  console.log(`  warm vs cold:             ${(progTotal / warmTotal).toFixed(2)}x faster  (${fmt(progTotal)} → ${fmt(warmTotal)})`);
  console.log(`  warm vs sync legacy:      ${(syncTotal / warmTotal).toFixed(2)}x faster  (${fmt(syncTotal)} → ${fmt(warmTotal)})`);
  console.log(`  repo count match:         ${syncResult.repos.length === warmResult.repos.length ? "yes" : `NO`}`);
  console.log("");

  // Sanity: verify the parallel scan filled in the same fields the sync scan does.
  const sampleSync = syncResult.repos[0];
  const sampleProg = progResult.repos.find((r) => r.path === sampleSync?.path);
  if (sampleSync && sampleProg) {
    const fieldsToCheck: (keyof typeof sampleSync)[] = [
      "branch", "isDirty", "lastCommitSha", "lastCommitSubject",
      "commitCount", "primaryLanguage", "recentCommitDays"
    ];
    const mismatches = fieldsToCheck.filter((field) => {
      const a = JSON.stringify(sampleSync[field]);
      const b = JSON.stringify(sampleProg[field]);
      return a !== b;
    });
    if (mismatches.length === 0) {
      console.log(`  field parity (sample):   all checked fields match on ${sampleSync.name}`);
    } else {
      console.log(`  field parity (sample):   MISMATCH on ${sampleSync.name}: ${mismatches.join(", ")}`);
      for (const field of mismatches) {
        console.log(`    sync.${field} = ${JSON.stringify(sampleSync[field])}`);
        console.log(`    prog.${field} = ${JSON.stringify(sampleProg[field])}`);
      }
    }
  }
};

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    rmSync(cacheDir, { recursive: true, force: true });
  });
