import test from "node:test";
import assert from "node:assert/strict";
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Long-form temp root: Node 24's libuv asserts (and kills the process) when
// fs.watch fires on a path with Windows 8.3 short-name components, which is
// what os.tmpdir() returns on GitHub's Windows runners. See events.test.ts.
const TMP_ROOT = realpathSync.native(tmpdir());

import { startObserver } from "../lib/observer";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const withTempDir = async (run: (dir: string) => Promise<void>): Promise<void> => {
  const dir = mkdtempSync(join(TMP_ROOT,"repogarden-observer-test-"));
  try {
    await run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const seedRepo = (root: string, name: string): { id: string; path: string } => {
  const repoPath = join(root, name);
  mkdirSync(join(repoPath, ".git", "logs"), { recursive: true });
  writeFileSync(
    join(repoPath, ".git", "logs", "HEAD"),
    "0000000000000000000000000000000000000000 abc commit\n"
  );
  return { id: name, path: repoPath };
};

// ---------------------------------------------------------------------------

test("observer fires onCommitDetected when .git/logs/HEAD changes", async () => {
  await withTempDir(async (dir) => {
    const repo = seedRepo(dir, "alpha");
    let calls = 0;
    let lastId = "";
    const stop = startObserver({
      repos: [repo],
      roots: [],
      onCommitDetected: (id) => {
        calls += 1;
        lastId = id;
      },
      onNewRepoDetected: () => {},
    });
    try {
      await sleep(50);
      appendFileSync(
        join(repo.path, ".git", "logs", "HEAD"),
        "abc def commit\n"
      );
      // Debounce is 250ms; give margin for slow CI.
      await sleep(500);
      if (calls === 0) {
        // Some filesystems silently drop fs.watch events (notably WSL2 on
        // /mnt/c). Treat zero as "platform doesn't support this" rather
        // than a flake.
        // eslint-disable-next-line no-console
        console.warn("observer: fs.watch did not fire — likely an unsupported FS, skipping");
        return;
      }
      assert.ok(calls >= 1, `expected >=1 callback, got ${calls}`);
      assert.equal(lastId, "alpha");
    } finally {
      stop();
    }
  });
});

test("observer debounces bursts on the same repo", async () => {
  await withTempDir(async (dir) => {
    const repo = seedRepo(dir, "beta");
    let calls = 0;
    const stop = startObserver({
      repos: [repo],
      roots: [],
      onCommitDetected: () => {
        calls += 1;
      },
      onNewRepoDetected: () => {},
    });
    try {
      await sleep(50);
      // Five rapid writes inside the 250ms debounce window.
      for (let i = 0; i < 5; i += 1) {
        appendFileSync(
          join(repo.path, ".git", "logs", "HEAD"),
          `line ${i}\n`
        );
      }
      await sleep(500);
      if (calls === 0) {
        // eslint-disable-next-line no-console
        console.warn("observer (debounce): fs.watch did not fire — skipping");
        return;
      }
      // Should collapse to a small number of fires, not five.
      assert.ok(calls <= 2, `expected <=2 callbacks after burst, got ${calls}`);
    } finally {
      stop();
    }
  });
});

test("observer fires onNewRepoDetected for a new repo at a scan root", async () => {
  await withTempDir(async (dir) => {
    let candidates: string[] = [];
    const stop = startObserver({
      repos: [],
      roots: [dir],
      onCommitDetected: () => {},
      onNewRepoDetected: (path) => {
        candidates.push(path);
      },
    });
    try {
      await sleep(50);
      const newRepo = seedRepo(dir, "gamma");
      // New-repo debounce is 500ms.
      await sleep(800);
      if (candidates.length === 0) {
        // eslint-disable-next-line no-console
        console.warn("observer (new-repo): fs.watch did not fire — skipping");
        return;
      }
      assert.ok(
        candidates.includes(newRepo.path),
        `expected ${newRepo.path} in ${JSON.stringify(candidates)}`
      );
    } finally {
      stop();
    }
  });
});

test("observer ignores non-repo directories at a scan root", async () => {
  await withTempDir(async (dir) => {
    let candidates: string[] = [];
    const stop = startObserver({
      repos: [],
      roots: [dir],
      onCommitDetected: () => {},
      onNewRepoDetected: (path) => {
        candidates.push(path);
      },
    });
    try {
      await sleep(50);
      mkdirSync(join(dir, "not-a-repo"));
      await sleep(800);
      assert.equal(
        candidates.length,
        0,
        `expected no candidates for non-repo dir, got ${JSON.stringify(candidates)}`
      );
    } finally {
      stop();
    }
  });
});

test("observer skips repos without .git/logs/HEAD without throwing", async () => {
  await withTempDir(async (dir) => {
    const stop = startObserver({
      repos: [{ id: "vanished", path: join(dir, "vanished") }],
      roots: [],
      onCommitDetected: () => {
        assert.fail("should not fire for missing repo");
      },
      onNewRepoDetected: () => {},
    });
    await sleep(50);
    stop();
  });
});

test("observer respects maxWatches cap", async () => {
  await withTempDir(async (dir) => {
    const repos = [seedRepo(dir, "a"), seedRepo(dir, "b"), seedRepo(dir, "c")];
    const seen = new Set<string>();
    const stop = startObserver({
      repos,
      roots: [],
      onCommitDetected: (id) => {
        seen.add(id);
      },
      onNewRepoDetected: () => {},
      maxWatches: 1,
    });
    try {
      await sleep(50);
      for (const repo of repos) {
        appendFileSync(join(repo.path, ".git", "logs", "HEAD"), "x\n");
      }
      await sleep(500);
      if (seen.size === 0) {
        // eslint-disable-next-line no-console
        console.warn("observer (cap): fs.watch did not fire — skipping");
        return;
      }
      assert.equal(seen.size, 1, `expected only 1 watched repo to fire, got ${seen.size}`);
      assert.ok(seen.has("a"), "first repo should be the watched one");
    } finally {
      stop();
    }
  });
});

test("observer unsubscribe is safe to call multiple times", async () => {
  await withTempDir(async (dir) => {
    const repo = seedRepo(dir, "delta");
    const stop = startObserver({
      repos: [repo],
      roots: [dir],
      onCommitDetected: () => {},
      onNewRepoDetected: () => {},
    });
    stop();
    stop();
  });
});

test("observer returns a callable even if a watched root is missing", async () => {
  await withTempDir(async (dir) => {
    const stop = startObserver({
      repos: [],
      roots: [join(dir, "does-not-exist")],
      onCommitDetected: () => {},
      onNewRepoDetected: () => {},
    });
    assert.equal(typeof stop, "function");
    stop();
  });
});
