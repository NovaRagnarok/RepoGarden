import {
  DEFAULT_RETENTION_DAYS,
  pruneEvents,
  type PruneEventsResult,
} from "./events";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Compute the cutoff Date for a retention window measured in days.
 * Anything strictly older than the returned timestamp is eligible for
 * pruning.
 */
export const retentionCutoff = (
  retentionDays: number = DEFAULT_RETENTION_DAYS,
  now: Date = new Date()
): Date => new Date(now.getTime() - retentionDays * MS_PER_DAY);

export interface StartupPruneOptions {
  /** Override retention; defaults to DEFAULT_RETENTION_DAYS (90). */
  retentionDays?: number;
  /** Injectable clock for tests. */
  now?: Date;
  /** Injectable pruner for tests; defaults to the real `pruneEvents`. */
  prune?: (opts: { olderThan: Date }) => PruneEventsResult;
}

/**
 * Boot-time journal maintenance. Drops events older than the retention
 * window (default: 90 days, per audit item #7). Fire-and-forget — wraps
 * the prune call so a slow disk or transient FS error never bubbles up
 * into the boot flow.
 *
 * Stays silent on the happy path. When REPOGARDEN_DEBUG=1 *and* the prune
 * actually removed something, logs a single line via console.error so
 * the dev can confirm the wiring is alive without spamming a fresh
 * install.
 */
export const runStartupPrune = (opts: StartupPruneOptions = {}): void => {
  const retentionDays = opts.retentionDays ?? DEFAULT_RETENTION_DAYS;
  const cutoff = retentionCutoff(retentionDays, opts.now);
  const prune = opts.prune ?? pruneEvents;
  try {
    const result = prune({ olderThan: cutoff });
    if (result.pruned > 0 && process.env.REPOGARDEN_DEBUG === "1") {
      // eslint-disable-next-line no-console
      console.error(
        `[repogarden] pruned ${result.pruned} journal event(s) older than ${retentionDays} days`
      );
    }
  } catch {
    // Maintenance must never crash boot. Swallow + carry on.
  }
};

/**
 * Schedule `runStartupPrune` on the next tick so the boot UI paints
 * before we touch disk. Returns the timer handle so callers can cancel
 * during teardown (e.g. unit tests).
 */
export const scheduleStartupPrune = (
  opts: StartupPruneOptions = {}
): ReturnType<typeof setTimeout> =>
  setTimeout(() => runStartupPrune(opts), 0);
