import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { cloneUrlForRepo } from "@/lib/github";
import { expandPath } from "@/lib/scanner";
import type { GitHubRepoSnapshot } from "@/lib/scanner-types";

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_KILL_GRACE_MS = 5_000;
const DEFAULT_CAPTURE_LIMIT_CHARS = 16_384;
export const GITHUB_CLONE_MESSAGE_MAX_CHARS = 240;

interface CloneStream {
  on(event: "data", listener: (chunk: Buffer | string) => void): CloneStream;
}

interface SpawnedCloneChild {
  stdout: CloneStream | null;
  stderr: CloneStream | null;
  once(event: "error", listener: (error: Error) => void): SpawnedCloneChild;
  once(
    event: "close",
    listener: (code: number | null, signal: NodeJS.Signals | null) => void
  ): SpawnedCloneChild;
  kill(signal?: NodeJS.Signals): boolean;
}

interface CloneSpawnOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdio: ["ignore", "pipe", "pipe"];
}

export interface GitHubCloneRequest {
  repo: GitHubRepoSnapshot;
  root: string;
  protocol: "ssh" | "https";
}

export interface GitHubCloneResult {
  ok: boolean;
  target: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
  /** One terminal-safe, bounded line intended for a toast or status row. */
  message: string;
}

export interface GitHubCloneOptions {
  timeoutMs?: number;
  killGraceMs?: number;
  captureLimitChars?: number;
  spawnCommand?: (
    command: string,
    args: string[],
    options: CloneSpawnOptions
  ) => SpawnedCloneChild;
  now?: () => number;
}

const decodeChunk = (chunk: Buffer | string): string =>
  typeof chunk === "string" ? chunk : chunk.toString("utf8");

class BoundedTextCapture {
  private value = "";

  constructor(private readonly limit: number) {}

  append(chunk: Buffer | string): void {
    if (this.limit <= 0) return;
    const text = decodeChunk(chunk);
    if (text.length >= this.limit) {
      this.value = text.slice(-this.limit);
      return;
    }
    this.value = `${this.value}${text}`.slice(-this.limit);
  }

  read(): string {
    return this.value;
  }
}

// Strip terminal control sequences before subprocess text reaches Ink. OSC
// sequences are removed before CSI/other escapes so payloads such as terminal
// title or clipboard commands never survive as visible prose.
const stripTerminalControls = (value: string): string =>
  value
    .replace(/\u001b\](?:[^\u0007\u001b]|\u001b(?!\\))*(?:\u0007|\u001b\\)/g, "")
    .replace(/\u001b\][\s\S]*$/g, "")
    .replace(/(?:\u001b\[|\u009b)[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\u001b(?:[@-_]|[()][0-2A-Z0-9])/g, "")
    .replace(/\r/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, " ")
    .replace(/[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "");

const truncateDisplayText = (value: string, maxChars: number): string => {
  if (value.length <= maxChars) return value;
  if (maxChars <= 1) return value.slice(0, maxChars);
  return `${value.slice(0, maxChars - 1)}…`;
};

export const sanitizeGitHubCloneText = (
  value: string,
  maxChars = GITHUB_CLONE_MESSAGE_MAX_CHARS
): string =>
  truncateDisplayText(
    stripTerminalControls(value).replace(/\s+/g, " ").trim(),
    Math.max(0, maxChars)
  );

const safeOutputLines = (value: string): string[] =>
  stripTerminalControls(value)
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0);

const pickFailureDetail = (stderr: string, stdout: string): string | undefined => {
  const stderrLines = safeOutputLines(stderr);
  const stdoutLines = safeOutputLines(stdout);
  for (const line of [...stderrLines].reverse()) {
    const preferred = line.match(/(?:^|\s)(?:fatal|error):\s*(.+)$/i);
    if (preferred) return preferred[1];
  }
  const nonHint = [...stderrLines].reverse().find((line) => !/^hint:/i.test(line));
  if (nonHint) return nonHint;
  return stderrLines.at(-1) ?? stdoutLines.at(-1);
};

const boundedMessage = (value: string): string =>
  sanitizeGitHubCloneText(value, GITHUB_CLONE_MESSAGE_MAX_CHARS);

export const githubCloneTarget = (root: string, repoName: string): string =>
  join(expandPath(root), repoName);

const preflightFailure = (
  target: string,
  start: number,
  now: () => number,
  message: string
): GitHubCloneResult => ({
  ok: false,
  target,
  exitCode: null,
  signal: null,
  stdout: "",
  stderr: "",
  timedOut: false,
  durationMs: Math.max(0, now() - start),
  message: boundedMessage(message)
});

export const cloneGitHubRepoInto = async (
  request: GitHubCloneRequest,
  options: GitHubCloneOptions = {}
): Promise<GitHubCloneResult> => {
  const now = options.now ?? (() => Date.now());
  const start = now();
  const expandedRoot = expandPath(request.root);
  const target = githubCloneTarget(expandedRoot, request.repo.name);

  if (
    request.repo.name.length === 0 ||
    request.repo.name === "." ||
    request.repo.name === ".." ||
    /[\\/]/.test(request.repo.name)
  ) {
    return preflightFailure(target, start, now, "clone blocked: invalid repository name");
  }
  if (!existsSync(expandedRoot)) {
    return preflightFailure(target, start, now, "clone blocked: root does not exist");
  }
  try {
    if (!statSync(expandedRoot).isDirectory()) {
      return preflightFailure(target, start, now, "clone blocked: root is not a directory");
    }
  } catch (error) {
    return preflightFailure(
      target,
      start,
      now,
      `clone blocked: ${error instanceof Error ? error.message : "could not inspect root"}`
    );
  }
  // Git accepts an existing empty directory as a clone target. Refuse every
  // existing target before spawn so an explicit clone never writes into one.
  if (existsSync(target)) {
    return preflightFailure(target, start, now, "clone blocked: target already exists");
  }
  // Claim the target atomically before spawning. Git permits cloning into an
  // existing empty directory, so this closes the check/spawn race without
  // ever letting RepoGarden write into a destination another actor created.
  try {
    mkdirSync(target);
  } catch (error) {
    const detail = existsSync(target)
      ? "target already exists"
      : error instanceof Error
        ? error.message
        : "could not reserve target";
    return preflightFailure(target, start, now, `clone blocked: ${detail}`);
  }

  const removeEmptyReservation = (): void => {
    try {
      rmdirSync(target);
    } catch {
      // If git wrote anything, leave the partial clone for the user to inspect
      // rather than recursively deleting a directory after a process failure.
    }
  };

  const captureLimit = Math.max(0, options.captureLimitChars ?? DEFAULT_CAPTURE_LIMIT_CHARS);
  const stdout = new BoundedTextCapture(captureLimit);
  const stderr = new BoundedTextCapture(captureLimit);
  const timeoutMs = Math.max(1, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const killGraceMs = Math.max(1, options.killGraceMs ?? DEFAULT_KILL_GRACE_MS);
  const url = cloneUrlForRepo(request.repo, request.protocol);
  const spawnCommand = options.spawnCommand ?? ((command, args, spawnOptions) =>
    spawn(command, args, spawnOptions) as unknown as SpawnedCloneChild);

  let child: SpawnedCloneChild;
  try {
    child = spawnCommand("git", ["clone", url, target], {
      cwd: expandedRoot,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
      stdio: ["ignore", "pipe", "pipe"]
    });
  } catch (error) {
    removeEmptyReservation();
    const detail = error instanceof Error ? error.message : "unknown process error";
    return preflightFailure(target, start, now, `clone could not start: ${detail}`);
  }

  child.stdout?.on("data", (chunk) => stdout.append(chunk));
  child.stderr?.on("data", (chunk) => stderr.append(chunk));

  return new Promise<GitHubCloneResult>((resolve) => {
    let settled = false;
    let timedOut = false;
    let killRequested = false;
    let killGraceTimer: ReturnType<typeof setTimeout> | undefined;

    const settle = ({
      ok,
      exitCode,
      signal,
      timedOut,
      message
    }: {
      ok: boolean;
      exitCode: number | null;
      signal: NodeJS.Signals | null;
      timedOut: boolean;
      message: string;
    }): void => {
      if (settled) return;
      settled = true;
      clearTimeout(executionTimer);
      if (killGraceTimer) clearTimeout(killGraceTimer);
      resolve({
        ok,
        target,
        exitCode,
        signal,
        stdout: stdout.read(),
        stderr: stderr.read(),
        timedOut,
        durationMs: Math.max(0, now() - start),
        message: boundedMessage(message)
      });
    };

    const executionTimer = setTimeout(() => {
      timedOut = true;
      try {
        killRequested = child.kill("SIGKILL");
      } catch (error) {
        stderr.append(error instanceof Error ? error.message : "could not stop git");
      }
      if (settled) return;
      // Keep the coordinator and UI in-flight until close confirms the child
      // stopped. The grace fallback keeps the operation bounded even for a
      // broken process implementation that never emits close after kill().
      killGraceTimer = setTimeout(() => {
        settle({
          ok: false,
          exitCode: null,
          signal: null,
          timedOut: true,
          message: `clone timed out after ${Math.ceil(timeoutMs / 1000)}s and process exit was not confirmed${killRequested ? "" : " (termination signal was not accepted)"}; leave the target in place and stop git before retrying`
        });
      }, killGraceMs);
    }, timeoutMs);

    child.once("error", (error) => {
      if (settled) return;
      stderr.append(error.message);
      if (timedOut) return;
      removeEmptyReservation();
      settle({
        ok: false,
        exitCode: null,
        signal: null,
        timedOut: false,
        message: `clone could not start: ${error.message}`
      });
    });

    child.once("close", (code, signal) => {
      if (settled) return;
      const ok = code === 0;
      if (ok) {
        settle({
          ok: true,
          exitCode: code,
          signal,
          timedOut: false,
          message: "cloned"
        });
        return;
      }
      if (timedOut) {
        settle({
          ok: false,
          exitCode: code,
          signal,
          timedOut: true,
          message: `clone timed out after ${Math.ceil(timeoutMs / 1000)}s; git stopped, remove the partial target, then retry`
        });
        return;
      }
      const detail = pickFailureDetail(stderr.read(), stdout.read());
      settle({
        ok: false,
        exitCode: code,
        signal,
        timedOut: false,
        message: detail
          ? `clone failed: ${detail}; remove the partial target before retrying`
          : `clone failed with exit ${code ?? "unknown"}; remove the partial target before retrying`
      });
    });
  });
};

export interface GitHubCloneStart {
  target: string;
  started: boolean;
  promise: Promise<GitHubCloneResult>;
}

export interface GitHubCloneCoordinator {
  start(request: GitHubCloneRequest): GitHubCloneStart;
  isInFlight(target: string): boolean;
}

export type GitHubCloneExecutor = (
  request: GitHubCloneRequest
) => Promise<GitHubCloneResult>;

/** Target-scoped single-flight wrapper. A repeated activation receives the
 *  existing promise and never invokes the clone executor a second time. */
export const createGitHubCloneCoordinator = (
  execute: GitHubCloneExecutor = (request) => cloneGitHubRepoInto(request)
): GitHubCloneCoordinator => {
  const inFlight = new Map<string, Promise<GitHubCloneResult>>();

  return {
    start(request) {
      const target = githubCloneTarget(request.root, request.repo.name);
      const current = inFlight.get(target);
      if (current) return { target, started: false, promise: current };

      let promise: Promise<GitHubCloneResult>;
      try {
        promise = Promise.resolve(execute(request));
      } catch (error) {
        promise = Promise.reject(error);
      }
      inFlight.set(target, promise);
      const clear = () => {
        if (inFlight.get(target) === promise) inFlight.delete(target);
      };
      void promise.then(clear, clear);
      return { target, started: true, promise };
    },
    isInFlight(target) {
      return inFlight.has(target);
    }
  };
};
