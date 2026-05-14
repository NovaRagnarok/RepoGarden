import { existsSync, statSync, watch } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Background observer
// ---------------------------------------------------------------------------
//
// Watches each tracked repo's `.git/logs/HEAD` for commit/amend/reset/pull
// activity, and each scan-root directory for new repos. Falls back silently
// when fs.watch is unsupported on the path (network mounts, some WSL paths,
// certain VM filesystems) — callers keep a slow safety-net poll so updates
// still arrive in those environments.
//
// fs.watch chatter is real: macOS FSEvents fires 3-5 callbacks per single
// git operation, and a `git pull` rewrites logs/HEAD plus dozens of other
// files in burst. Each handle gets its own debounce timer so a burst on
// repo A doesn't delay repo B's update.

const COMMIT_DEBOUNCE_MS = 250;
const NEW_REPO_DEBOUNCE_MS = 500;

export const DEFAULT_MAX_WATCHES = 150;

export interface ObserverRepo {
  id: string;
  path: string;
}

export interface StartObserverOptions {
  /** Tracked repos to watch for commit activity. */
  repos: ObserverRepo[];
  /** Scan-root directories to watch for new repos. */
  roots: string[];
  /** Fired with the repo id when `.git/logs/HEAD` is touched. */
  onCommitDetected: (id: string) => void;
  /**
   * Fired when a directory inside a scan root looks like a new repo
   * (`<root>/<name>/.git` exists). The caller is responsible for
   * deduping against repos already in the registry — observer doesn't
   * track membership itself.
   */
  onNewRepoDetected: (path: string) => void;
  /**
   * Cap on per-repo watch handles. Beyond this, per-repo commit
   * watching is skipped entirely (callers keep their safety-net poll).
   * Root watches are unaffected.
   */
  maxWatches?: number;
}

interface WatchEntry {
  close: () => void;
}

/**
 * Start watching the given repos and roots. Returns an unsubscribe
 * function that's safe to call multiple times. Any individual watcher
 * that fails to start (unsupported FS, vanished path, permission) is
 * silently skipped — observers degrade to "no-op" rather than throwing.
 */
export const startObserver = (options: StartObserverOptions): (() => void) => {
  const { repos, roots, onCommitDetected, onNewRepoDetected } = options;
  const maxWatches = options.maxWatches ?? DEFAULT_MAX_WATCHES;

  const entries: WatchEntry[] = [];
  let closed = false;

  const watchedRepos = repos.slice(0, maxWatches);
  for (const repo of watchedRepos) {
    const entry = watchRepoCommits(repo, () => {
      if (!closed) onCommitDetected(repo.id);
    });
    if (entry) entries.push(entry);
  }

  for (const root of roots) {
    const entry = watchRootForNewRepos(root, (candidatePath) => {
      if (!closed) onNewRepoDetected(candidatePath);
    });
    if (entry) entries.push(entry);
  }

  return () => {
    if (closed) return;
    closed = true;
    for (const entry of entries) {
      try {
        entry.close();
      } catch {
        // already closed / never opened cleanly
      }
    }
    entries.length = 0;
  };
};

// ---------------------------------------------------------------------------
// Per-repo: watch .git/logs/HEAD
// ---------------------------------------------------------------------------

const watchRepoCommits = (
  repo: ObserverRepo,
  fire: () => void
): WatchEntry | null => {
  const logPath = join(repo.path, ".git", "logs", "HEAD");
  // No logs/HEAD yet (fresh `git init` before first commit, or a bare
  // submodule clone). Skip rather than racing the file into existence;
  // the safety-net poll will catch it.
  if (!existsSync(logPath)) return null;

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let watcher: ReturnType<typeof watch> | null = null;

  const trigger = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      fire();
    }, COMMIT_DEBOUNCE_MS);
  };

  try {
    watcher = watch(logPath, () => {
      trigger();
    });
    watcher.on("error", () => {
      try { watcher?.close(); } catch { /* already closed */ }
      watcher = null;
    });
  } catch {
    return null;
  }

  return {
    close: () => {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      if (watcher) {
        try { watcher.close(); } catch { /* already closed */ }
        watcher = null;
      }
    },
  };
};

// ---------------------------------------------------------------------------
// Per-root: watch scan-root directory non-recursively for new repos
// ---------------------------------------------------------------------------

const watchRootForNewRepos = (
  root: string,
  fire: (path: string) => void
): WatchEntry | null => {
  if (!existsSync(root)) return null;

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let watcher: ReturnType<typeof watch> | null = null;
  // `filename` arrives null on some platforms; coalesce all unknowns
  // into a single full-scan pass when the timer fires.
  const pendingCandidates = new Set<string>();
  let sawUnknown = false;

  const flush = () => {
    debounceTimer = null;
    const names = Array.from(pendingCandidates);
    pendingCandidates.clear();
    const flushUnknown = sawUnknown;
    sawUnknown = false;

    if (flushUnknown) {
      // Don't enumerate the whole root — we'd race the user's
      // build outputs. The safety-net poll handles the "missed an
      // event entirely" case. We still flush any named candidates
      // we did collect.
    }

    for (const name of names) {
      const candidate = join(root, name);
      if (looksLikeRepo(candidate)) {
        fire(candidate);
      }
    }
  };

  const queue = (filename: string | null) => {
    if (filename === null) {
      sawUnknown = true;
    } else {
      // Trim deeper paths: fs.watch may emit "subdir/file" on macOS.
      // We only care about the top-level directory name.
      const top = filename.split(/[\\/]/, 1)[0];
      if (top) pendingCandidates.add(top);
    }
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(flush, NEW_REPO_DEBOUNCE_MS);
  };

  try {
    watcher = watch(root, (_eventType, filename) => {
      queue(filename);
    });
    watcher.on("error", () => {
      try { watcher?.close(); } catch { /* already closed */ }
      watcher = null;
    });
  } catch {
    return null;
  }

  return {
    close: () => {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      pendingCandidates.clear();
      if (watcher) {
        try { watcher.close(); } catch { /* already closed */ }
        watcher = null;
      }
    },
  };
};

const looksLikeRepo = (candidatePath: string): boolean => {
  try {
    const stat = statSync(candidatePath);
    if (!stat.isDirectory()) return false;
    return existsSync(join(candidatePath, ".git"));
  } catch {
    return false;
  }
};
