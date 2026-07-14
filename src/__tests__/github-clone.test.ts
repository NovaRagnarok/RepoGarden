import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  mkdirSync,
  mkdtempSync,
  existsSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  cloneGitHubRepoInto,
  createGitHubCloneCoordinator,
  GITHUB_CLONE_MESSAGE_MAX_CHARS,
  githubCloneTarget
} from "../lib/github-clone";
import type { GitHubRepoSnapshot } from "../lib/scanner-types";

class FakeStream extends EventEmitter {
  push(chunk: string): void {
    this.emit("data", Buffer.from(chunk, "utf8"));
  }
}

class FakeChild extends EventEmitter {
  stdout = new FakeStream();
  stderr = new FakeStream();
  killCalls: NodeJS.Signals[] = [];
  killResult = true;

  kill(signal: NodeJS.Signals = "SIGTERM"): boolean {
    this.killCalls.push(signal);
    return this.killResult;
  }
}

const repo: GitHubRepoSnapshot = {
  id: 1,
  fullName: "octo/alpha",
  owner: "octo",
  name: "alpha",
  private: false,
  fork: false,
  archived: false,
  disabled: false,
  htmlUrl: "https://github.com/octo/alpha",
  cloneUrl: "https://github.com/octo/alpha.git",
  sshUrl: "git@github.com:octo/alpha.git"
};

const withTempRoot = async (run: (root: string) => Promise<void>): Promise<void> => {
  const root = mkdtempSync(join(tmpdir(), "repogarden-clone-test-"));
  try {
    await run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

const waitFor = async (predicate: () => boolean, timeoutMs = 250): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) assert.fail("timed out waiting for test condition");
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
};

test("cloneGitHubRepoInto invokes one piped git clone in the selected root", async () => {
  await withTempRoot(async (root) => {
    const child = new FakeChild();
    const captured: Array<{
      command: string;
      args: string[];
      cwd: string;
      env: NodeJS.ProcessEnv;
      stdio: ["ignore", "pipe", "pipe"];
    }> = [];
    const promise = cloneGitHubRepoInto(
      { repo, root, protocol: "ssh" },
      {
        spawnCommand: (command, args, options) => {
          captured.push({ command, args, ...options });
          return child;
        }
      }
    );
    setImmediate(() => child.emit("close", 0, null));
    const result = await promise;

    assert.equal(captured.length, 1);
    assert.equal(captured[0].command, "git");
    assert.deepEqual(captured[0].args, [
      "clone",
      "git@github.com:octo/alpha.git",
      join(root, "alpha")
    ]);
    assert.equal(captured[0].cwd, root);
    assert.equal(captured[0].env.GIT_OPTIONAL_LOCKS, "0");
    assert.deepEqual(captured[0].stdio, ["ignore", "pipe", "pipe"]);
    assert.equal(result.ok, true);
    assert.equal(result.message, "cloned");
    assert.equal(existsSync(join(root, "alpha")), true);
  });
});

test("cloneGitHubRepoInto refuses an existing destination without spawning or modifying it", async () => {
  await withTempRoot(async (root) => {
    const target = githubCloneTarget(root, repo.name);
    mkdirSync(target);
    const marker = join(target, "keep.txt");
    writeFileSync(marker, "unchanged", "utf8");
    let spawnCalls = 0;

    const result = await cloneGitHubRepoInto(
      { repo, root, protocol: "https" },
      {
        spawnCommand: () => {
          spawnCalls += 1;
          return new FakeChild();
        }
      }
    );

    assert.equal(result.ok, false);
    assert.equal(result.message, "clone blocked: target already exists");
    assert.equal(spawnCalls, 0);
    assert.equal(readFileSync(marker, "utf8"), "unchanged");
  });
});

test("cloneGitHubRepoInto rejects repository names that could escape the selected root", async () => {
  await withTempRoot(async (root) => {
    let spawnCalls = 0;
    const result = await cloneGitHubRepoInto(
      { repo: { ...repo, name: "../outside" }, root, protocol: "https" },
      {
        spawnCommand: () => {
          spawnCalls += 1;
          return new FakeChild();
        }
      }
    );

    assert.equal(result.ok, false);
    assert.equal(result.message, "clone blocked: invalid repository name");
    assert.equal(spawnCalls, 0);
  });
});

test("clone coordinator reuses one in-flight process for repeated target activation", async () => {
  await withTempRoot(async (root) => {
    const child = new FakeChild();
    let spawnCalls = 0;
    const coordinator = createGitHubCloneCoordinator((request) =>
      cloneGitHubRepoInto(request, {
        spawnCommand: () => {
          spawnCalls += 1;
          return child;
        }
      })
    );
    const request = { repo, root, protocol: "https" as const };

    const first = coordinator.start(request);
    const repeated = coordinator.start(request);

    assert.equal(first.started, true);
    assert.equal(repeated.started, false);
    assert.equal(first.promise, repeated.promise);
    assert.equal(spawnCalls, 1);
    assert.equal(coordinator.isInFlight(first.target), true);

    child.emit("close", 0, null);
    assert.equal((await first.promise).ok, true);
    await Promise.resolve();
    assert.equal(coordinator.isInFlight(first.target), false);
  });
});

test("clone failure detail is actionable, terminal-safe, and bounded", async () => {
  await withTempRoot(async (root) => {
    const child = new FakeChild();
    const escape = String.fromCharCode(27);
    const bell = String.fromCharCode(7);
    const promise = cloneGitHubRepoInto(
      { repo, root, protocol: "https" },
      {
        captureLimitChars: 512,
        spawnCommand: () => child
      }
    );
    setImmediate(() => {
      child.stderr.push("discarded context ".repeat(100));
      child.stderr.push(
        `${escape}[31mfatal:${escape}[0m repository access denied; run gh auth login and retry ${escape}]52;c;hidden-data${bell}\n`
      );
      child.emit("close", 128, null);
    });

    const result = await promise;

    assert.equal(result.ok, false);
    assert.equal(result.exitCode, 128);
    assert.ok(result.stderr.length <= 512);
    assert.match(result.message, /^clone failed:/);
    assert.match(result.message, /auth login/);
    assert.ok(result.message.length <= GITHUB_CLONE_MESSAGE_MAX_CHARS);
    assert.doesNotMatch(result.message, /hidden-data/);
    assert.doesNotMatch(result.message, /[\u0000-\u001f\u007f-\u009f]/);
  });
});

test("clone timeout kills the child and resolves with bounded retry guidance", async () => {
  await withTempRoot(async (root) => {
    const child = new FakeChild();
    const result = await cloneGitHubRepoInto(
      { repo, root, protocol: "https" },
      { timeoutMs: 5, killGraceMs: 5, spawnCommand: () => child }
    );

    assert.equal(result.ok, false);
    assert.equal(result.timedOut, true);
    assert.deepEqual(child.killCalls, ["SIGKILL"]);
    assert.match(result.message, /timed out/);
    assert.match(result.message, /exit was not confirmed/);
    assert.match(result.message, /stop git before retrying/);
    assert.ok(result.message.length <= GITHUB_CLONE_MESSAGE_MAX_CHARS);
    child.emit("error", new Error("late kill error"));
    assert.equal(existsSync(join(root, repo.name)), true);
  });
});

test("timeout keeps one clone in flight until a late close even when kill returns false", async () => {
  await withTempRoot(async (root) => {
    const child = new FakeChild();
    child.killResult = false;
    let spawnCalls = 0;
    const coordinator = createGitHubCloneCoordinator((request) =>
      cloneGitHubRepoInto(request, {
        timeoutMs: 5,
        killGraceMs: 250,
        spawnCommand: () => {
          spawnCalls += 1;
          return child;
        }
      })
    );
    const request = { repo, root, protocol: "https" as const };
    const first = coordinator.start(request);
    let resolved = false;
    void first.promise.then(() => {
      resolved = true;
    });

    await waitFor(() => child.killCalls.length === 1);
    assert.equal(resolved, false);
    assert.equal(coordinator.isInFlight(first.target), true);

    const repeated = coordinator.start(request);
    assert.equal(repeated.started, false);
    assert.equal(repeated.promise, first.promise);
    assert.equal(spawnCalls, 1);

    child.emit("close", null, "SIGKILL");
    const result = await first.promise;
    assert.equal(result.timedOut, true);
    assert.match(result.message, /git stopped/);
    await Promise.resolve();
    assert.equal(coordinator.isInFlight(first.target), false);
  });
});

test("clone spawn errors become safe failure details", async () => {
  await withTempRoot(async (root) => {
    const child = new FakeChild();
    const promise = cloneGitHubRepoInto(
      { repo, root, protocol: "https" },
      { spawnCommand: () => child }
    );
    setImmediate(() => child.emit("error", new Error("git executable unavailable")));

    const result = await promise;
    assert.equal(result.ok, false);
    assert.equal(result.exitCode, null);
    assert.equal(result.message, "clone could not start: git executable unavailable");
    assert.equal(existsSync(join(root, repo.name)), false);
  });
});
