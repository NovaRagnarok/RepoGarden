import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  cloneUrlForRepo,
  fetchGitHubCatalog,
  normalizeGitHubRepo,
  parseGitHubRemoteUrl,
} from "../lib/github";
import type { GitHubConfig } from "../lib/config";

const config: GitHubConfig = {
  enabled: true,
  includePrivate: true,
  affiliations: ["owner", "collaborator", "organization_member"],
  cacheTtlMinutes: 30,
  cloneProtocol: "ssh"
};

const rawRepo = (name: string, id = 1) => ({
  id,
  node_id: `node-${id}`,
  name,
  full_name: `octo/${name}`,
  owner: { login: "octo" },
  private: false,
  visibility: "public",
  fork: false,
  archived: false,
  disabled: false,
  html_url: `https://github.com/octo/${name}`,
  clone_url: `https://github.com/octo/${name}.git`,
  ssh_url: `git@github.com:octo/${name}.git`,
  default_branch: "main",
  pushed_at: "2026-06-01T00:00:00Z",
  updated_at: "2026-06-02T00:00:00Z",
  created_at: "2026-05-01T00:00:00Z",
  language: "TypeScript",
  permissions: { admin: false, push: true, pull: true },
});

test("parseGitHubRemoteUrl handles common GitHub remote formats", () => {
  assert.deepEqual(parseGitHubRemoteUrl("git@github.com:octo/alpha.git"), {
    provider: "github",
    fullName: "octo/alpha",
    url: "https://github.com/octo/alpha"
  });
  assert.deepEqual(parseGitHubRemoteUrl("https://github.com/octo/beta.git")?.fullName, "octo/beta");
  assert.deepEqual(parseGitHubRemoteUrl("ssh://git@github.com/octo/gamma.git")?.fullName, "octo/gamma");
  assert.equal(parseGitHubRemoteUrl("https://gitlab.com/octo/beta.git"), null);
});

test("normalizeGitHubRepo keeps only the catalog fields RepoGarden uses", () => {
  const repo = normalizeGitHubRepo(rawRepo("alpha"));
  assert.ok(repo);
  assert.equal(repo.fullName, "octo/alpha");
  assert.equal(repo.owner, "octo");
  assert.equal(repo.language, "TypeScript");
  assert.equal(repo.permissions?.push, true);
});

test("cloneUrlForRepo honors the selected protocol with fallbacks", () => {
  const repo = normalizeGitHubRepo(rawRepo("alpha"));
  assert.ok(repo);
  assert.equal(cloneUrlForRepo(repo, "ssh"), "git@github.com:octo/alpha.git");
  assert.equal(cloneUrlForRepo(repo, "https"), "https://github.com/octo/alpha.git");
});

test("fetchGitHubCatalog follows pagination and falls back to cache on rate limit", async () => {
  const dir = mkdtempSync(join(tmpdir(), "repogarden-github-cache-"));
  const cacheFile = join(dir, "github-repos.json");
  try {
    let calls = 0;
    const firstFetch = async (url: string | URL | Request): Promise<Response> => {
      calls += 1;
      const text = url.toString();
      if (text.includes("page=2")) {
        return new Response(JSON.stringify([rawRepo("beta", 2)]), {
          status: 200,
          headers: { etag: "\"page-2\"" }
        });
      }
      return new Response(JSON.stringify([rawRepo("alpha", 1)]), {
        status: 200,
        headers: {
          etag: "\"page-1\"",
          link: '<https://api.github.com/user/repos?page=2>; rel="next"'
        }
      });
    };

    const fresh = await fetchGitHubCatalog(config, {
      cacheFile,
      token: "token",
      fetchImpl: firstFetch
    });
    assert.equal(calls, 2);
    assert.equal(fresh.fromCache, false);
    assert.deepEqual(fresh.repos.map((repo) => repo.fullName), ["octo/alpha", "octo/beta"]);

    const limited = await fetchGitHubCatalog(
      { ...config, cacheTtlMinutes: 0.001 },
      {
        cacheFile,
        token: "token",
        now: new Date(Date.now() + 60_000),
        fetchImpl: async () =>
          new Response("{}", {
            status: 403,
            headers: { "retry-after": "60", "x-ratelimit-remaining": "0" }
          })
      }
    );
    assert.equal(limited.fromCache, true);
    assert.equal(limited.stale, true);
    assert.match(limited.error ?? "", /rate limited/);
    assert.deepEqual(limited.repos.map((repo) => repo.fullName), ["octo/alpha", "octo/beta"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
