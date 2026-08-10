import { existsSync, watch } from "node:fs";
import { join } from "node:path";

import { findRepos } from "./scanner";

// fs.watch is a latency optimization. Root reconciliation is the authority:
// it searches the same bounded depth as the foreground scanner on startup,
// after any root event/error, and periodically when events are dropped.

const COMMIT_DEBOUNCE_MS = 250;
const ROOT_RECONCILE_DEBOUNCE_MS = 500;
export const ROOT_RECONCILE_INTERVAL_MS = 30_000;
export const ROOT_RECONCILE_MAX_DEPTH = 4;
export const DEFAULT_MAX_WATCHES = 150;

export interface ObserverRepo {
  id: string;
  path: string;
}

interface WatchEntry {
  close: () => void;
  on: (event: "error", listener: () => void) => unknown;
}

export interface ObserverDependencies {
  exists: (path: string) => boolean;
  watch: (
    path: string,
    listener: (eventType: string, filename: string | null) => void
  ) => WatchEntry;
  findRepos: (
    root: string,
    maxDepth: number
  ) => readonly string[] | Promise<readonly string[]>;
  setInterval: typeof globalThis.setInterval;
  clearInterval: typeof globalThis.clearInterval;
}

const DEFAULT_DEPENDENCIES: ObserverDependencies = {
  exists: existsSync,
  watch: watch as ObserverDependencies["watch"],
  findRepos,
  setInterval: globalThis.setInterval,
  clearInterval: globalThis.clearInterval,
};

export interface StartObserverOptions {
  repos: ObserverRepo[];
  roots: string[];
  onCommitDetected: (id: string) => void;
  onNewRepoDetected: (path: string) => void;
  maxWatches?: number;
  /** Deterministic seams for watcher/reconciliation lifecycle tests. */
  dependencies?: Partial<ObserverDependencies>;
}

/**
 * Start per-repository commit watches plus authoritative scan-root
 * reconciliation. The returned close function is idempotent. Reconciliation
 * passes never overlap; a request arriving mid-pass schedules exactly one
 * follow-up pass, and callbacks are suppressed after close.
 */
export const startObserver = (options: StartObserverOptions): (() => void) => {
  const { repos, roots, onCommitDetected, onNewRepoDetected } = options;
  const maxWatches = options.maxWatches ?? DEFAULT_MAX_WATCHES;
  const dependencies: ObserverDependencies = {
    ...DEFAULT_DEPENDENCIES,
    ...options.dependencies,
  };
  const entries: WatchEntry[] = [];
  const knownPaths = new Set(repos.map((repo) => repo.path));
  let closed = false;
  let rootDebounceTimer: ReturnType<typeof setTimeout> | undefined;
  let reconcileRunning = false;
  let reconcilePending = false;

  const runReconciliation = async (): Promise<void> => {
    if (reconcileRunning || closed) return;
    reconcileRunning = true;
    try {
      while (reconcilePending && !closed) {
        reconcilePending = false;
        for (const root of roots) {
          if (closed) return;
          let discovered: readonly string[];
          try {
            discovered = await dependencies.findRepos(
              root,
              ROOT_RECONCILE_MAX_DEPTH
            );
          } catch {
            // A later watcher event or periodic pass retries this root.
            continue;
          }
          if (closed) return;
          for (const path of discovered) {
            if (knownPaths.has(path)) continue;
            knownPaths.add(path);
            onNewRepoDetected(path);
          }
        }
      }
    } finally {
      reconcileRunning = false;
      // A request can land after the loop condition but before finally.
      if (reconcilePending && !closed) void runReconciliation();
    }
  };

  const requestReconciliation = (): void => {
    if (closed) return;
    reconcilePending = true;
    void runReconciliation();
  };

  const queueReconciliation = (): void => {
    if (closed) return;
    if (rootDebounceTimer) clearTimeout(rootDebounceTimer);
    rootDebounceTimer = setTimeout(() => {
      rootDebounceTimer = undefined;
      requestReconciliation();
    }, ROOT_RECONCILE_DEBOUNCE_MS);
  };

  for (const repo of repos.slice(0, maxWatches)) {
    const entry = watchRepoCommits(repo, dependencies, () => {
      if (!closed) onCommitDetected(repo.id);
    });
    if (entry) entries.push(entry);
  }

  for (const root of roots) {
    try {
      if (!dependencies.exists(root)) continue;
    } catch {
      // Initial and periodic reconciliation still retry the root.
      continue;
    }
    let watcher: WatchEntry | undefined;
    try {
      watcher = dependencies.watch(root, () => queueReconciliation());
      watcher.on("error", () => {
        try {
          watcher?.close();
        } catch {
          // already closed
        }
        queueReconciliation();
      });
      entries.push(watcher);
    } catch {
      // Initial and periodic reconciliation still cover unsupported watches.
    }
  }

  requestReconciliation();
  const interval = dependencies.setInterval(
    requestReconciliation,
    ROOT_RECONCILE_INTERVAL_MS
  );

  return () => {
    if (closed) return;
    closed = true;
    reconcilePending = false;
    dependencies.clearInterval(interval);
    if (rootDebounceTimer) {
      clearTimeout(rootDebounceTimer);
      rootDebounceTimer = undefined;
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

const watchRepoCommits = (
  repo: ObserverRepo,
  dependencies: ObserverDependencies,
  fire: () => void
): WatchEntry | null => {
  const logPath = join(repo.path, ".git", "logs", "HEAD");
  if (!dependencies.exists(logPath)) return null;

  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let watcher: WatchEntry | undefined;
  const trigger = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = undefined;
      fire();
    }, COMMIT_DEBOUNCE_MS);
  };

  try {
    watcher = dependencies.watch(logPath, trigger);
    watcher.on("error", () => {
      try {
        watcher?.close();
      } catch {
        // already closed
      }
      watcher = undefined;
    });
  } catch {
    return null;
  }

  return {
    on: () => undefined,
    close: () => {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = undefined;
      }
      if (watcher) {
        try {
          watcher.close();
        } catch {
          // already closed
        }
        watcher = undefined;
      }
    },
  };
};
