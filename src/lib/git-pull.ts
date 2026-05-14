import { spawn, spawnSync } from "node:child_process";

const DEFAULT_TIMEOUT_MS = 60_000;
const SHA_PROBE_TIMEOUT_MS = 4_000;

export interface PullResult {
  ok: boolean;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}

export interface PullStreamLine {
  stream: "stdout" | "stderr";
  line: string;
}

interface SpawnedStream {
  on(event: "data", listener: (chunk: Buffer | string) => void): SpawnedStream;
}

interface SpawnedChild {
  stdout: SpawnedStream | null;
  stderr: SpawnedStream | null;
  once(event: "error", listener: (err: Error) => void): SpawnedChild;
  once(event: "close", listener: (code: number | null, signal: NodeJS.Signals | null) => void): SpawnedChild;
  kill(signal?: NodeJS.Signals): boolean;
}

export interface PullOptions {
  cwd: string;
  timeoutMs?: number;
  onLine?: (entry: PullStreamLine) => void;
  spawnCommand?: (
    cmd: string,
    args: string[],
    options: { cwd: string; env: NodeJS.ProcessEnv }
  ) => SpawnedChild;
  now?: () => number;
}

const decodeChunk = (chunk: Buffer | string): string =>
  typeof chunk === "string" ? chunk : chunk.toString("utf8");

const wireStream = (
  stream: SpawnedStream | null,
  kind: "stdout" | "stderr",
  collected: string[],
  onLine: ((entry: PullStreamLine) => void) | undefined
): void => {
  if (!stream) return;
  let buffer = "";
  stream.on("data", (chunk) => {
    const text = decodeChunk(chunk);
    collected.push(text);
    if (!onLine) return;
    buffer += text;
    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex !== -1) {
      const line = buffer.slice(0, newlineIndex).replace(/\r$/, "");
      onLine({ stream: kind, line });
      buffer = buffer.slice(newlineIndex + 1);
      newlineIndex = buffer.indexOf("\n");
    }
  });
};

export const pullRepo = async ({
  cwd,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  onLine,
  spawnCommand,
  now = () => Date.now(),
}: PullOptions): Promise<PullResult> => {
  const start = now();
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_OPTIONAL_LOCKS: "0" };
  const args = ["pull", "--ff-only"];

  const child = spawnCommand
    ? spawnCommand("git", args, { cwd, env })
    : (spawn("git", args, { cwd, env }) as unknown as SpawnedChild);

  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  wireStream(child.stdout, "stdout", stdoutChunks, onLine);
  wireStream(child.stderr, "stderr", stderrChunks, onLine);

  return new Promise<PullResult>((resolve) => {
    let settled = false;
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    const settle = (result: PullResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    child.once("error", (err) => {
      stderrChunks.push(err.message);
      settle({
        ok: false,
        exitCode: null,
        signal: null,
        stdout: stdoutChunks.join(""),
        stderr: stderrChunks.join(""),
        durationMs: now() - start,
        timedOut,
      });
    });

    child.once("close", (code, signal) => {
      settle({
        ok: !timedOut && code === 0,
        exitCode: code,
        signal,
        stdout: stdoutChunks.join(""),
        stderr: stderrChunks.join(""),
        durationMs: now() - start,
        timedOut,
      });
    });
  });
};

const firstNonEmptyLine = (text: string): string | undefined =>
  text
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);

/** Boil a PullResult down to one line suitable for a journal payload or
 *  status banner. Prefers the most informative line we can find without
 *  asking the user to read multi-line output. */
export const pickPullSummary = (result: PullResult): string => {
  if (result.timedOut) return "timed out";
  if (result.ok) {
    if (/already up to date/i.test(result.stdout)) return "already up to date";
    const fastForward = result.stdout
      .split("\n")
      .map((line) => line.trim())
      .find((line) => /fast-forward/i.test(line));
    if (fastForward) return fastForward;
    return firstNonEmptyLine(result.stdout) ?? "pulled";
  }
  // Modern git pull on divergence emits several `hint:` lines before the
  // actual `fatal:`. The first non-empty stderr line is the hint, which is
  // misleading as a summary — prefer the fatal/error line when present.
  const stderrLines = result.stderr.split("\n").map((line) => line.trim());
  const fatal = stderrLines.find((line) => /^fatal:/i.test(line));
  if (fatal) return fatal.replace(/^fatal:\s*/i, "");
  const errorLine = stderrLines.find((line) => /^error:/i.test(line));
  if (errorLine) return errorLine.replace(/^error:\s*/i, "");
  const nonHint = stderrLines.find((line) => line.length > 0 && !/^hint:/i.test(line));
  if (nonHint) return nonHint;
  const anyLine = stderrLines.find((line) => line.length > 0);
  if (anyLine) return anyLine.replace(/^hint:\s*/i, "");
  return result.exitCode !== null ? `exit ${result.exitCode}` : "failed";
};

/** Read HEAD's sha synchronously. Short-timeout, used to capture the
 *  post-pull commit so the journal entry can record a sha and the workbench
 *  can compute commitsPulled. Returns undefined on any failure. */
export const readHeadSha = (cwd: string): string | undefined => {
  const result = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd,
    encoding: "utf8",
    timeout: SHA_PROBE_TIMEOUT_MS,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
  });
  if (result.status !== 0) return undefined;
  const out = (result.stdout ?? "").toString().trim();
  return out || undefined;
};

/** Count commits between two shas (exclusive..inclusive). Returns 0 when
 *  the shas are equal, undefined when git fails. */
export const countCommitsBetween = (
  cwd: string,
  fromSha: string | undefined,
  toSha: string | undefined
): number | undefined => {
  if (!fromSha || !toSha) return undefined;
  if (fromSha === toSha) return 0;
  const result = spawnSync("git", ["rev-list", "--count", `${fromSha}..${toSha}`], {
    cwd,
    encoding: "utf8",
    timeout: SHA_PROBE_TIMEOUT_MS,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
  });
  if (result.status !== 0) return undefined;
  const n = Number.parseInt((result.stdout ?? "").toString().trim(), 10);
  return Number.isFinite(n) ? n : undefined;
};
