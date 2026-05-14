// Persistent scan cache for repo state between runs.
//
// Each entry pairs a `ScannedRepo` with the HEAD sha that produced it. On
// subsequent launches, if a repo's HEAD sha matches the cached entry the
// scanner emits the cached scan directly from phase 0 and skips phases 1-3
// entirely — bringing the second-launch experience close to instant.
//
// Cache invalidation:
//   - HEAD sha changed (new commit, branch switch, reset) → miss.
//   - Entry older than CACHE_MAX_AGE_MS → expired.
//   - Schema version bump → all entries dropped on read.
//
// Things that DON'T invalidate the cache (deliberately):
//   - Working-tree edits / staging changes. Dirty detection costs a git
//     status spawn and would defeat the cache. The 30s background ticker
//     and observer catch up dirty/ahead/behind shortly after launch.
//   - Remote-tracking ref movement (git fetch). Same trade-off.
//
// All I/O is silent: a failed read returns an empty map, a failed write
// just means the user loses cache benefit next run. Never crashes the scan.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import type { ScannedRepo } from "./scanner";

const CACHE_VERSION = 1;
const CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export interface ScanCacheEntry {
  /** HEAD sha at the time the scan was performed. Cache hit requires the
   *  caller's current HEAD sha to match this. */
  headSha: string;
  scan: ScannedRepo;
  /** Epoch ms — used to expire stale entries. */
  cachedAt: number;
}

export type ScanCacheMap = Record<string, ScanCacheEntry>;

interface CacheFile {
  version: number;
  entries: ScanCacheMap;
}

/** Default cache file: `~/.repogarden/scan-cache.json`. Overridable via the
 *  `REPOGARDEN_SCAN_CACHE` env var — set it to an empty string to disable
 *  caching entirely (tests, CI, ephemeral environments). */
export const defaultCachePath = (): string => {
  const env = process.env.REPOGARDEN_SCAN_CACHE;
  if (env !== undefined) return env;
  return join(homedir(), ".repogarden", "scan-cache.json");
};

export const loadScanCache = (file: string = defaultCachePath()): ScanCacheMap => {
  if (!file) return {};
  try {
    if (!existsSync(file)) return {};
    const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<CacheFile>;
    if (parsed.version !== CACHE_VERSION) return {};
    if (!parsed.entries || typeof parsed.entries !== "object") return {};
    return parsed.entries;
  } catch {
    return {};
  }
};

export const saveScanCache = (
  entries: ScanCacheMap,
  file: string = defaultCachePath()
): void => {
  if (!file) return;
  try {
    mkdirSync(dirname(file), { recursive: true });
    const payload: CacheFile = { version: CACHE_VERSION, entries };
    writeFileSync(file, JSON.stringify(payload), "utf8");
  } catch {
    // Cache write failures are silent — the user just loses cache benefit
    // next run. Better than crashing the scan or surfacing IO errors.
  }
};

/** Look up a cached scan. Returns the cached `ScannedRepo` only when the
 *  HEAD sha matches AND the entry is fresh enough. `undefined` means caller
 *  should run a full inspection. */
export const lookupCachedScan = (
  cache: ScanCacheMap,
  path: string,
  headSha: string | undefined,
  now: number = Date.now()
): ScannedRepo | undefined => {
  if (!headSha) return undefined;
  const entry = cache[path];
  if (!entry) return undefined;
  if (entry.headSha !== headSha) return undefined;
  if (now - entry.cachedAt > CACHE_MAX_AGE_MS) return undefined;
  return entry.scan;
};

/** Build a fresh cache map from the scan that just ran. Only successful
 *  scans with a known `lastCommitSha` are recorded — empty/error states
 *  shouldn't poison the cache. Entries for repos not in this scan are
 *  dropped so the cache file doesn't grow unbounded across renamed roots. */
export const buildUpdatedCache = (
  scans: ScannedRepo[],
  now: number = Date.now()
): ScanCacheMap => {
  const next: ScanCacheMap = {};
  for (const scan of scans) {
    if (scan.scanError || !scan.lastCommitSha) continue;
    next[scan.path] = {
      headSha: scan.lastCommitSha,
      scan,
      cachedAt: now
    };
  }
  return next;
};
