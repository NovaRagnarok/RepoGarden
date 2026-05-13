// Update check against the npm registry, cached for 24h under
// ~/.repogarden/update-check.json. Pure: all I/O (fs, fetch, clock) is
// injectable so the tests can run without network or disk.
//
// Opt-out paths (any one disables):
//   REPOGARDEN_NO_UPDATE_CHECK=1
//   REPOGARDEN_DEMO=1                 (so demo recordings never show a banner)
//   CI=true                           (CI runners shouldn't ping the registry)

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const TTL_MS = 24 * 60 * 60 * 1000;
const REGISTRY_URL = "https://registry.npmjs.org/@outsideheaven/repogarden/latest";

const cacheDir = join(homedir(), ".repogarden");
const cacheFile = join(cacheDir, "update-check.json");

export interface UpdateCheckResult {
  current: string;
  latest: string;
  isOutdated: boolean;
  /** "cache" if we returned a cached "latest", "network" if we fetched. */
  source: "cache" | "network";
}

interface Cache {
  checkedAt: number;
  latest: string;
}

/**
 * Numeric semver compare on the leading `x.y.z` (pre-release tags ignored).
 * Returns negative if a < b, positive if a > b, zero if equal.
 *
 * We deliberately ignore pre-release suffixes so `0.2.0` and `0.2.0-rc.1`
 * compare equal — a beta user on an rc shouldn't get nagged about the
 * stable release they already have.
 */
export const compareVersions = (a: string, b: string): number => {
  const parse = (raw: string): number[] =>
    raw
      .split("-")[0]!
      .split(".")
      .map((part) => Number.parseInt(part, 10))
      .map((n) => (Number.isFinite(n) ? n : 0));
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 3; i += 1) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return da - db;
  }
  return 0;
};

const isDisabled = (env: NodeJS.ProcessEnv = process.env): boolean =>
  env.REPOGARDEN_NO_UPDATE_CHECK === "1" ||
  env.REPOGARDEN_DEMO === "1" ||
  env.CI === "true";

const readCache = (): Cache | null => {
  try {
    if (!existsSync(cacheFile)) return null;
    const parsed = JSON.parse(readFileSync(cacheFile, "utf8")) as Partial<Cache>;
    if (typeof parsed.checkedAt !== "number" || typeof parsed.latest !== "string") {
      return null;
    }
    return { checkedAt: parsed.checkedAt, latest: parsed.latest };
  } catch {
    return null;
  }
};

const writeCache = (latest: string, now: number): void => {
  try {
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(cacheFile, JSON.stringify({ checkedAt: now, latest }, null, 2));
  } catch {
    // best-effort: a session without a writable cache still works, it just
    // pings the registry next launch.
  }
};

type MinimalResponse = { ok: boolean; json: () => Promise<unknown> };
type FetchFn = (url: string) => Promise<MinimalResponse>;

export interface CheckOptions {
  current: string;
  now?: number;
  env?: NodeJS.ProcessEnv;
  registryUrl?: string;
  fetchFn?: FetchFn;
  readCacheFn?: () => Cache | null;
  writeCacheFn?: (latest: string, now: number) => void;
}

/**
 * Resolve the running package version from package.json. Resilient to
 * being called from either the source tree (src/lib/) or the built output
 * (dist/lib/) — both sit two levels below package.json.
 */
export const readCurrentVersion = (): string => {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkgPath = join(here, "..", "..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: unknown };
    return typeof pkg.version === "string" ? pkg.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
};

/**
 * Check whether a newer version is available on the npm registry.
 *
 * Returns `null` when the check is disabled, when no version info could be
 * obtained (no cache + no network), or when the registry returned junk.
 * Never throws — the worst case is a no-op.
 */
export const checkForUpdate = async (
  opts: CheckOptions
): Promise<UpdateCheckResult | null> => {
  const env = opts.env ?? process.env;
  if (isDisabled(env)) return null;

  const now = opts.now ?? Date.now();
  const readFn = opts.readCacheFn ?? readCache;
  const writeFn = opts.writeCacheFn ?? writeCache;
  const fetchImpl = opts.fetchFn ?? (fetch as unknown as FetchFn);

  const buildResult = (latest: string, source: "cache" | "network"): UpdateCheckResult => ({
    current: opts.current,
    latest,
    isOutdated: compareVersions(opts.current, latest) < 0,
    source
  });

  const cached = readFn();
  if (cached && now - cached.checkedAt < TTL_MS) {
    return buildResult(cached.latest, "cache");
  }

  try {
    const res = await fetchImpl(opts.registryUrl ?? REGISTRY_URL);
    if (!res.ok) {
      return cached ? buildResult(cached.latest, "cache") : null;
    }
    const body = (await res.json()) as { version?: unknown };
    if (typeof body.version !== "string") {
      return cached ? buildResult(cached.latest, "cache") : null;
    }
    writeFn(body.version, now);
    return buildResult(body.version, "network");
  } catch {
    // Offline, DNS failure, slow registry. Fall back to whatever the cache
    // last said — even stale info is better than nagging the user when
    // they're on a plane.
    return cached ? buildResult(cached.latest, "cache") : null;
  }
};
