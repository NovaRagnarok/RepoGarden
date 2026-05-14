import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import { pickPullSummary, pullRepo, type PullResult, type PullStreamLine } from "../lib/git-pull";

const makeResult = (overrides: Partial<PullResult> = {}): PullResult => ({
  ok: false,
  exitCode: null,
  signal: null,
  stdout: "",
  stderr: "",
  durationMs: 0,
  timedOut: false,
  ...overrides,
});

class FakeStream extends EventEmitter {
  push(chunk: string) {
    this.emit("data", Buffer.from(chunk, "utf8"));
  }
}

class FakeChild extends EventEmitter {
  stdout = new FakeStream();
  stderr = new FakeStream();
  killCalls: NodeJS.Signals[] = [];

  kill(signal: NodeJS.Signals = "SIGTERM"): boolean {
    this.killCalls.push(signal);
    return true;
  }
}

test("pullRepo invokes git pull --ff-only with GIT_OPTIONAL_LOCKS=0", async () => {
  const captured: { cmd: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv }[] = [];
  const child = new FakeChild();
  const promise = pullRepo({
    cwd: "/tmp/repo",
    spawnCommand: (cmd, args, options) => {
      captured.push({ cmd, args, cwd: options.cwd, env: options.env });
      return child;
    },
  });
  setImmediate(() => child.emit("close", 0, null));
  await promise;

  assert.equal(captured.length, 1);
  assert.equal(captured[0].cmd, "git");
  assert.deepEqual(captured[0].args, ["pull", "--ff-only"]);
  assert.equal(captured[0].cwd, "/tmp/repo");
  assert.equal(captured[0].env.GIT_OPTIONAL_LOCKS, "0");
});

test("pullRepo resolves ok=true on exit code 0 with collected stdout", async () => {
  const child = new FakeChild();
  const promise = pullRepo({
    cwd: "/tmp/repo",
    spawnCommand: () => child,
  });
  setImmediate(() => {
    child.stdout.push("Updating abc..def\n");
    child.stdout.push("Fast-forward\n");
    child.emit("close", 0, null);
  });
  const result = await promise;

  assert.equal(result.ok, true);
  assert.equal(result.exitCode, 0);
  assert.equal(result.timedOut, false);
  assert.match(result.stdout, /Updating abc\.\.def/);
  assert.match(result.stdout, /Fast-forward/);
  assert.equal(result.stderr, "");
});

test("pullRepo resolves ok=false on non-zero exit and captures stderr", async () => {
  const child = new FakeChild();
  const promise = pullRepo({
    cwd: "/tmp/repo",
    spawnCommand: () => child,
  });
  setImmediate(() => {
    child.stderr.push("fatal: Not possible to fast-forward, aborting.\n");
    child.emit("close", 128, null);
  });
  const result = await promise;

  assert.equal(result.ok, false);
  assert.equal(result.exitCode, 128);
  assert.match(result.stderr, /Not possible to fast-forward/);
});

test("pullRepo resolves ok=false on spawn error", async () => {
  const child = new FakeChild();
  const promise = pullRepo({
    cwd: "/tmp/repo",
    spawnCommand: () => child,
  });
  setImmediate(() => child.emit("error", new Error("ENOENT git")));
  const result = await promise;

  assert.equal(result.ok, false);
  assert.equal(result.exitCode, null);
  assert.match(result.stderr, /ENOENT git/);
});

test("pullRepo kills the child and flags timedOut when it runs past timeoutMs", async () => {
  const child = new FakeChild();
  const promise = pullRepo({
    cwd: "/tmp/repo",
    timeoutMs: 10,
    spawnCommand: () => child,
  });
  // Simulate the kernel reaping the killed process: the SIGKILL handler we
  // wired up flips timedOut and calls kill(); the OS then emits close.
  setTimeout(() => child.emit("close", null, "SIGKILL"), 30);
  const result = await promise;

  assert.equal(result.timedOut, true);
  assert.equal(result.ok, false);
  assert.deepEqual(child.killCalls, ["SIGKILL"]);
});

test("pullRepo emits onLine for each newline-terminated chunk, splitting across writes", async () => {
  const child = new FakeChild();
  const lines: PullStreamLine[] = [];
  const promise = pullRepo({
    cwd: "/tmp/repo",
    spawnCommand: () => child,
    onLine: (entry) => lines.push(entry),
  });
  setImmediate(() => {
    child.stdout.push("From github.com:foo/bar\nUpdating abc..");
    child.stdout.push("def\r\nFast-forward\n");
    child.stderr.push("warning: refname is ambiguous\n");
    child.emit("close", 0, null);
  });
  await promise;

  assert.deepEqual(lines, [
    { stream: "stdout", line: "From github.com:foo/bar" },
    { stream: "stdout", line: "Updating abc..def" },
    { stream: "stdout", line: "Fast-forward" },
    { stream: "stderr", line: "warning: refname is ambiguous" },
  ]);
});

test("pickPullSummary returns 'already up to date' when git says so", () => {
  const summary = pickPullSummary(makeResult({ ok: true, stdout: "Already up to date.\n" }));
  assert.equal(summary, "already up to date");
});

test("pickPullSummary surfaces the Fast-forward line when present", () => {
  const stdout = "From github.com:foo/bar\n   abc..def main -> origin/main\nUpdating abc..def\nFast-forward\n one-file.ts | 2 +-\n";
  const summary = pickPullSummary(makeResult({ ok: true, stdout }));
  assert.equal(summary, "Fast-forward");
});

test("pickPullSummary falls back to first stdout line on success without fast-forward", () => {
  const summary = pickPullSummary(makeResult({ ok: true, stdout: "  Merge made by the 'ort' strategy.\n" }));
  assert.equal(summary, "Merge made by the 'ort' strategy.");
});

test("pickPullSummary trims 'fatal:' prefix on failures", () => {
  const summary = pickPullSummary(
    makeResult({ ok: false, exitCode: 128, stderr: "fatal: Not possible to fast-forward, aborting.\n" })
  );
  assert.equal(summary, "Not possible to fast-forward, aborting.");
});

test("pickPullSummary picks the fatal line through git's hint preamble", () => {
  // Modern `git pull --ff-only` on divergence emits this exact shape:
  // multiple `hint:` lines, then the real `fatal:` at the bottom.
  const stderr = [
    "hint: Diverging branches can't be fast-forwarded, you need to either:",
    "hint: ",
    "hint: \tgit merge --no-ff",
    "hint: ",
    "hint: or:",
    "hint: ",
    "hint: \tgit rebase",
    "hint: ",
    "hint: Disable this message with \"git config advice.diverging false\"",
    "fatal: Not possible to fast-forward, aborting.",
    "",
  ].join("\n");
  const summary = pickPullSummary(makeResult({ ok: false, exitCode: 128, stderr }));
  assert.equal(summary, "Not possible to fast-forward, aborting.");
});

test("pickPullSummary prefers 'error:' over hints when there's no fatal", () => {
  const stderr = "hint: skip me\nerror: failed to lock ref\n";
  const summary = pickPullSummary(makeResult({ ok: false, exitCode: 1, stderr }));
  assert.equal(summary, "failed to lock ref");
});

test("pickPullSummary reports timeout explicitly", () => {
  const summary = pickPullSummary(makeResult({ ok: false, timedOut: true }));
  assert.equal(summary, "timed out");
});

test("pickPullSummary falls back to exit code when stderr is empty", () => {
  const summary = pickPullSummary(makeResult({ ok: false, exitCode: 1 }));
  assert.equal(summary, "exit 1");
});

test("pullRepo records durationMs using injected clock", async () => {
  const child = new FakeChild();
  let t = 1000;
  const promise = pullRepo({
    cwd: "/tmp/repo",
    spawnCommand: () => child,
    now: () => t,
  });
  setImmediate(() => {
    t = 1750;
    child.emit("close", 0, null);
  });
  const result = await promise;

  assert.equal(result.durationMs, 750);
});
