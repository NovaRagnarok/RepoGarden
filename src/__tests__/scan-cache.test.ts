import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildUpdatedCache,
  loadScanCache,
  lookupCachedScan,
  saveScanCache,
} from "../lib/scan-cache";
import type { ScannedRepo } from "../lib/scanner";

const sampleScan = (overrides: Partial<ScannedRepo> = {}): ScannedRepo => ({
  id: "alpha-abc",
  path: "/tmp/alpha",
  name: "alpha",
  isDirty: false,
  branch: "main",
  lastCommitSha: "a".repeat(40),
  ...overrides,
});

test("loadScanCache returns an empty map when the file is missing", () => {
  const dir = mkdtempSync(join(tmpdir(), "repogarden-cache-missing-"));
  try {
    const cache = loadScanCache(join(dir, "scan-cache.json"));
    assert.deepEqual(cache, {});
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("loadScanCache returns an empty map when the file is malformed", () => {
  const dir = mkdtempSync(join(tmpdir(), "repogarden-cache-malformed-"));
  try {
    const file = join(dir, "scan-cache.json");
    writeFileSync(file, "not-json{");
    const cache = loadScanCache(file);
    assert.deepEqual(cache, {});
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("saveScanCache + loadScanCache roundtrip a scan", () => {
  const dir = mkdtempSync(join(tmpdir(), "repogarden-cache-roundtrip-"));
  try {
    const file = join(dir, "scan-cache.json");
    const scan = sampleScan();
    const built = buildUpdatedCache([scan]);
    saveScanCache(built, file);

    const loaded = loadScanCache(file);
    assert.ok(loaded[scan.path]);
    assert.equal(loaded[scan.path].headSha, scan.lastCommitSha);
    assert.equal(loaded[scan.path].scan.id, scan.id);
    assert.equal(loaded[scan.path].scan.branch, "main");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("loadScanCache drops the entries when the schema version is unknown", () => {
  const dir = mkdtempSync(join(tmpdir(), "repogarden-cache-version-"));
  try {
    const file = join(dir, "scan-cache.json");
    // Pretend a future schema wrote this cache. We don't want to half-apply
    // unfamiliar shapes — better to start clean.
    writeFileSync(
      file,
      JSON.stringify({ version: 999, entries: { "/tmp/x": { headSha: "abc", scan: {}, cachedAt: 0 } } })
    );
    const loaded = loadScanCache(file);
    assert.deepEqual(loaded, {});
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("lookupCachedScan returns the scan on a sha match", () => {
  const scan = sampleScan();
  const cache = buildUpdatedCache([scan]);
  const result = lookupCachedScan(cache, scan.path, scan.lastCommitSha);
  assert.ok(result);
  assert.equal(result!.id, scan.id);
});

test("lookupCachedScan misses when HEAD sha differs", () => {
  const scan = sampleScan();
  const cache = buildUpdatedCache([scan]);
  const result = lookupCachedScan(cache, scan.path, "b".repeat(40));
  assert.equal(result, undefined);
});

test("lookupCachedScan misses when no headSha is provided", () => {
  const scan = sampleScan();
  const cache = buildUpdatedCache([scan]);
  const result = lookupCachedScan(cache, scan.path, undefined);
  assert.equal(result, undefined);
});

test("lookupCachedScan expires entries older than the max age", () => {
  const scan = sampleScan();
  const cache = buildUpdatedCache([scan]);
  // 31 days in the future — entry is now older than the 30d window.
  const future = Date.now() + 31 * 24 * 60 * 60 * 1000;
  const result = lookupCachedScan(cache, scan.path, scan.lastCommitSha, future);
  assert.equal(result, undefined);
});

test("buildUpdatedCache skips repos with scan errors or no commits", () => {
  const ok = sampleScan({ path: "/tmp/ok" });
  const errored = sampleScan({ path: "/tmp/bad", scanError: "not a git repo" });
  const empty = sampleScan({ path: "/tmp/empty", lastCommitSha: undefined });
  const cache = buildUpdatedCache([ok, errored, empty]);
  assert.ok(cache["/tmp/ok"]);
  assert.equal(cache["/tmp/bad"], undefined);
  assert.equal(cache["/tmp/empty"], undefined);
});

test("saveScanCache creates the parent directory if it doesn't exist", () => {
  const dir = mkdtempSync(join(tmpdir(), "repogarden-cache-mkdir-"));
  try {
    const file = join(dir, "nested", "subdir", "scan-cache.json");
    saveScanCache(buildUpdatedCache([sampleScan()]), file);
    const raw = readFileSync(file, "utf8");
    const parsed = JSON.parse(raw);
    assert.equal(parsed.version, 1);
    assert.ok(parsed.entries["/tmp/alpha"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("saveScanCache with an empty file path is a no-op (cache disabled)", () => {
  // Should not throw, should not write anywhere. The REPOGARDEN_SCAN_CACHE=""
  // disable path relies on this.
  saveScanCache({}, "");
  // No assertion needed — successful completion is the contract.
});

test("loadScanCache with an empty file path returns an empty map", () => {
  const result = loadScanCache("");
  assert.deepEqual(result, {});
});
