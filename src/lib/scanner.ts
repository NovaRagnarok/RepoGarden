import { spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";

export interface RecentCommit {
  sha: string;
  shortSha: string;
  subject: string;
  committedAt: string;
  author: string;
}

export type DirtyFileSkipReason = "too-large" | "binary" | "sensitive";

export interface DirtyFileChange {
  filename: string;
  oldText: string;
  newText: string;
  truncated: boolean;
  /** Set when the file's content was deliberately not loaded. Renderers
   *  should show a placeholder instead of a diff in that case. */
  skipped?: DirtyFileSkipReason;
}

export interface DirtyFileStatus {
  filename: string;
  code: string;
  label: string;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
  renamedFrom?: string;
}

export interface ScannedRepo {
  id: string;
  path: string;
  name: string;
  branch?: string;
  isDirty: boolean;
  ahead?: number;
  behind?: number;
  lastCommitSubject?: string;
  lastCommitSha?: string;
  lastCommitAt?: string;
  primaryLanguage?: string;
  recentCommits?: RecentCommit[];
  /** Daily commit counts for the last 30 days, oldest first. */
  recentCommitDays?: number[];
  commitCount?: number;
  /** First few dirty files with HEAD vs working-tree text, for diff view. */
  dirtyChanges?: DirtyFileChange[];
  /** Porcelain-status inventory for dirty files, capped for display. */
  dirtyFiles?: DirtyFileStatus[];
  /** Total count of dirty files when dirtyChanges / dirtyFiles are truncated. */
  dirtyFileCount?: number;
  scanError?: string;
}

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

const runGit = (cwd: string, args: string[]): { stdout: string; stderr: string; ok: boolean } => {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    timeout: 4000,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" }
  });
  return {
    stdout: (result.stdout ?? "").toString().trimEnd(),
    stderr: (result.stderr ?? "").toString().trimEnd(),
    ok: result.status === 0 && result.error === undefined
  };
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
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const buckets = new Array<number>(SPARKLINE_DAYS).fill(0);
  for (const raw of log.stdout.split("\n")) {
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

const detectLanguage = (repoPath: string): string | undefined => {
  const counts = new Map<string, number>();

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
        const dot = entry.lastIndexOf(".");
        if (dot < 0) continue;
        const ext = entry.slice(dot + 1).toLowerCase();
        const lang = LANGUAGE_BY_EXT[ext];
        if (!lang) continue;
        counts.set(lang, (counts.get(lang) ?? 0) + s.size);
      }
    }
  };

  walk(repoPath, 0);
  if (counts.size === 0) return undefined;

  let best: { lang: string; size: number } | undefined;
  for (const [lang, size] of counts.entries()) {
    if (!best || size > best.size) {
      best = { lang, size };
    }
  }
  return best?.lang;
};

export const inspectRepo = (repoPath: string): ScannedRepo => {
  const name = basename(repoPath);
  const id = `${name}-${Buffer.from(repoPath).toString("base64url").slice(-8)}`;
  const base: ScannedRepo = { id, path: repoPath, name, isDirty: false };

  if (!existsSync(join(repoPath, ".git"))) {
    return { ...base, scanError: "not a git repo" };
  }

  const branch = runGit(repoPath, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const status = runGit(repoPath, ["status", "--porcelain=v2", "--branch"]);
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

  return {
    ...base,
    branch: branch.ok ? branch.stdout : undefined,
    isDirty,
    ahead,
    behind,
    lastCommitSubject,
    lastCommitSha,
    lastCommitAt,
    primaryLanguage: detectLanguage(repoPath),
    recentCommits,
    recentCommitDays,
    commitCount: Number.isFinite(commitCount) ? commitCount : undefined,
    dirtyChanges: dirtySnapshot?.changes,
    dirtyFiles: dirtyStatus?.files,
    dirtyFileCount: dirtyStatus?.total ?? dirtySnapshot?.total
  };
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

  let branch: string | undefined;
  let headSha: string | undefined;
  let ahead: number | undefined;
  let behind: number | undefined;
  let isDirty = false;

  for (const line of status.stdout.split(/\r?\n/)) {
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

export interface ScanResult {
  repos: ScannedRepo[];
  rootsUsed: string[];
  errors: { root: string; message: string }[];
}

export const scanRoots = (roots: string[], maxDepth = 4): ScanResult => {
  const result: ScanResult = { repos: [], rootsUsed: [], errors: [] };
  const seen = new Set<string>();

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
        result.repos.push(inspectRepo(repoPath));
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

export interface RootProgress {
  root: string;
  done: number;
  total: number;
}

export interface ProgressiveScanEvents {
  onRepo?: (repo: ScannedRepo, index: number, total: number) => void;
  onRoot?: (progress: RootProgress) => void;
  onRootsResolved?: (progress: RootProgress[]) => void;
  onError?: (root: string, message: string) => void;
  onComplete?: (result: ScanResult) => void;
}

/** Async-friendly scanner: yields each inspected repo through `onRepo`. */
export const scanRootsProgressive = async (
  roots: string[],
  events: ProgressiveScanEvents = {},
  maxDepth = 4
): Promise<ScanResult> => {
  const result: ScanResult = { repos: [], rootsUsed: [], errors: [] };
  const seen = new Set<string>();
  const allPaths: string[] = [];
  // Owner root for each entry in allPaths, so we can emit per-root progress
  // even though paths from different roots are inspected in a single pass.
  const pathOwners: string[] = [];
  const rootTotals = new Map<string, number>();
  const rootDone = new Map<string, number>();

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

  if (events.onRootsResolved) {
    events.onRootsResolved(
      result.rootsUsed.map((root) => ({
        root,
        done: 0,
        total: rootTotals.get(root) ?? 0,
      }))
    );
  }

  for (let i = 0; i < allPaths.length; i++) {
    const repoPath = allPaths[i];
    const owner = pathOwners[i];
    try {
      const inspected = inspectRepo(repoPath);
      result.repos.push(inspected);
      events.onRepo?.(inspected, i, allPaths.length);
    } catch (error) {
      const message = error instanceof Error ? error.message : "scan failed";
      const fallback: ScannedRepo = {
        id: basename(repoPath),
        path: repoPath,
        name: basename(repoPath),
        isDirty: false,
        scanError: message
      };
      result.repos.push(fallback);
      events.onRepo?.(fallback, i, allPaths.length);
    }
    const nextDone = (rootDone.get(owner) ?? 0) + 1;
    rootDone.set(owner, nextDone);
    events.onRoot?.({
      root: owner,
      done: nextDone,
      total: rootTotals.get(owner) ?? 0,
    });
    // Yield to the event loop so React state updates can paint.
    await new Promise((resolve) => setImmediate(resolve));
  }

  result.repos.sort((left, right) => left.name.localeCompare(right.name));
  events.onComplete?.(result);
  return result;
};
