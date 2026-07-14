import { spawn, spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  statSync,
} from "node:fs";
import { readFile, stat as fsStat } from "node:fs/promises";
import { cpus, homedir } from "node:os";
import { basename, isAbsolute, join, resolve } from "node:path";

import {
  buildUpdatedCache,
  loadScanCache,
  lookupCachedScan,
  saveScanCache,
  type ScanCacheMap
} from "./scan-cache";
import {
  buildGitHubRepoMap,
  parseGitHubRemoteUrl
} from "./github";
import type {
  DirtyFileChange,
  DirtyFileStatus,
  GitHubRepoSnapshot,
  RecentCommit,
  RepoRemote,
  RootProgress,
  ScannedRepo
} from "./scanner-types";

export type {
  DirtyFileChange,
  DirtyFileSkipReason,
  DirtyFileStatus,
  GitHubRepoSnapshot,
  RecentCommit,
  RepoRemote,
  RootProgress,
  ScannedRepo
} from "./scanner-types";

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".turbo",
  ".cache",
  "dist",
  "build",
  "target",
  ".next",
  ".nuxt",
  ".venv",
  "venv",
  "__pycache__",
  ".tox"
]);

const LANGUAGE_BY_EXT: Record<string, string> = {
  ts: "TypeScript",
  tsx: "TypeScript",
  js: "JavaScript",
  jsx: "JavaScript",
  mjs: "JavaScript",
  cjs: "JavaScript",
  rs: "Rust",
  go: "Go",
  py: "Python",
  rb: "Ruby",
  java: "Java",
  kt: "Kotlin",
  swift: "Swift",
  cs: "C#",
  c: "C",
  h: "C",
  cpp: "C++",
  cc: "C++",
  hpp: "C++",
  php: "PHP",
  ex: "Elixir",
  exs: "Elixir",
  erl: "Erlang",
  clj: "Clojure",
  cljs: "Clojure",
  hs: "Haskell",
  scala: "Scala",
  ml: "OCaml",
  lua: "Lua",
  sh: "Shell",
  bash: "Shell",
  zsh: "Shell",
  md: "Markdown",
  vue: "Vue",
  svelte: "Svelte",
  dart: "Dart",
  zig: "Zig"
};

export const expandPath = (input: string): string => {
  const trimmed = input.trim();
  if (!trimmed) return trimmed;
  if (trimmed === "~" || trimmed.startsWith("~/")) {
    return resolve(join(homedir(), trimmed.slice(1)));
  }
  return resolve(trimmed);
};

export const tildify = (path: string): string => {
  const home = homedir();
  if (path === home) return "~";
  if (path.startsWith(home + "/")) return "~" + path.slice(home.length);
  return path;
};

interface GitResult {
  stdout: string;
  stderr: string;
  ok: boolean;
}

const GIT_TIMEOUT_MS = 4000;

const runGit = (cwd: string, args: string[]): GitResult => {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    timeout: GIT_TIMEOUT_MS,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" }
  });
  return {
    stdout: (result.stdout ?? "").toString().trimEnd(),
    stderr: (result.stderr ?? "").toString().trimEnd(),
    ok: result.status === 0 && result.error === undefined
  };
};

/**
 * Async git via `spawn`, used by the parallel scanner worker pool. Returns
 * the same shape as `runGit` so call sites are interchangeable — only the
 * inspection wrappers know which flavor they're calling. Per-call timeout
 * is enforced via setTimeout + SIGKILL rather than spawn's `timeout` option,
 * which is unreliable across Node versions for kill semantics.
 */
const runGitAsync = (cwd: string, args: string[]): Promise<GitResult> => {
  return new Promise((resolve) => {
    const child = spawn("git", args, {
      cwd,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" }
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok, stdout: stdout.trimEnd(), stderr: stderr.trimEnd() });
    };
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // Already exited between the timer firing and our kill — ignore.
      }
      finish(false);
    }, GIT_TIMEOUT_MS);
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", () => finish(false));
    child.on("close", (code) => finish(code === 0));
  });
};

const attachGitHubMetadata = (
  scan: ScannedRepo,
  remote: RepoRemote | undefined,
  githubByFullName?: ReadonlyMap<string, GitHubRepoSnapshot>
): ScannedRepo => {
  if (!remote) return scan;
  const github = githubByFullName?.get(remote.fullName.toLowerCase());
  return {
    ...scan,
    remote,
    github
  };
};

const readGitHubRemote = (repoPath: string): RepoRemote | undefined => {
  const remote = runGit(repoPath, ["config", "--get", "remote.origin.url"]);
  if (!remote.ok || !remote.stdout) return undefined;
  return parseGitHubRemoteUrl(remote.stdout) ?? undefined;
};

const readGitHubRemoteAsync = async (repoPath: string): Promise<RepoRemote | undefined> => {
  const remote = await runGitAsync(repoPath, ["config", "--get", "remote.origin.url"]);
  if (!remote.ok || !remote.stdout) return undefined;
  return parseGitHubRemoteUrl(remote.stdout) ?? undefined;
};

const SPARKLINE_DAYS = 30;
const DIRTY_FILE_LIMIT = 3;
const DIRTY_STATUS_LIMIT = 80;
const DIRTY_LINE_CAP = 100;
/** Hard cap on bytes loaded for a single dirty-file preview. Anything
 *  larger gets a "too-large" placeholder so a minified bundle or a stray
 *  log file doesn't pull megabytes into render state. */
const DIRTY_PREVIEW_MAX_BYTES = 256 * 1024;
/** Bytes sampled from the head of a working-tree file to sniff binary
 *  content. NUL byte anywhere in the sample → treated as binary. */
const BINARY_SNIFF_BYTES = 8 * 1024;

const SENSITIVE_BASENAME_PATTERNS: RegExp[] = [
  /^\.env(\.|$)/i,
  /^\.npmrc$/i,
  /^\.netrc$/i,
  /^\.pypirc$/i,
  /^id_rsa(\.pub)?$/i,
  /^id_dsa(\.pub)?$/i,
  /^id_ecdsa(\.pub)?$/i,
  /^id_ed25519(\.pub)?$/i,
  /\.pem$/i,
  /\.key$/i,
  /\.pfx$/i,
  /\.p12$/i,
  /\.keystore$/i,
  /^credentials(\.json|\.yaml|\.yml)?$/i,
  /^secrets?(\.json|\.yaml|\.yml|\.env)?$/i,
];

const isSensitiveFilename = (filename: string): boolean => {
  const base = basename(filename);
  return SENSITIVE_BASENAME_PATTERNS.some((re) => re.test(base));
};

const looksBinary = (absPath: string): boolean => {
  try {
    const fd = openSync(absPath, "r");
    try {
      const buf = Buffer.alloc(BINARY_SNIFF_BYTES);
      const bytes = readSync(fd, buf, 0, BINARY_SNIFF_BYTES, 0);
      for (let i = 0; i < bytes; i += 1) {
        if (buf[i] === 0) return true;
      }
      return false;
    } finally {
      closeSync(fd);
    }
  } catch {
    // If we can't sniff, be conservative and treat as binary so we skip
    // the content read rather than risk loading something surprising.
    return true;
  }
};

const buildRecentCommitDays = (repoPath: string): number[] | undefined => {
  const log = runGit(repoPath, [
    "log",
    `--since=${SPARKLINE_DAYS}.days`,
    "--max-count=1000",
    "--format=%cd",
    "--date=format:%Y-%m-%d",
  ]);
  if (!log.ok) return undefined;
  return bucketCommitDays(log.stdout);
};

interface StatusBranch {
  branch?: string;
  ahead?: number;
  behind?: number;
  isDirty: boolean;
  headSha?: string;
}

/** Parse `git status --porcelain=v2 --branch` output. Shared by the sync
 *  light probe and the async skeleton inspector so both interpret git's
 *  output the same way. Returns the empty-but-clean state for empty input. */
const parseStatusBranch = (stdout: string): StatusBranch => {
  let branch: string | undefined;
  let headSha: string | undefined;
  let ahead: number | undefined;
  let behind: number | undefined;
  let isDirty = false;

  for (const line of stdout.split(/\r?\n/)) {
    if (line.startsWith("# branch.oid ")) {
      const sha = line.slice("# branch.oid ".length).trim();
      headSha = sha === "(initial)" ? undefined : sha;
    } else if (line.startsWith("# branch.head ")) {
      const ref = line.slice("# branch.head ".length).trim();
      branch = ref === "(detached)" ? undefined : ref;
    } else if (line.startsWith("# branch.ab ")) {
      const match = line.match(/\+(-?\d+)\s+-(-?\d+)/);
      if (match) {
        ahead = Number.parseInt(match[1], 10);
        behind = Number.parseInt(match[2], 10);
      }
    } else if (line && !line.startsWith("#")) {
      isDirty = true;
    }
  }

  return { branch, ahead, behind, isDirty, headSha };
};

/** Parse `git log -5 --pretty=%H%x09%s%x09%cI%x09%an` output into commits. */
const parseRecentCommitsLog = (stdout: string): RecentCommit[] => {
  return stdout
    .split("\n")
    .filter((line) => line.includes("\t"))
    .map((line) => {
      const [sha, subject, committedAt, author] = line.split("\t");
      return {
        sha,
        shortSha: sha.slice(0, 7),
        subject,
        committedAt,
        author
      };
    });
};

/** Bucket dated commit lines (one YYYY-MM-DD per line, newest-first git
 *  default) into the most-recent SPARKLINE_DAYS days, oldest at index 0. */
const bucketCommitDays = (stdout: string): number[] => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const buckets = new Array<number>(SPARKLINE_DAYS).fill(0);
  for (const raw of stdout.split("\n")) {
    const day = raw.trim();
    if (!day) continue;
    const date = new Date(day + "T00:00:00");
    if (Number.isNaN(date.getTime())) continue;
    const diff = Math.round(
      (today.getTime() - date.getTime()) / (1000 * 60 * 60 * 24)
    );
    if (diff < 0 || diff >= SPARKLINE_DAYS) continue;
    buckets[SPARKLINE_DAYS - 1 - diff] += 1;
  }
  return buckets;
};

const buildDirtyChanges = (
  repoPath: string
): { changes: DirtyFileChange[]; total: number } | undefined => {
  // NUL-delimited output so filenames with newlines, quotes, or spaces
  // survive the split. Plain newline splitting would corrupt those.
  const list = runGit(repoPath, ["diff", "--name-only", "-z", "HEAD"]);
  if (!list.ok) return undefined;
  const files = list.stdout
    .split("\0")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (files.length === 0) return { changes: [], total: 0 };

  const changes: DirtyFileChange[] = [];
  for (const filename of files.slice(0, DIRTY_FILE_LIMIT)) {
    if (isSensitiveFilename(filename)) {
      changes.push({
        filename,
        oldText: "",
        newText: "",
        truncated: false,
        skipped: "sensitive",
      });
      continue;
    }

    const absPath = join(repoPath, filename);
    let workingSize = 0;
    try {
      workingSize = statSync(absPath).size;
    } catch {
      // File may have been deleted in the working tree; fall through and
      // let the read attempt produce "" so the diff shows a deletion.
    }

    if (workingSize > DIRTY_PREVIEW_MAX_BYTES) {
      changes.push({
        filename,
        oldText: "",
        newText: "",
        truncated: false,
        skipped: "too-large",
      });
      continue;
    }

    if (workingSize > 0 && looksBinary(absPath)) {
      changes.push({
        filename,
        oldText: "",
        newText: "",
        truncated: false,
        skipped: "binary",
      });
      continue;
    }

    const head = runGit(repoPath, ["show", `HEAD:${filename}`]);
    let working = "";
    try {
      working = readFileSync(absPath, "utf8");
    } catch {
      working = "";
    }
    const oldLines = (head.ok ? head.stdout : "").split("\n");
    const newLines = working.split("\n");
    const truncated =
      oldLines.length > DIRTY_LINE_CAP || newLines.length > DIRTY_LINE_CAP;
    changes.push({
      filename,
      oldText: oldLines.slice(0, DIRTY_LINE_CAP).join("\n"),
      newText: newLines.slice(0, DIRTY_LINE_CAP).join("\n"),
      truncated,
    });
  }
  return { changes, total: files.length };
};

const statusCodeLabel = (code: string): string => {
  if (code === "??") return "untracked";
  if (code.includes("U")) return "conflicted";
  const chars = code.split("").filter((char) => char !== " ");
  if (chars.includes("R")) return "renamed";
  if (chars.includes("C")) return "copied";
  if (chars.includes("A")) return "added";
  if (chars.includes("D")) return "deleted";
  if (chars.includes("M")) return "modified";
  if (chars.includes("T")) return "typechange";
  return "changed";
};

const normalizeStatusEntry = (
  code: string,
  filename: string,
  renamedFrom?: string
): DirtyFileStatus | null => {
  const normalizedCode = code.padEnd(2, " ").slice(0, 2);
  const cleanFilename = filename.trim();
  if (!cleanFilename) return null;
  const staged = normalizedCode[0] !== " " && normalizedCode !== "??";
  const unstaged = normalizedCode[1] !== " " && normalizedCode !== "??";
  const untracked = normalizedCode === "??";
  return {
    filename: cleanFilename,
    code: normalizedCode,
    label: statusCodeLabel(normalizedCode),
    staged,
    unstaged,
    untracked,
    renamedFrom: renamedFrom?.trim() || undefined,
  };
};

/**
 * Parse `git status --porcelain=v1` output. Supports newline-separated output
 * and the NUL-separated `-z` form; rename/copy rows keep both old and new path
 * when git provides them.
 */
export const parseGitStatusPorcelain = (raw: string): DirtyFileStatus[] => {
  if (!raw.trim()) return [];
  const nulSeparated = raw.includes("\0");
  const entries = nulSeparated
    ? raw.split("\0").filter((entry) => entry.length > 0)
    : raw.split(/\r?\n/).filter((entry) => entry.trim().length > 0);

  const files: DirtyFileStatus[] = [];
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    if (entry.length < 3) continue;
    const code = entry.slice(0, 2);
    let filename = entry.slice(3);
    let renamedFrom: string | undefined;

    if (code[0] === "R" || code[0] === "C") {
      if (nulSeparated && i + 1 < entries.length) {
        renamedFrom = entries[i + 1];
        i += 1;
      } else if (filename.includes(" -> ")) {
        const [from, to] = filename.split(" -> ");
        renamedFrom = from;
        filename = to ?? filename;
      }
    }

    const status = normalizeStatusEntry(code, filename, renamedFrom);
    if (status) files.push(status);
  }
  return files;
};

const buildDirtyFileStatuses = (
  repoPath: string
): { files: DirtyFileStatus[]; total: number } | undefined => {
  const status = runGit(repoPath, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  if (!status.ok) return undefined;
  const files = parseGitStatusPorcelain(status.stdout);
  return { files: files.slice(0, DIRTY_STATUS_LIMIT), total: files.length };
};

/** Async sibling of `buildDirtyChanges` for the parallel scanner. Uses
 *  `runGitAsync` for the `git diff` and per-file `git show HEAD:...` calls so
 *  other workers in the pool can interleave their git work instead of waiting
 *  on a synchronous spawn. Filesystem reads stay sync — each is bounded to
 *  `DIRTY_PREVIEW_MAX_BYTES` and runs against the local working tree, so the
 *  blocking window is small. */
const buildDirtyChangesAsync = async (
  repoPath: string
): Promise<{ changes: DirtyFileChange[]; total: number } | undefined> => {
  const list = await runGitAsync(repoPath, ["diff", "--name-only", "-z", "HEAD"]);
  if (!list.ok) return undefined;
  const files = list.stdout
    .split("\0")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (files.length === 0) return { changes: [], total: 0 };

  const changes: DirtyFileChange[] = [];
  for (const filename of files.slice(0, DIRTY_FILE_LIMIT)) {
    if (isSensitiveFilename(filename)) {
      changes.push({ filename, oldText: "", newText: "", truncated: false, skipped: "sensitive" });
      continue;
    }

    const absPath = join(repoPath, filename);
    let workingSize = 0;
    try {
      workingSize = statSync(absPath).size;
    } catch {
      // File may have been deleted in the working tree; fall through.
    }

    if (workingSize > DIRTY_PREVIEW_MAX_BYTES) {
      changes.push({ filename, oldText: "", newText: "", truncated: false, skipped: "too-large" });
      continue;
    }

    if (workingSize > 0 && looksBinary(absPath)) {
      changes.push({ filename, oldText: "", newText: "", truncated: false, skipped: "binary" });
      continue;
    }

    const head = await runGitAsync(repoPath, ["show", `HEAD:${filename}`]);
    let working = "";
    try {
      working = readFileSync(absPath, "utf8");
    } catch {
      working = "";
    }
    const oldLines = (head.ok ? head.stdout : "").split("\n");
    const newLines = working.split("\n");
    const truncated = oldLines.length > DIRTY_LINE_CAP || newLines.length > DIRTY_LINE_CAP;
    changes.push({
      filename,
      oldText: oldLines.slice(0, DIRTY_LINE_CAP).join("\n"),
      newText: newLines.slice(0, DIRTY_LINE_CAP).join("\n"),
      truncated
    });
  }
  return { changes, total: files.length };
};

const buildDirtyFileStatusesAsync = async (
  repoPath: string
): Promise<{ files: DirtyFileStatus[]; total: number } | undefined> => {
  const status = await runGitAsync(repoPath, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all"
  ]);
  if (!status.ok) return undefined;
  const files = parseGitStatusPorcelain(status.stdout);
  return { files: files.slice(0, DIRTY_STATUS_LIMIT), total: files.length };
};

const isDir = (path: string): boolean => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

export const findRepos = (root: string, maxDepth = 4): string[] => {
  const repos: string[] = [];
  const expandedRoot = expandPath(root);
  if (!existsSync(expandedRoot) || !isDir(expandedRoot)) {
    return repos;
  }

  const stack: { path: string; depth: number }[] = [{ path: expandedRoot, depth: 0 }];

  while (stack.length > 0) {
    const { path, depth } = stack.pop()!;
    if (existsSync(join(path, ".git"))) {
      repos.push(path);
      // Keep descending so nested repos under a parent monorepo (or a
      // folder-of-projects that itself happens to be a git repo) are found.
    }
    if (depth >= maxDepth) continue;

    let entries: string[];
    try {
      entries = readdirSync(path);
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (entry.startsWith(".") && entry !== ".git") continue;
      if (SKIP_DIRS.has(entry)) continue;
      const full = join(path, entry);
      if (isDir(full)) {
        stack.push({ path: full, depth: depth + 1 });
      }
    }
  }

  return repos.sort();
};

// Extra exclusions on top of SKIP_DIRS — these are files that match a
// recognized source extension but shouldn't count toward "mass" because
// they're generated, vendored, or otherwise not authored content.
// "deps" covers Erlang/Elixir's deps/ dir (mix's node_modules-equivalent);
// "external"/"extern" cover Bazel and CMake vendor trees. NB: we deliberately
// skip plural "libs" — in Nx/Angular monorepos that's the source root, not a
// vendor dir. Singular "lib" is also legitimate source in many projects.
const SKIP_DIR_NAMES_EXTRA = new Set([
  "vendor",
  "third_party",
  "third-party",
  "external",
  "extern",
  "deps"
]);
const SKIP_FILENAMES = new Set([
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "composer.lock",
  "Gemfile.lock",
  "Cargo.lock",
  "poetry.lock"
]);
const isNoiseFile = (entry: string): boolean => {
  if (SKIP_FILENAMES.has(entry)) return true;
  if (entry.endsWith(".min.js") || entry.endsWith(".min.css")) return true;
  if (entry.endsWith(".map")) return true;
  // Generated TypeScript declarations and a few common codegen suffixes.
  // `.d.ts` files balloon repos with no hand-written content; `.generated.*`
  // and `.gen.*` are the prevailing conventions for codegen output.
  if (entry.endsWith(".d.ts")) return true;
  if (entry.includes(".generated.") || entry.includes(".gen.")) return true;
  return false;
};

// Recognized as a "language" for primaryLanguage detection, but doesn't count
// toward creature mass. Markdown is the obvious one — a docs-heavy repo
// shouldn't render as a massive creature just because it has a long README.
const MASS_EXCLUDED_EXTS = new Set(["md"]);

interface RepoTreeStats {
  primaryLanguage?: string;
  fileCount: number;
  sourceLines: number;
}

// Files bigger than this are estimated as bytes/40 instead of being read end
// to end. A `pnpm-lock.yaml` lookalike or an accidentally-committed dump
// shouldn't make the Phase 3 walk crawl.
const LINE_COUNT_READ_CAP_BYTES = 1024 * 1024;

const countLinesIn = (path: string, byteSize: number): number => {
  if (byteSize === 0) return 0;
  if (byteSize > LINE_COUNT_READ_CAP_BYTES) {
    // ~40 bytes/line is a reasonable cross-language average; only used for
    // outliers, where the exact number doesn't change the log-bucket anyway.
    return Math.max(1, Math.round(byteSize / 40));
  }
  let buf: Buffer;
  try {
    buf = readFileSync(path);
  } catch {
    return Math.max(1, Math.round(byteSize / 40));
  }
  let lines = 0;
  for (let i = 0; i < buf.length; i += 1) {
    if (buf[i] === 0x0a) lines += 1;
  }
  // A file without a trailing newline still has one logical final line.
  if (buf.length > 0 && buf[buf.length - 1] !== 0x0a) lines += 1;
  return lines;
};

const scanRepoTree = (repoPath: string): RepoTreeStats => {
  const counts = new Map<string, number>();
  let fileCount = 0;
  let sourceLines = 0;

  const walk = (dir: string, depth: number): void => {
    if (depth > 2) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.startsWith(".") || SKIP_DIRS.has(entry)) continue;
      if (SKIP_DIR_NAMES_EXTRA.has(entry)) continue;
      const full = join(dir, entry);
      let s;
      try {
        s = statSync(full);
      } catch {
        continue;
      }
      if (s.isDirectory()) {
        walk(full, depth + 1);
      } else if (s.isFile()) {
        if (isNoiseFile(entry)) continue;
        const dot = entry.lastIndexOf(".");
        if (dot < 0) continue;
        const ext = entry.slice(dot + 1).toLowerCase();
        const lang = LANGUAGE_BY_EXT[ext];
        if (!lang) continue;
        counts.set(lang, (counts.get(lang) ?? 0) + s.size);
        if (MASS_EXCLUDED_EXTS.has(ext)) continue;
        fileCount += 1;
        sourceLines += countLinesIn(full, s.size);
      }
    }
  };

  walk(repoPath, 0);

  let primaryLanguage: string | undefined;
  let best: { lang: string; size: number } | undefined;
  for (const [lang, size] of counts.entries()) {
    if (!best || size > best.size) best = { lang, size };
  }
  primaryLanguage = best?.lang;

  return { primaryLanguage, fileCount, sourceLines };
};

export interface InspectRepoOptions {
  githubByFullName?: ReadonlyMap<string, GitHubRepoSnapshot>;
}

export const inspectRepo = (
  repoPath: string,
  options: InspectRepoOptions = {}
): ScannedRepo => {
  const name = basename(repoPath);
  const id = `${name}-${Buffer.from(repoPath).toString("base64url").slice(-8)}`;
  const base: ScannedRepo = { id, path: repoPath, name, isDirty: false };

  if (!existsSync(join(repoPath, ".git"))) {
    return { ...base, scanError: "not a git repo" };
  }

  const status = runGit(repoPath, ["status", "--porcelain=v2", "--branch"]);
  // `git status` is the minimum validity check for a synchronous inspection.
  // Without it, a missing/unavailable git executable looks like a clean empty
  // repo and can erase an existing branch/HEAD snapshot during reconciliation.
  // Unborn repositories remain valid because status succeeds for them.
  if (!status.ok) {
    return { ...base, scanError: "git status failed" };
  }

  const branch = runGit(repoPath, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const log = runGit(repoPath, ["log", "-1", "--pretty=%H%x09%s%x09%cI"]);
  const recent = runGit(repoPath, ["log", "-5", "--pretty=%H%x09%s%x09%cI%x09%an"]);
  const total = runGit(repoPath, ["rev-list", "--count", "HEAD"]);
  const commitCount = total.ok ? Number.parseInt(total.stdout.trim(), 10) : undefined;

  let ahead: number | undefined;
  let behind: number | undefined;
  let isDirty = false;

  if (status.ok) {
    for (const line of status.stdout.split(/\r?\n/)) {
      if (line.startsWith("# branch.ab ")) {
        const match = line.match(/\+(-?\d+)\s+-(-?\d+)/);
        if (match) {
          ahead = Number.parseInt(match[1], 10);
          behind = Number.parseInt(match[2], 10);
        }
      } else if (line && !line.startsWith("#")) {
        isDirty = true;
      }
    }
  }

  let lastCommitSha: string | undefined;
  let lastCommitSubject: string | undefined;
  let lastCommitAt: string | undefined;
  if (log.ok && log.stdout) {
    const [sha, subject, when] = log.stdout.split("	");
    lastCommitSha = sha;
    lastCommitSubject = subject;
    lastCommitAt = when;
  }

  let recentCommits: RecentCommit[] | undefined;
  if (recent.ok && recent.stdout) {
    recentCommits = recent.stdout
      .split("\n")
      .filter((line) => line.includes("	"))
      .map((line) => {
        const [sha, subject, committedAt, author] = line.split("	");
        return {
          sha,
          shortSha: sha.slice(0, 7),
          subject,
          committedAt,
          author
        };
      });
  }

  const recentCommitDays = buildRecentCommitDays(repoPath);
  const dirtySnapshot = isDirty ? buildDirtyChanges(repoPath) : undefined;
  const dirtyStatus = isDirty ? buildDirtyFileStatuses(repoPath) : undefined;
  const tree = scanRepoTree(repoPath);

  const scan: ScannedRepo = {
    ...base,
    branch: branch.ok ? branch.stdout : undefined,
    isDirty,
    ahead,
    behind,
    lastCommitSubject,
    lastCommitSha,
    lastCommitAt,
    primaryLanguage: tree.primaryLanguage,
    recentCommits,
    recentCommitDays,
    commitCount: Number.isFinite(commitCount) ? commitCount : undefined,
    fileCount: tree.fileCount,
    sourceLines: tree.sourceLines,
    dirtyChanges: dirtySnapshot?.changes,
    dirtyFiles: dirtyStatus?.files,
    dirtyFileCount: dirtyStatus?.total ?? dirtySnapshot?.total
  };
  return attachGitHubMetadata(scan, readGitHubRemote(repoPath), options.githubByFullName);
};

/**
 * Light-touch git probe — one `git status --porcelain=v2 --branch` call,
 * no log walk, no language detection, no dirty-file diff snapshot. Used
 * by the background ticker so the habitat reflects push/commit/dirty
 * state without paying for a full `inspectRepo` on every repo every tick.
 *
 * Returns `null` when the path is no longer a git repo (deleted .git, etc.).
 * Callers should treat `headSha` differing from the prior full scan's
 * `lastCommitSha` as the cue to fall back to `inspectRepo` for that one
 * repo — the cheap probe doesn't carry commit subjects or recentCommits.
 */
export interface LightScan {
  branch?: string;
  ahead?: number;
  behind?: number;
  isDirty: boolean;
  headSha?: string;
}

export const inspectRepoLight = (repoPath: string): LightScan | null => {
  if (!existsSync(join(repoPath, ".git"))) return null;

  const status = runGit(repoPath, ["status", "--porcelain=v2", "--branch"]);
  if (!status.ok) return null;

  return parseStatusBranch(status.stdout);
};

const makeRepoId = (repoPath: string): string => {
  const name = basename(repoPath);
  return `${name}-${Buffer.from(repoPath).toString("base64url").slice(-8)}`;
};

interface GitDirs {
  /** The path-specific gitdir. For a worktree, this is the per-worktree
   *  directory (carrying HEAD, index, logs). For a plain repo, identical
   *  to `commonDir`. */
  gitDir: string;
  /** The shared gitdir holding objects/ and refs/. For a worktree, this is
   *  the primary repo's `.git`. For a plain repo, identical to `gitDir`. */
  commonDir: string;
}

/** Resolve the real git dirs for a working tree. Handles three layouts:
 *   - plain repo: `<path>/.git` is a directory; gitDir == commonDir.
 *   - submodule:  `<path>/.git` is a file with `gitdir: <path>`; gitDir is
 *                 the submodule's own gitdir, no `commondir` file.
 *   - worktree:   `<path>/.git` is a file pointing to
 *                 `<main>/.git/worktrees/<name>`. Refs live in the main
 *                 repo's `.git`, so we read `commondir` to find them.
 *  Returns undefined when there is no `.git` at all. */
const resolveGitDirs = async (repoPath: string): Promise<GitDirs | undefined> => {
  const dotGit = join(repoPath, ".git");
  let info;
  try {
    info = await fsStat(dotGit);
  } catch {
    return undefined;
  }

  let gitDir: string;
  if (info.isDirectory()) {
    gitDir = dotGit;
  } else if (info.isFile()) {
    let content: string;
    try {
      content = (await readFile(dotGit, "utf8")).trim();
    } catch {
      return undefined;
    }
    if (!content.startsWith("gitdir:")) return undefined;
    const target = content.slice("gitdir:".length).trim();
    gitDir = isAbsolute(target) ? target : resolve(repoPath, target);
  } else {
    return undefined;
  }

  // `commondir` is present in per-worktree gitdirs and points (often
  // relatively) at the shared repo gitdir that owns refs/ + objects/.
  let commonDir = gitDir;
  try {
    const commonRel = (await readFile(join(gitDir, "commondir"), "utf8")).trim();
    if (commonRel) {
      commonDir = isAbsolute(commonRel) ? commonRel : resolve(gitDir, commonRel);
    }
  } catch {
    // No commondir → plain repo or submodule, gitDir already serves as common.
  }

  return { gitDir, commonDir };
};

const SHA40 = /^[0-9a-f]{40}/;

/** Read HEAD and (when it's symbolic) walk to the underlying sha. Tries
 *  loose refs first (`<gitDir>/refs/heads/<branch>`), then falls back to
 *  the `packed-refs` file. Returns `{}` on empty repos or unreadable HEAD —
 *  the scanner treats that as a still-valid "skeleton with no commits yet". */
const readHeadRef = async (
  dirs: GitDirs
): Promise<{ branch?: string; sha?: string }> => {
  // HEAD is always in the per-worktree gitDir (each worktree has its own).
  let head: string;
  try {
    head = (await readFile(join(dirs.gitDir, "HEAD"), "utf8")).trim();
  } catch {
    return {};
  }

  if (head.startsWith("ref: ")) {
    const ref = head.slice("ref: ".length).trim();
    const branch = ref.startsWith("refs/heads/")
      ? ref.slice("refs/heads/".length)
      : undefined;

    // Refs live in the COMMON gitdir (shared across worktrees). The
    // per-worktree gitdir only carries HEAD/index/logs.
    try {
      const loose = (await readFile(join(dirs.commonDir, ref), "utf8")).trim();
      if (SHA40.test(loose)) return { branch, sha: loose.slice(0, 40) };
    } catch {
      // Falls through to packed-refs lookup.
    }

    // Packed refs: lines are "<sha> <ref>", with optional "^<sha>" peel
    // lines for annotated tags (irrelevant here — we're matching branches).
    try {
      const packed = await readFile(join(dirs.commonDir, "packed-refs"), "utf8");
      for (const line of packed.split("\n")) {
        if (!line || line.startsWith("#") || line.startsWith("^")) continue;
        const space = line.indexOf(" ");
        if (space < 40) continue;
        const sha = line.slice(0, space);
        const packedRef = line.slice(space + 1).trim();
        if (packedRef === ref && SHA40.test(sha)) {
          return { branch, sha: sha.slice(0, 40) };
        }
      }
    } catch {
      // No packed-refs file — that's normal for fresh repos.
    }

    // Empty repo or pruned ref — return branch only.
    return { branch };
  }

  // Detached HEAD: HEAD contains the sha directly.
  if (SHA40.test(head)) return { sha: head.slice(0, 40) };

  return {};
};

/**
 * Phase 0 — filesystem-only repo identification. Reads `.git/HEAD` and
 * resolves the branch ref via plain file reads, no git subprocess. Used to
 * paint the garden list (name + branch + last-commit SHA) within a few ms
 * of scan start, before any `git status` spawn has even returned. `isDirty`
 * stays false in this result; the real dirty/ahead/behind state arrives
 * with phase 1 (`inspectRepoSkeletonAsync`).
 */
export const inspectRepoPreskeletonAsync = async (
  repoPath: string
): Promise<ScannedRepo> => {
  const name = basename(repoPath);
  const id = makeRepoId(repoPath);
  const base: ScannedRepo = { id, path: repoPath, name, isDirty: false };

  const dirs = await resolveGitDirs(repoPath);
  if (!dirs) return { ...base, scanError: "not a git repo" };

  const { branch, sha } = await readHeadRef(dirs);
  return { ...base, branch, lastCommitSha: sha };
};

/**
 * Phase 1 of the parallel scan: a single `git status --porcelain=v2 --branch`
 * call yields branch, ahead/behind, dirty, and HEAD sha. Enough to render a
 * repo row in the garden list while the heavier inspection finishes. Returns
 * a `ScannedRepo` carrying a `scanError` if the path is no longer a git repo
 * or if git refused to talk — phase 2 is skipped in those cases.
 */
export const inspectRepoSkeletonAsync = async (
  repoPath: string,
  options: InspectRepoOptions = {}
): Promise<ScannedRepo> => {
  const name = basename(repoPath);
  const id = makeRepoId(repoPath);
  const base: ScannedRepo = { id, path: repoPath, name, isDirty: false };

  if (!existsSync(join(repoPath, ".git"))) {
    return { ...base, scanError: "not a git repo" };
  }

  const status = await runGitAsync(repoPath, [
    "status",
    "--porcelain=v2",
    "--branch"
  ]);
  if (!status.ok) {
    return { ...base, scanError: "git status failed" };
  }

  const parsed = parseStatusBranch(status.stdout);
  const scan: ScannedRepo = {
    ...base,
    branch: parsed.branch,
    ahead: parsed.ahead,
    behind: parsed.behind,
    isDirty: parsed.isDirty,
    lastCommitSha: parsed.headSha
  };
  return attachGitHubMetadata(scan, await readGitHubRemoteAsync(repoPath), options.githubByFullName);
};

/**
 * Phase 2 enrichment: recentCommits + last-commit subject/date, total commit
 * count, sparkline buckets, and (for dirty repos) the dirty-file inventory
 * plus the bounded diff snapshot. Merges results onto `skeleton` so the
 * caller can stream the same `path` through a Map without losing skeleton
 * fields. `log -5` doubles as the source of `lastCommit*` — saves one spawn
 * over the legacy sync path that ran `log -1` and `log -5` separately.
 */
export const inspectRepoEnrichAsync = async (
  skeleton: ScannedRepo
): Promise<ScannedRepo> => {
  if (skeleton.scanError) return skeleton;
  const repoPath = skeleton.path;

  // All phase-2 work runs concurrently. For dirty repos that's up to 5 git
  // spawns at once per worker, but they're independent so libuv pipes them
  // through to the kernel without serialization. `rev-list --count HEAD` is
  // O(history) and dominates this call on repos with millions of commits —
  // for that workload, consider demoting it to phase 3 (see commit history).
  const [recent, total, days, dirtySnapshot, dirtyStatus] = await Promise.all([
    runGitAsync(repoPath, ["log", "-5", "--pretty=%H%x09%s%x09%cI%x09%an"]),
    runGitAsync(repoPath, ["rev-list", "--count", "HEAD"]),
    runGitAsync(repoPath, [
      "log",
      `--since=${SPARKLINE_DAYS}.days`,
      "--max-count=1000",
      "--format=%cd",
      "--date=format:%Y-%m-%d"
    ]),
    skeleton.isDirty ? buildDirtyChangesAsync(repoPath) : Promise.resolve(undefined),
    skeleton.isDirty ? buildDirtyFileStatusesAsync(repoPath) : Promise.resolve(undefined)
  ]);

  let recentCommits: RecentCommit[] | undefined;
  let lastCommitSha: string | undefined = skeleton.lastCommitSha;
  let lastCommitSubject: string | undefined;
  let lastCommitAt: string | undefined;
  if (recent.ok && recent.stdout) {
    recentCommits = parseRecentCommitsLog(recent.stdout);
    if (recentCommits.length > 0) {
      lastCommitSha = recentCommits[0].sha;
      lastCommitSubject = recentCommits[0].subject;
      lastCommitAt = recentCommits[0].committedAt;
    }
  }

  const commitCount = total.ok ? Number.parseInt(total.stdout.trim(), 10) : Number.NaN;
  const recentCommitDays = days.ok ? bucketCommitDays(days.stdout) : undefined;

  return {
    ...skeleton,
    lastCommitSha,
    lastCommitSubject,
    lastCommitAt,
    recentCommits,
    recentCommitDays,
    commitCount: Number.isFinite(commitCount) ? commitCount : undefined,
    dirtyChanges: dirtySnapshot?.changes,
    dirtyFiles: dirtyStatus?.files,
    dirtyFileCount: dirtyStatus?.total ?? dirtySnapshot?.total
  };
};

/**
 * Phase 3 — best-effort extras that don't gate the "scan complete" feeling.
 * Currently: primary-language detection plus file-count / source-byte
 * tallies from a single depth-2 fs walk. Runs after every repo already has
 * its git data on screen, so a monorepo's deep src tree doesn't hold up the
 * rest of the scan.
 */
export const inspectRepoExtrasAsync = async (
  scan: ScannedRepo
): Promise<ScannedRepo> => {
  if (scan.scanError) return scan;
  // scanRepoTree is synchronous fs IO — wrap in an awaited microtask so
  // the worker pool can interleave with other repos' work.
  await Promise.resolve();
  const tree = scanRepoTree(scan.path);
  if (
    tree.primaryLanguage === scan.primaryLanguage &&
    tree.fileCount === scan.fileCount &&
    tree.sourceLines === scan.sourceLines
  ) {
    return scan;
  }
  return {
    ...scan,
    primaryLanguage: tree.primaryLanguage,
    fileCount: tree.fileCount,
    sourceLines: tree.sourceLines
  };
};

export interface ScanResult {
  repos: ScannedRepo[];
  rootsUsed: string[];
  errors: { root: string; message: string }[];
}

export interface ScanRootsOptions {
  githubRepos?: GitHubRepoSnapshot[];
}

export const scanRoots = (
  roots: string[],
  maxDepth = 4,
  options: ScanRootsOptions = {}
): ScanResult => {
  const result: ScanResult = { repos: [], rootsUsed: [], errors: [] };
  const seen = new Set<string>();
  const githubByFullName = options.githubRepos
    ? buildGitHubRepoMap(options.githubRepos)
    : undefined;

  for (const raw of roots) {
    const root = expandPath(raw);
    if (!root) continue;
    if (!existsSync(root)) {
      result.errors.push({ root, message: "path does not exist" });
      continue;
    }
    if (!isDir(root)) {
      result.errors.push({ root, message: "not a directory" });
      continue;
    }
    result.rootsUsed.push(root);

    const found = findRepos(root, maxDepth);
    for (const repoPath of found) {
      if (seen.has(repoPath)) continue;
      seen.add(repoPath);
      try {
        result.repos.push(inspectRepo(repoPath, { githubByFullName }));
      } catch (error) {
        result.repos.push({
          id: basename(repoPath),
          path: repoPath,
          name: basename(repoPath),
          isDirty: false,
          scanError: error instanceof Error ? error.message : "scan failed"
        });
      }
    }
  }

  result.repos.sort((left, right) => left.name.localeCompare(right.name));
  return result;
};

export interface ProgressiveScanEvents {
  /** Phase 0 — fires after a pure-filesystem read of `.git/HEAD` and the
   *  ref it points to. Carries name + branch + lastCommitSha only; no
   *  dirty/ahead/behind yet. Lets the garden list paint within a few ms
   *  of scan start, before any git subprocess has returned. */
  onRepoSkeleton?: (repo: ScannedRepo, done: number, total: number) => void;
  /** Phase 1 — fires after `git status --porcelain=v2 --branch` lands.
   *  Adds isDirty / ahead / behind to the skeleton row. Roughly one git
   *  spawn per repo, bounded by SCAN_CONCURRENCY. */
  onRepoStatus?: (repo: ScannedRepo, done: number, total: number) => void;
  /** Phase 2 — fires when enrichment lands: recent commits, sparkline,
   *  commit count, dirty inventory, dirty diffs. `done` and `total` count
   *  repos that have completed phase 2. The legacy single-phase scanner
   *  also emitted this; existing callers that wire `onRepo` keep working. */
  onRepo?: (repo: ScannedRepo, done: number, total: number) => void;
  /** Phase 3 — fires when extras land (currently primaryLanguage). The
   *  emitted repo is a strict patch over the phase-2 result. The scan
   *  promise resolves only after every repo has been through all four
   *  phases. */
  onRepoExtras?: (repo: ScannedRepo, done: number, total: number) => void;
  onRoot?: (progress: RootProgress) => void;
  onRootsResolved?: (progress: RootProgress[]) => void;
  onError?: (root: string, message: string) => void;
  onComplete?: (result: ScanResult) => void;
}

/** Worker-pool concurrency for parallel scans. Capped at 8 because
 *  spawning more than that just queues at the kernel level on most laptops
 *  and the marginal speedup falls off a cliff. Floor of 2 so we always
 *  parallelize at least a little even on weird single-core sandboxes. */
const envConcurrency = (() => {
  const raw = process.env.REPOGARDEN_SCAN_CONCURRENCY;
  if (!raw) return undefined;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
})();
const SCAN_CONCURRENCY =
  envConcurrency ?? Math.max(2, Math.min(8, cpus().length || 4));

/**
 * Parallel four-phase scanner.
 *
 *   Phase 0 (skeleton)    — fs read of `.git/HEAD` + branch ref. No git
 *                            subprocess. Runs in parallel for every repo via
 *                            `Promise.all` (no worker pool needed). Emits
 *                            `onRepoSkeleton` — name + branch + sha.
 *   Phase 1 (status)      — `git status --porcelain=v2 --branch`. Adds
 *                            isDirty/ahead/behind. Worker pool, concurrency
 *                            bounded by SCAN_CONCURRENCY. Emits `onRepoStatus`.
 *   Phase 2 (enrichment)  — log -5, rev-list count, sparkline log, dirty
 *                            inventory, dirty diffs. Emits `onRepo`.
 *   Phase 3 (extras)      — language detection (fs walk). Emits
 *                            `onRepoExtras`.
 *
 * Each emission carries the cumulative full `ScannedRepo` for that path so a
 * consumer can keep a `Map<path, ScannedRepo>` and replace on every event.
 * The promise resolves only after every repo has finished phase 3, which is
 * when `result.repos` is the fully-populated, name-sorted list (matching the
 * legacy synchronous `scanRoots` contract).
 */
export interface ScanOptions {
  /** When false, skip the persistent scan cache entirely (no read, no
   *  write). Tests use this to keep `~/.repogarden/scan-cache.json`
   *  untouched. Default: enabled, unless the env var
   *  `REPOGARDEN_SCAN_CACHE` is set to an empty string. */
  cache?: boolean;
  /** Override the cache file path. Mainly for tests; production reads from
   *  `~/.repogarden/scan-cache.json` (or `$REPOGARDEN_SCAN_CACHE`). */
  cacheFile?: string;
  /** Optional GitHub metadata fetched before the scan. Local git remains
   *  authoritative; this only annotates repos whose origin remote matches
   *  a fetched GitHub repo full_name. */
  githubRepos?: GitHubRepoSnapshot[];
}

export const scanRootsProgressive = async (
  roots: string[],
  events: ProgressiveScanEvents = {},
  maxDepth = 4,
  options: ScanOptions = {}
): Promise<ScanResult> => {
  const result: ScanResult = { repos: [], rootsUsed: [], errors: [] };
  const seen = new Set<string>();
  const allPaths: string[] = [];
  // Owner root for each entry in allPaths, so we can emit per-root progress
  // even though paths from different roots are inspected in a single pass.
  const pathOwners: string[] = [];
  const rootTotals = new Map<string, number>();
  const rootDone = new Map<string, number>();
  const githubByFullName = options.githubRepos
    ? buildGitHubRepoMap(options.githubRepos)
    : undefined;

  for (const raw of roots) {
    const root = expandPath(raw);
    if (!root) continue;
    if (!existsSync(root)) {
      const message = "path does not exist";
      result.errors.push({ root, message });
      events.onError?.(root, message);
      continue;
    }
    if (!isDir(root)) {
      const message = "not a directory";
      result.errors.push({ root, message });
      events.onError?.(root, message);
      continue;
    }
    result.rootsUsed.push(root);
    rootTotals.set(root, 0);
    rootDone.set(root, 0);
    for (const repoPath of findRepos(root, maxDepth)) {
      if (!seen.has(repoPath)) {
        seen.add(repoPath);
        allPaths.push(repoPath);
        pathOwners.push(root);
        rootTotals.set(root, (rootTotals.get(root) ?? 0) + 1);
      }
    }
  }

  const total = allPaths.length;
  if (events.onRootsResolved) {
    events.onRootsResolved(
      result.rootsUsed.map((root) => ({
        root,
        done: 0,
        total: rootTotals.get(root) ?? 0,
      }))
    );
  }

  // Per-path slot in the result list so workers can overwrite as phases land
  // without needing a Map lookup. Repos are inserted in discovery order and
  // re-sorted by name at the end (matches legacy contract).
  const slots: (ScannedRepo | undefined)[] = new Array(total);

  const fallbackFor = (repoPath: string, message: string): ScannedRepo => ({
    id: makeRepoId(repoPath),
    path: repoPath,
    name: basename(repoPath),
    isDirty: false,
    scanError: message
  });

  // Persistent cache from prior runs — skipped entirely if disabled. Loaded
  // synchronously so phase 0 can short-circuit before kicking off git work.
  const cacheEnabled = options.cache !== false;
  const priorCache: ScanCacheMap = cacheEnabled
    ? loadScanCache(options.cacheFile)
    : {};
  /** Indices that hit the cache. Phase 1 and phase 2 workers skip these —
   *  their slot already holds the cached `ScannedRepo` and the event
   *  counters were advanced inline during phase 0. */
  const cachedIndices = new Set<number>();

  // ---- Phase 0: fs-only skeletons for every repo. -------------------------
  // No git subprocess. Just `.git/HEAD` + ref resolution. Runs as a flat
  // Promise.all because the per-repo cost is dominated by a couple of small
  // file reads, not by anything that benefits from bounded concurrency.
  // Emits onRepoSkeleton in completion order — for a fresh disk cache this
  // is essentially "all at once" within a few tens of ms.
  //
  // Cache integration: after reading HEAD, we ask the cache. A hit (same
  // sha as last run) means we emit the cached scan as `onRepoStatus`,
  // `onRepo`, and `onRepoExtras` inline, and mark the index so phases 1-3
  // workers don't redo any work.
  let skeletonsDone = 0;
  let statusDone = 0;
  let enrichedDone = 0;
  let extrasDone = 0;

  const advanceRoot = (owner: string) => {
    const nextDone = (rootDone.get(owner) ?? 0) + 1;
    rootDone.set(owner, nextDone);
    events.onRoot?.({
      root: owner,
      done: nextDone,
      total: rootTotals.get(owner) ?? 0,
    });
  };

  const preskeletons = allPaths.map((path) => inspectRepoPreskeletonAsync(path));
  await Promise.all(
    preskeletons.map(async (promise, index) => {
      let scan: ScannedRepo;
      try {
        scan = await promise;
      } catch (error) {
        const message = error instanceof Error ? error.message : "scan failed";
        scan = fallbackFor(allPaths[index], message);
      }
      slots[index] = scan;
      skeletonsDone += 1;
      events.onRepoSkeleton?.(scan, skeletonsDone, total);

      // Cache lookup against the freshly-read HEAD sha. Hit means we can
      // skip the entire git pipeline for this repo.
      const cached = lookupCachedScan(priorCache, scan.path, scan.lastCommitSha);
      if (cached && !cached.scanError) {
        const hydrated = githubByFullName
          ? attachGitHubMetadata(
              cached,
              cached.remote ?? (await readGitHubRemoteAsync(cached.path)),
              githubByFullName
            )
          : cached;
        cachedIndices.add(index);
        slots[index] = hydrated;
        statusDone += 1;
        events.onRepoStatus?.(hydrated, statusDone, total);
        enrichedDone += 1;
        events.onRepo?.(hydrated, enrichedDone, total);
        advanceRoot(pathOwners[index]);
        extrasDone += 1;
        events.onRepoExtras?.(hydrated, extrasDone, total);
      }
    })
  );

  // ---- Phase 1 pool: git status for every cache-MISS repo. ---------------
  // Workers run `git status --porcelain=v2 --branch` and fold dirty/ahead/
  // behind onto each repo's slot. We finish all phase 1 before phase 2 so
  // the user sees the full status-flagged list before enrichment churn
  // starts — phase 2's git calls otherwise hog the kernel and slow phase 1.
  // Cache hits skip this pool entirely (counters were advanced in phase 0).
  let phase1Cursor = 0;
  const phase1Worker = async () => {
    while (true) {
      const index = phase1Cursor++;
      if (index >= total) return;
      if (cachedIndices.has(index)) continue;
      const repoPath = allPaths[index];
      const preskeleton = slots[index];
      // If phase 0 already failed (no .git), skip the git call; the slot's
      // existing scanError carries downstream.
      if (preskeleton?.scanError) {
        statusDone += 1;
        events.onRepoStatus?.(preskeleton, statusDone, total);
        continue;
      }
      let scan: ScannedRepo;
      try {
        scan = await inspectRepoSkeletonAsync(repoPath, { githubByFullName });
        // Preserve any preskeleton fields that the status call doesn't
        // overwrite (id is identical via makeRepoId, but be explicit).
        if (preskeleton) scan = { ...preskeleton, ...scan };
      } catch (error) {
        const message = error instanceof Error ? error.message : "scan failed";
        scan = preskeleton
          ? { ...preskeleton, scanError: message }
          : fallbackFor(repoPath, message);
      }
      slots[index] = scan;
      statusDone += 1;
      events.onRepoStatus?.(scan, statusDone, total);
    }
  };

  const phase1Count = Math.min(SCAN_CONCURRENCY, total);
  const phase1Workers: Promise<void>[] = [];
  for (let i = 0; i < phase1Count; i += 1) phase1Workers.push(phase1Worker());
  await Promise.all(phase1Workers);

  // ---- Phase 2 + phase 3 pool: enrichment, then extras, per cache-MISS repo.
  // Workers still pipeline phase 2 → phase 3 for a single repo (rather than
  // running two more split pools) because phase 3 is just a fs walk — it
  // doesn't share contention with phase 2's git spawns, and chaining means
  // we emit a single `onRepoExtras` per repo that the consumer can use as
  // the "final" event without tracking phase 2 vs 3 separately.
  // Cache hits skip this pool entirely.
  let phase2Cursor = 0;

  const phase2Worker = async () => {
    while (true) {
      const index = phase2Cursor++;
      if (index >= total) return;
      if (cachedIndices.has(index)) continue;
      const owner = pathOwners[index];
      let scan = slots[index] ?? fallbackFor(allPaths[index], "skeleton missing");

      if (!scan.scanError) {
        try {
          scan = await inspectRepoEnrichAsync(scan);
        } catch (error) {
          const message = error instanceof Error ? error.message : "scan failed";
          scan = { ...scan, scanError: message };
        }
        slots[index] = scan;
      }
      enrichedDone += 1;
      events.onRepo?.(scan, enrichedDone, total);
      advanceRoot(owner);

      if (!scan.scanError) {
        try {
          scan = await inspectRepoExtrasAsync(scan);
        } catch {
          // Extras are best-effort — language detection can fail on
          // permission errors or exotic filesystems. Keep the phase-2
          // result rather than tagging the whole repo with a scan error.
        }
        slots[index] = scan;
      }
      extrasDone += 1;
      events.onRepoExtras?.(scan, extrasDone, total);
    }
  };

  const phase2Workers: Promise<void>[] = [];
  for (let i = 0; i < phase1Count; i += 1) phase2Workers.push(phase2Worker());
  await Promise.all(phase2Workers);

  for (const entry of slots) {
    if (entry) result.repos.push(entry);
  }
  result.repos.sort((left, right) => left.name.localeCompare(right.name));

  // Persist the scan so the next launch hits the cache. We rebuild the
  // entire entry set rather than merging — entries for repos no longer
  // under any root naturally fall out, keeping the file from growing.
  if (cacheEnabled) {
    saveScanCache(buildUpdatedCache(result.repos), options.cacheFile);
  }

  events.onComplete?.(result);
  return result;
};
