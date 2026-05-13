import test from "node:test";
import assert from "node:assert/strict";

import {
  checkForUpdate,
  compareVersions,
  type CheckOptions
} from "../lib/update-check";

const stubFetch = (body: { version?: string } | null, ok = true) =>
  async () => ({
    ok,
    json: async () => body ?? {}
  });

const baseOpts = (overrides: Partial<CheckOptions> = {}): CheckOptions => ({
  current: "0.2.0",
  now: 1_000_000_000_000,
  env: {},
  registryUrl: "https://example.test/latest",
  fetchFn: stubFetch({ version: "0.2.0" }),
  readCacheFn: () => null,
  writeCacheFn: () => {},
  ...overrides
});

test("compareVersions orders major/minor/patch numerically", () => {
  assert.ok(compareVersions("0.1.9", "0.2.0") < 0);
  assert.ok(compareVersions("0.2.0", "0.1.9") > 0);
  assert.ok(compareVersions("0.2.0", "0.2.0") === 0);
  assert.ok(compareVersions("1.0.0", "0.99.99") > 0);
  assert.ok(compareVersions("0.2.10", "0.2.9") > 0); // numeric, not lexicographic
});

test("compareVersions ignores pre-release suffixes", () => {
  assert.equal(compareVersions("0.2.0", "0.2.0-rc.1"), 0);
  assert.equal(compareVersions("0.2.0-beta", "0.2.0"), 0);
});

test("checkForUpdate returns null when REPOGARDEN_NO_UPDATE_CHECK=1", async () => {
  const result = await checkForUpdate(
    baseOpts({ env: { REPOGARDEN_NO_UPDATE_CHECK: "1" } })
  );
  assert.equal(result, null);
});

test("checkForUpdate returns null in demo mode", async () => {
  const result = await checkForUpdate(
    baseOpts({ env: { REPOGARDEN_DEMO: "1" } })
  );
  assert.equal(result, null);
});

test("checkForUpdate returns null on CI", async () => {
  const result = await checkForUpdate(baseOpts({ env: { CI: "true" } }));
  assert.equal(result, null);
});

test("checkForUpdate hits the network and writes cache when no cache exists", async () => {
  let writtenLatest: string | null = null;
  const result = await checkForUpdate(
    baseOpts({
      current: "0.2.0",
      fetchFn: stubFetch({ version: "0.3.0" }),
      writeCacheFn: (latest) => {
        writtenLatest = latest;
      }
    })
  );
  assert.ok(result);
  assert.equal(result.latest, "0.3.0");
  assert.equal(result.isOutdated, true);
  assert.equal(result.source, "network");
  assert.equal(writtenLatest, "0.3.0");
});

test("checkForUpdate flags isOutdated=false when current equals latest", async () => {
  const result = await checkForUpdate(
    baseOpts({
      current: "0.3.0",
      fetchFn: stubFetch({ version: "0.3.0" })
    })
  );
  assert.ok(result);
  assert.equal(result.isOutdated, false);
});

test("checkForUpdate uses cache and skips fetch when cache is fresh", async () => {
  let fetchCalls = 0;
  const result = await checkForUpdate(
    baseOpts({
      current: "0.2.0",
      now: 1_000_000_000_000,
      readCacheFn: () => ({ checkedAt: 1_000_000_000_000 - 1000, latest: "0.4.0" }),
      fetchFn: async () => {
        fetchCalls += 1;
        return { ok: true, json: async () => ({ version: "0.5.0" }) };
      }
    })
  );
  assert.ok(result);
  assert.equal(result.latest, "0.4.0");
  assert.equal(result.source, "cache");
  assert.equal(fetchCalls, 0);
});

test("checkForUpdate refetches when cache is older than 24h", async () => {
  let fetchCalls = 0;
  const day = 24 * 60 * 60 * 1000;
  const result = await checkForUpdate(
    baseOpts({
      current: "0.2.0",
      now: 1_000_000_000_000,
      readCacheFn: () => ({
        checkedAt: 1_000_000_000_000 - day - 1,
        latest: "0.3.0"
      }),
      fetchFn: async () => {
        fetchCalls += 1;
        return { ok: true, json: async () => ({ version: "0.5.0" }) };
      }
    })
  );
  assert.ok(result);
  assert.equal(result.latest, "0.5.0");
  assert.equal(result.source, "network");
  assert.equal(fetchCalls, 1);
});

test("checkForUpdate falls back to stale cache when the network fails", async () => {
  const day = 24 * 60 * 60 * 1000;
  const result = await checkForUpdate(
    baseOpts({
      current: "0.2.0",
      now: 1_000_000_000_000,
      readCacheFn: () => ({
        checkedAt: 1_000_000_000_000 - day - 1,
        latest: "0.3.0"
      }),
      fetchFn: async () => {
        throw new Error("offline");
      }
    })
  );
  assert.ok(result);
  assert.equal(result.latest, "0.3.0");
  assert.equal(result.source, "cache");
});

test("checkForUpdate returns null on network failure with no cache", async () => {
  const result = await checkForUpdate(
    baseOpts({
      readCacheFn: () => null,
      fetchFn: async () => {
        throw new Error("offline");
      }
    })
  );
  assert.equal(result, null);
});

test("checkForUpdate returns null on non-200 with no cache", async () => {
  const result = await checkForUpdate(
    baseOpts({
      readCacheFn: () => null,
      fetchFn: stubFetch({ version: "0.3.0" }, false)
    })
  );
  assert.equal(result, null);
});

test("checkForUpdate returns null when registry returns junk", async () => {
  const result = await checkForUpdate(
    baseOpts({
      readCacheFn: () => null,
      fetchFn: stubFetch({})
    })
  );
  assert.equal(result, null);
});
