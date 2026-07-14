import { existsSync, watch } from "node:fs";
import { join } from "node:path";

import { expandPath, findRepos } from "./scanner";

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
export const DEFAULT_ROOT_RECONCILE_INTERVAL_MS = 30_000;
export const DEFAULT_ROOT_SCAN_DEPTH = 4;

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
   * Fired once per previously untracked repository found within the scanner's
   * supported root depth. The observer seeds membership from `repos` and
   * deduplicates overlapping roots and repeated reconciliation passes.
   */
  onNewRepoDetected: (path: string) => void;
  /**
   * Cap on per-repo watch handles. Beyond this, per-repo commit
   * watching is skipped entirely (callers keep their safety-net poll).
   * Root watches are unaffected.
   */
  maxWatches?: number;
  /**
   * Safety-net cadence for a bounded root walk. Set to 0 only in tests that
   * explicitly drive reconciliation another way.
   */
  rootReconcileIntervalMs?: number;
  /** Scanner depth used by both watch-triggered and periodic root passes. */
  rootScanDepth?: number;
  /** Test seams for deterministic watch failures and filesystem discovery. */
  dependencies?: Partial<ObserverDependencies>;
}

interface WatchEntry {
  close: () => void;
}

interface ObserverWatchHandle {
  on: (event: "error", listener: (error: Error) => void) => ObserverWatchHandle;
  close: () => void;
}

type ObserverWatch = (
  path: string,
  listener: (eventType: string, filename: string | Buffer | null) => void
) => ObserverWatchHandle;

interface ObserverDependencies {
  watchPath: ObserverWatch;
  findRepos: (root: string, maxDepth: number) => string[];
}

const defaultDependencies: ObserverDependencies = {
  watchPath: (path, listener) => watch(path, listener),
  findRepos,
};

const pathKey = (path: string): string => expandPath(path);

/**
 * Start watching the given repos and roots. Returns an unsubscribe
 * function that's safe to call multiple times. Any individual watcher
 * that fails to start (unsupported FS, vanished path, permission) is
 * silently skipped — observers degrade to "no-op" rather than throwing.
 */
export const startObserver = (options: StartObserverOptions): (() => void) => {
  const { repos, roots, onCommitDetected, onNewRepoDetected } = options;
  const maxWatches = options.maxWatches ?? DEFAULT_MAX_WATCHES;
  const rootScanDepth = options.rootScanDepth ?? DEFAULT_ROOT_SCAN_DEPTH;
  const rootReconcileIntervalMs =
    options.rootReconcileIntervalMs ?? DEFAULT_ROOT_RECONCILE_INTERVAL_MS;
  const dependencies: ObserverDependencies = {
    ...defaultDependencies,
    ...options.dependencies,
  };

  const entries: WatchEntry[] = [];
  let closed = false;
  let initialReconcileTimer: ReturnType<typeof setTimeout> | null = null;
  let reconcileInterval: ReturnType<typeof setInterval> | null = null;
  let reconciling = false;
  let rerunAllRoots = false;
  const expandedRoots = Array.from(
    new Set(roots.map(pathKey).filter((root) => root.length > 0))
  );
  // Seed with the current registry, then remember every path announced during
  // this observer lifetime. React restarts the observer when the registry's
  // path set changes, so the new instance gets the accepted paths as seeds.
  const knownPaths = new Set(repos.map((repo) => pathKey(repo.path)));

  const reconcileRoots = (rootsToCheck: readonly string[] = expandedRoots): void => {
    if (closed) return;
    if (reconciling) {
      // A synchronous scanner cannot normally overlap itself, but callbacks
      // and injected test seams can be re-entrant. Coalesce them into one
      // complete follow-up pass instead of nesting walks.
      rerunAllRoots = true;
      return;
    }

    reconciling = true;
    try {
      for (const root of rootsToCheck) {
        if (closed) break;
        let discovered: string[];
        try {
          discovered = dependencies.findRepos(root, rootScanDepth);
        } catch {
          // A transient unreadable/missing root is retried by the next pass.
          continue;
        }
        for (const path of discovered) {
          if (closed) break;
          const key = pathKey(path);
          if (!key || knownPaths.has(key)) continue;
          knownPaths.add(key);
          onNewRepoDetected(path);
        }
      }
    } finally {
      reconciling = false;
      if (rerunAllRoots && !closed) {
        rerunAllRoots = false;
        reconcileRoots();
      }
    }
  };

  const watchedRepos = repos.slice(0, maxWatches);
  for (const repo of watchedRepos) {
    const entry = watchRepoCommits(repo, () => {
      if (!closed) onCommitDetected(repo.id);
    }, dependencies.watchPath);
    if (entry) entries.push(entry);
  }

  for (const root of expandedRoots) {
    const entry = watchRootForNewRepos(root, () => reconcileRoots([root]), dependencies.watchPath);
    if (entry) entries.push(entry);
  }

  if (expandedRoots.length > 0) {
    // Catch repositories that appeared before watchers attached (including
    // nested repositories that a non-recursive root watch can never see).
    initialReconcileTimer = setTimeout(() => {
      initialReconcileTimer = null;
      reconcileRoots();
    }, 0);

    if (rootReconcileIntervalMs > 0) {
      reconcileInterval = setInterval(reconcileRoots, rootReconcileIntervalMs);
      reconcileInterval.unref?.();
    }
  }

  return () => {
    if (closed) return;
    closed = true;
    if (initialReconcileTimer) {
      clearTimeout(initialReconcileTimer);
      initialReconcileTimer = null;
    }
    if (reconcileInterval) {
      clearInterval(reconcileInterval);
      reconcileInterval = null;
    }
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
  fire: () => void,
  watchPath: ObserverWatch
): WatchEntry | null => {
  const logPath = join(repo.path, ".git", "logs", "HEAD");
  // No logs/HEAD yet (fresh `git init` before first commit, or a bare
  // submodule clone). Skip rather than racing the file into existence;
  // the safety-net poll will catch it.
  if (!existsSync(logPath)) return null;

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let watcher: ObserverWatchHandle | null = null;

  const trigger = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      fire();
    }, COMMIT_DEBOUNCE_MS);
  };

  try {
    watcher = watchPath(logPath, () => {
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
// Per-root: request a bounded reconciliation when anything under the watched
// directory changes. The watcher itself is deliberately non-recursive for
// portability; findRepos supplies the scanner-matching recursive depth.
// ---------------------------------------------------------------------------

const watchRootForNewRepos = (
  root: string,
  reconcile: () => void,
  watchPath: ObserverWatch
): WatchEntry | null => {
  if (!existsSync(root)) return null;

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let watcher: ObserverWatchHandle | null = null;

  const flush = () => {
    debounceTimer = null;
    reconcile();
  };

  const queue = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(flush, NEW_REPO_DEBOUNCE_MS);
  };

  try {
    watcher = watchPath(root, () => {
      queue();
    });
    watcher.on("error", () => {
      // Reconcile once after an explicit watcher failure, then leave the
      // periodic pass active as the durable fallback.
      queue();
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
