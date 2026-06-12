import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import type { GitHubConfig } from "@/lib/config";
import type { GitHubRepoSnapshot, RepoRemote } from "@/lib/scanner-types";

const GITHUB_API_VERSION = "2026-03-10";
const GH_TIMEOUT_MS = 4000;
const DEFAULT_CACHE_TTL_MINUTES = 30;

const cachePath = (): string => join(homedir(), ".repogarden", "github-repos.json");

interface GitHubCachePage {
  url: string;
  etag?: string;
  repos: GitHubRepoSnapshot[];
}

export interface GitHubCache {
  fetchedAt: string;
  configKey: string;
  pages: GitHubCachePage[];
  rateLimit?: GitHubRateLimit;
}

export interface GitHubRateLimit {
  limit?: number;
  remaining?: number;
  reset?: number;
}

export interface GitHubCatalogResult {
  repos: GitHubRepoSnapshot[];
  fetchedAt?: string;
  fromCache: boolean;
  stale: boolean;
  error?: string;
  rateLimit?: GitHubRateLimit;
}

export interface FetchGitHubCatalogOptions {
  cacheFile?: string;
  token?: string;
  fetchImpl?: typeof fetch;
  now?: Date;
  spawnCommand?: typeof spawnSync;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const stringAt = (value: Record<string, unknown>, key: string): string | undefined =>
  typeof value[key] === "string" ? value[key] : undefined;

const numberAt = (value: Record<string, unknown>, key: string): number | undefined =>
  typeof value[key] === "number" && Number.isFinite(value[key]) ? value[key] : undefined;

const boolAt = (value: Record<string, unknown>, key: string): boolean | undefined =>
  typeof value[key] === "boolean" ? value[key] : undefined;

const parseHeaderNumber = (headers: Headers, name: string): number | undefined => {
  const raw = headers.get(name);
  if (!raw) return undefined;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const rateLimitFromHeaders = (headers: Headers): GitHubRateLimit => ({
  limit: parseHeaderNumber(headers, "x-ratelimit-limit"),
  remaining: parseHeaderNumber(headers, "x-ratelimit-remaining"),
  reset: parseHeaderNumber(headers, "x-ratelimit-reset")
});

const cleanOptionalString = (value: string | undefined): string | undefined =>
  value && value.trim().length > 0 ? value.trim() : undefined;

const isVisibility = (value: string | undefined): value is "public" | "private" | "internal" =>
  value === "public" || value === "private" || value === "internal";

export const normalizeGitHubRepo = (raw: unknown): GitHubRepoSnapshot | null => {
  if (!isObject(raw)) return null;
  const id = numberAt(raw, "id");
  const fullName = stringAt(raw, "full_name");
  const name = stringAt(raw, "name");
  const ownerRaw = raw.owner;
  const owner = isObject(ownerRaw) ? stringAt(ownerRaw, "login") : undefined;
  const htmlUrl = stringAt(raw, "html_url");
  if (id === undefined || !fullName || !name || !owner || !htmlUrl) return null;

  const visibility = stringAt(raw, "visibility");
  const permissionsRaw = raw.permissions;
  const permissions = isObject(permissionsRaw)
    ? {
        admin: boolAt(permissionsRaw, "admin"),
        push: boolAt(permissionsRaw, "push"),
        pull: boolAt(permissionsRaw, "pull")
      }
    : undefined;

  return {
    id,
    nodeId: cleanOptionalString(stringAt(raw, "node_id")),
    fullName,
    owner,
    name,
    private: boolAt(raw, "private") ?? false,
    visibility: isVisibility(visibility) ? visibility : undefined,
    fork: boolAt(raw, "fork") ?? false,
    archived: boolAt(raw, "archived") ?? false,
    disabled: boolAt(raw, "disabled") ?? false,
    htmlUrl,
    cloneUrl: cleanOptionalString(stringAt(raw, "clone_url")),
    sshUrl: cleanOptionalString(stringAt(raw, "ssh_url")),
    defaultBranch: cleanOptionalString(stringAt(raw, "default_branch")),
    pushedAt: cleanOptionalString(stringAt(raw, "pushed_at")),
    updatedAt: cleanOptionalString(stringAt(raw, "updated_at")),
    createdAt: cleanOptionalString(stringAt(raw, "created_at")),
    language: cleanOptionalString(stringAt(raw, "language")),
    permissions
  };
};

const normalizeCachedGitHubRepo = (raw: unknown): GitHubRepoSnapshot | null => {
  if (!isObject(raw)) return null;
  const id = numberAt(raw, "id");
  const fullName = stringAt(raw, "fullName");
  const owner = stringAt(raw, "owner");
  const name = stringAt(raw, "name");
  const htmlUrl = stringAt(raw, "htmlUrl");
  if (id === undefined || !fullName || !owner || !name || !htmlUrl) return null;
  const visibility = stringAt(raw, "visibility");
  const permissionsRaw = raw.permissions;
  return {
    id,
    nodeId: cleanOptionalString(stringAt(raw, "nodeId")),
    fullName,
    owner,
    name,
    private: boolAt(raw, "private") ?? false,
    visibility: isVisibility(visibility) ? visibility : undefined,
    fork: boolAt(raw, "fork") ?? false,
    archived: boolAt(raw, "archived") ?? false,
    disabled: boolAt(raw, "disabled") ?? false,
    htmlUrl,
    cloneUrl: cleanOptionalString(stringAt(raw, "cloneUrl")),
    sshUrl: cleanOptionalString(stringAt(raw, "sshUrl")),
    defaultBranch: cleanOptionalString(stringAt(raw, "defaultBranch")),
    pushedAt: cleanOptionalString(stringAt(raw, "pushedAt")),
    updatedAt: cleanOptionalString(stringAt(raw, "updatedAt")),
    createdAt: cleanOptionalString(stringAt(raw, "createdAt")),
    language: cleanOptionalString(stringAt(raw, "language")),
    permissions: isObject(permissionsRaw)
      ? {
          admin: boolAt(permissionsRaw, "admin"),
          push: boolAt(permissionsRaw, "push"),
          pull: boolAt(permissionsRaw, "pull")
        }
      : undefined
  };
};

export const parseGitHubRemoteUrl = (raw: string): RepoRemote | null => {
  const value = raw.trim();
  if (!value) return null;

  const finish = (owner: string, repo: string): RepoRemote | null => {
    const cleanOwner = owner.trim();
    const cleanRepo = repo.trim().replace(/\.git$/i, "");
    if (!cleanOwner || !cleanRepo) return null;
    return {
      provider: "github",
      fullName: `${cleanOwner}/${cleanRepo}`,
      url: `https://github.com/${cleanOwner}/${cleanRepo}`
    };
  };

  const scp = value.match(/^git@github\.com:([^/\s]+)\/(.+)$/i);
  if (scp) return finish(scp[1], scp[2]);

  try {
    const url = new URL(value);
    if (url.hostname.toLowerCase() !== "github.com") return null;
    const parts = url.pathname.replace(/^\/+/, "").split("/");
    if (parts.length < 2) return null;
    return finish(parts[0], parts[1]);
  } catch {
    return null;
  }
};

const readGitHubToken = (
  spawnCommand: typeof spawnSync = spawnSync
): { token?: string; error?: string } => {
  const result = spawnCommand("gh", ["auth", "token"], {
    encoding: "utf8",
    timeout: GH_TIMEOUT_MS
  });
  if (result.error) return { error: "GitHub CLI not available. Run gh auth login first." };
  if (result.status !== 0) {
    const stderr = (result.stderr ?? "").toString().trim();
    return { error: stderr || "GitHub CLI is not authenticated. Run gh auth login first." };
  }
  const token = (result.stdout ?? "").toString().trim();
  if (!token) return { error: "GitHub CLI returned no token. Run gh auth login first." };
  return { token };
};

const readCache = (path: string): GitHubCache | null => {
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (!isObject(parsed)) return null;
    const pagesRaw = parsed.pages;
    if (!Array.isArray(pagesRaw)) return null;
    const pages: GitHubCachePage[] = [];
    for (const page of pagesRaw) {
      if (!isObject(page)) continue;
      const url = stringAt(page, "url");
      if (!url || !Array.isArray(page.repos)) continue;
      const repos = page.repos
        .map((repo) => normalizeCachedGitHubRepo(repo) ?? normalizeGitHubRepo(repo))
        .filter((repo): repo is GitHubRepoSnapshot => repo !== null);
      pages.push({
        url,
        etag: cleanOptionalString(stringAt(page, "etag")),
        repos
      });
    }
    const fetchedAt = stringAt(parsed, "fetchedAt");
    const configKey = stringAt(parsed, "configKey");
    if (!fetchedAt || !configKey) return null;
    const rateLimitRaw = parsed.rateLimit;
    return {
      fetchedAt,
      configKey,
      pages,
      rateLimit: isObject(rateLimitRaw)
        ? {
            limit: numberAt(rateLimitRaw, "limit"),
            remaining: numberAt(rateLimitRaw, "remaining"),
            reset: numberAt(rateLimitRaw, "reset")
          }
        : undefined
    };
  } catch {
    return null;
  }
};

const writeCache = (path: string, cache: GitHubCache): void => {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(cache, null, 2), "utf8");
    renameSync(tmp, path);
  } catch {
    try {
      unlinkSync(tmp);
    } catch {
      // tmp may not exist.
    }
  }
};

const flattenPages = (pages: GitHubCachePage[]): GitHubRepoSnapshot[] =>
  pages.flatMap((page) => page.repos);

export const githubConfigKey = (config: GitHubConfig): string =>
  JSON.stringify({
    includePrivate: config.includePrivate,
    affiliations: [...config.affiliations].sort(),
  });

const isFresh = (
  cache: GitHubCache,
  config: GitHubConfig,
  now: Date
): boolean => {
  if (cache.configKey !== githubConfigKey(config)) return false;
  const fetchedMs = new Date(cache.fetchedAt).getTime();
  if (!Number.isFinite(fetchedMs)) return false;
  const ttlMs = (config.cacheTtlMinutes || DEFAULT_CACHE_TTL_MINUTES) * 60_000;
  return now.getTime() - fetchedMs < ttlMs;
};

const nextUrlFromLink = (link: string | null): string | null => {
  if (!link) return null;
  for (const part of link.split(",")) {
    const match = part.match(/<([^>]+)>;\s*rel="([^"]+)"/);
    if (match && match[2] === "next") return match[1];
  }
  return null;
};

const buildInitialUrl = (config: GitHubConfig): string => {
  const url = new URL("https://api.github.com/user/repos");
  url.searchParams.set("visibility", config.includePrivate ? "all" : "public");
  url.searchParams.set("affiliation", config.affiliations.join(","));
  url.searchParams.set("sort", "pushed");
  url.searchParams.set("direction", "desc");
  url.searchParams.set("per_page", "100");
  return url.toString();
};

export const buildGitHubRepoMap = (
  repos: GitHubRepoSnapshot[]
): Map<string, GitHubRepoSnapshot> => {
  const map = new Map<string, GitHubRepoSnapshot>();
  for (const repo of repos) {
    map.set(repo.fullName.toLowerCase(), repo);
  }
  return map;
};

export const cloneUrlForRepo = (
  repo: GitHubRepoSnapshot,
  protocol: "ssh" | "https"
): string =>
  protocol === "ssh"
    ? repo.sshUrl ?? repo.cloneUrl ?? repo.htmlUrl
    : repo.cloneUrl ?? repo.sshUrl ?? repo.htmlUrl;

export const fetchGitHubCatalog = async (
  config: GitHubConfig,
  options: FetchGitHubCatalogOptions = {}
): Promise<GitHubCatalogResult> => {
  if (!config.enabled || process.env.REPOGARDEN_DISABLE_GITHUB === "1") {
    return { repos: [], fromCache: false, stale: false };
  }

  const now = options.now ?? new Date();
  const path = options.cacheFile ?? cachePath();
  const prior = readCache(path);
  if (prior && isFresh(prior, config, now)) {
    return {
      repos: flattenPages(prior.pages),
      fetchedAt: prior.fetchedAt,
      fromCache: true,
      stale: false,
      rateLimit: prior.rateLimit
    };
  }

  const tokenResult = options.token
    ? { token: options.token }
    : readGitHubToken(options.spawnCommand);
  if (!tokenResult.token) {
    return {
      repos: prior ? flattenPages(prior.pages) : [],
      fetchedAt: prior?.fetchedAt,
      fromCache: Boolean(prior),
      stale: Boolean(prior),
      error: tokenResult.error ?? "GitHub token unavailable.",
      rateLimit: prior?.rateLimit
    };
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const pages: GitHubCachePage[] = [];
  const priorPagesByUrl = new Map((prior?.pages ?? []).map((page) => [page.url, page]));
  let nextUrl: string | null = buildInitialUrl(config);
  let lastRateLimit: GitHubRateLimit | undefined;

  while (nextUrl) {
    const priorPage = priorPagesByUrl.get(nextUrl);
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${tokenResult.token}`,
      "X-GitHub-Api-Version": GITHUB_API_VERSION
    };
    if (priorPage?.etag) headers["If-None-Match"] = priorPage.etag;

    let response: Response;
    try {
      response = await fetchImpl(nextUrl, { headers });
    } catch (error) {
      return {
        repos: prior ? flattenPages(prior.pages) : [],
        fetchedAt: prior?.fetchedAt,
        fromCache: Boolean(prior),
        stale: Boolean(prior),
        error: error instanceof Error ? error.message : "GitHub request failed.",
        rateLimit: prior?.rateLimit
      };
    }

    lastRateLimit = rateLimitFromHeaders(response.headers);

    if (response.status === 304 && priorPage) {
      pages.push(priorPage);
      nextUrl = nextUrlFromLink(response.headers.get("link"));
      if (!nextUrl && prior) {
        const priorIndex = prior.pages.findIndex((page) => page.url === priorPage.url);
        for (const remaining of prior.pages.slice(priorIndex + 1)) {
          pages.push(remaining);
        }
      }
      continue;
    }

    if (response.status === 403 || response.status === 429) {
      const retry = response.headers.get("retry-after");
      const reset = response.headers.get("x-ratelimit-reset");
      const detail = retry
        ? `GitHub rate limited; retry after ${retry}s.`
        : reset
          ? `GitHub rate limited until ${new Date(Number(reset) * 1000).toISOString()}.`
          : "GitHub rate limited.";
      return {
        repos: prior ? flattenPages(prior.pages) : [],
        fetchedAt: prior?.fetchedAt,
        fromCache: Boolean(prior),
        stale: Boolean(prior),
        error: detail,
        rateLimit: lastRateLimit ?? prior?.rateLimit
      };
    }

    if (!response.ok) {
      return {
        repos: prior ? flattenPages(prior.pages) : [],
        fetchedAt: prior?.fetchedAt,
        fromCache: Boolean(prior),
        stale: Boolean(prior),
        error: `GitHub request failed with HTTP ${response.status}.`,
        rateLimit: lastRateLimit ?? prior?.rateLimit
      };
    }

    const body = await response.json();
    const repos = Array.isArray(body)
      ? body
          .map((repo) => normalizeGitHubRepo(repo))
          .filter((repo): repo is GitHubRepoSnapshot => repo !== null)
      : [];
    pages.push({
      url: nextUrl,
      etag: cleanOptionalString(response.headers.get("etag") ?? undefined),
      repos
    });
    nextUrl = nextUrlFromLink(response.headers.get("link"));
  }

  const cache: GitHubCache = {
    fetchedAt: now.toISOString(),
    configKey: githubConfigKey(config),
    pages,
    rateLimit: lastRateLimit
  };
  writeCache(path, cache);

  return {
    repos: flattenPages(pages),
    fetchedAt: cache.fetchedAt,
    fromCache: false,
    stale: false,
    rateLimit: cache.rateLimit
  };
};
