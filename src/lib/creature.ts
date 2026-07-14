import type { ScannedRepo } from "@/lib/scanner";
import { inspectRepo, inspectRepoLight } from "@/lib/scanner";
import type { ProjectMemory } from "@/lib/memory";
import { loadMemory } from "@/lib/memory";
import {
  appendEvent,
  loadEventsMeta,
  loadScanSnapshot,
  saveEventsMeta,
  saveScanSnapshot,
  type SnapEntry,
} from "@/lib/events";
import { inferVibe, type VibeResult } from "@/lib/vibe";

export interface RepoCreature {
  id: string;
  scan: ScannedRepo;
  memory: ProjectMemory;
  vibe: VibeResult;
}

export const buildCreature = (scan: ScannedRepo, now: Date = new Date()): RepoCreature => {
  const memory = loadMemory(scan.id);
  const vibe = inferVibe({ repo: scan, memory, now });
  return { id: scan.id, scan, memory, vibe };
};

const BACKFILL_COMMIT_CAP = 20;

interface ReconcileOptions {
  /**
   * When true, snapshot entries for repos absent from `creatures` are
   * preserved instead of pruned, and the first-run backfill is skipped.
   * Use when the scan is known to be partial (e.g., one configured root
   * errored or was unmounted), so repos from the missing root don't look
   * "new" on the next clean scan.
   */
  preserveMissing?: boolean;
}

/**
 * Diff the current creatures against the persisted scan snapshot and emit
 * journal events for new repos, vibe changes, branch switches, and new
 * commits. Also handles the one-time backfill on first run.
 *
 * Called at the end of `enrichScans` so it runs after every full scan.
 */
const reconcileWithSnapshot = (
  creatures: RepoCreature[],
  options: ReconcileOptions = {}
): void => {
  const now = new Date().toISOString();
  const meta = loadEventsMeta();
  const snapshot = loadScanSnapshot();

  if (!meta.seeded) {
    // Skip seeding when we don't have a representative repo set:
    // an empty scan (wrong/unmounted folder picked at onboarding) or a
    // partial scan (one root failed). Marking seeded=true here would lose
    // the first-time recent-commit backfill when real repos later appear.
    if (creatures.length === 0 || options.preserveMissing) return;

    // One-time backfill: emit repo-added + recent commits for every creature.
    for (const creature of creatures) {
      const { scan } = creature;
      const repoTs =
        scan.recentCommits && scan.recentCommits.length > 0
          ? scan.recentCommits[scan.recentCommits.length - 1].committedAt ?? now
          : now;

      appendEvent({
        ts: repoTs,
        repoId: scan.id,
        repoName: scan.name,
        kind: "repo-added",
        payload: { path: scan.path },
      });

      const commits = (scan.recentCommits ?? []).slice(-BACKFILL_COMMIT_CAP);
      // Emit in chronological order (oldest first).
      for (const commit of commits) {
        appendEvent({
          ts: commit.committedAt ?? now,
          repoId: scan.id,
          repoName: scan.name,
          kind: "commit",
          payload: {
            sha: commit.sha,
            shortSha: commit.shortSha,
            subject: commit.subject,
          },
        });
      }
    }

    // Save the snapshot before marking as seeded.
    const newSnap: Record<string, SnapEntry> = {};
    for (const creature of creatures) {
      newSnap[creature.id] = {
        vibe: creature.vibe.vibe,
        branch: creature.scan.branch,
        latestCommitSha: creature.scan.lastCommitSha,
        mood: creature.vibe.mood,
      };
    }
    saveScanSnapshot(newSnap);
    saveEventsMeta({ seeded: true, seededAt: now });
    return;
  }

  // Normal reconcile: diff against snapshot.
  const nextSnap: Record<string, SnapEntry> = {};
  // Confidence floor and per-repo cool-off for mood-changed events.
  // The cool-off prevents same-day mood flickers (a single push flipping a
  // repo proud→content→proud) from spamming the journal — mood signals
  // are noisier than vibe by design.
  const MOOD_EMIT_CONFIDENCE = 0.7;
  const MOOD_EMIT_COOLDOWN_MS = 24 * 60 * 60 * 1000;
  const nowMs = new Date(now).getTime();

  for (const creature of creatures) {
    const { scan } = creature;
    const prev = snapshot[creature.id];
    let nextMoodAt: string | undefined;

    if (!prev) {
      // New repo — not seen before.
      appendEvent({
        ts: now,
        repoId: scan.id,
        repoName: scan.name,
        kind: "repo-added",
        payload: { path: scan.path },
      });
    } else {
      // Vibe change
      if (prev.vibe !== creature.vibe.vibe) {
        appendEvent({
          ts: now,
          repoId: scan.id,
          repoName: scan.name,
          kind: "vibe-changed",
          payload: { from: prev.vibe, to: creature.vibe.vibe, reason: creature.vibe.reason },
        });
      }

      // Mood change. Only emits when:
      //   - we have a previous mood to compare against (no event the first
      //     time a snapshot upgrade adds the field — that would otherwise
      //     light up the journal for every repo at once);
      //   - the mood actually differs;
      //   - the *current* mood is confident enough to be worth journaling;
      //   - the per-repo cool-off has elapsed since the last mood event.
      // Snapshot always tracks current mood; only `moodAt` is gated by
      // emission, so a flicker that gets suppressed is still "remembered".
      const currMood = creature.vibe.mood;
      const prevMood = prev.mood;
      const prevMoodAtMs = prev.moodAt ? new Date(prev.moodAt).getTime() : 0;
      const cooldownElapsed =
        !Number.isFinite(prevMoodAtMs) ||
        prevMoodAtMs === 0 ||
        nowMs - prevMoodAtMs >= MOOD_EMIT_COOLDOWN_MS;
      if (
        prevMood !== undefined &&
        prevMood !== currMood &&
        creature.vibe.confidence >= MOOD_EMIT_CONFIDENCE &&
        cooldownElapsed
      ) {
        appendEvent({
          ts: now,
          repoId: scan.id,
          repoName: scan.name,
          kind: "mood-changed",
          payload: {
            from: prevMood,
            to: currMood,
            reason: creature.vibe.moodReason,
          },
        });
        nextMoodAt = now;
      } else {
        nextMoodAt = prev.moodAt;
      }

      // Branch switch
      if (prev.branch !== undefined && scan.branch !== undefined && prev.branch !== scan.branch) {
        appendEvent({
          ts: now,
          repoId: scan.id,
          repoName: scan.name,
          kind: "branch-switched",
          payload: { from: prev.branch, to: scan.branch },
        });
      }

      // New commits since last snapshot — find commits newer than latestCommitSha.
      if (scan.recentCommits && scan.recentCommits.length > 0) {
        const prevSha = prev.latestCommitSha;
        let newCommits = scan.recentCommits;
        if (prevSha) {
          const cutoffIdx = scan.recentCommits.findIndex((c) => c.sha === prevSha);
          if (cutoffIdx >= 0) {
            // Commits before cutoffIdx are newer (most-recent-first ordering from git log).
            newCommits = scan.recentCommits.slice(0, cutoffIdx);
          }
          // If prevSha not found in the window, all visible commits are "new" — emit them.
        }
        // Emit in chronological order (oldest first = reversed).
        for (const commit of [...newCommits].reverse()) {
          appendEvent({
            ts: commit.committedAt ?? now,
            repoId: scan.id,
            repoName: scan.name,
            kind: "commit",
            payload: {
              sha: commit.sha,
              shortSha: commit.shortSha,
              subject: commit.subject,
            },
          });
        }
      }
    }

    nextSnap[creature.id] = {
      vibe: creature.vibe.vibe,
      branch: creature.scan.branch,
      latestCommitSha: creature.scan.lastCommitSha,
      mood: creature.vibe.mood,
      moodAt: nextMoodAt,
    };
  }

  if (options.preserveMissing) {
    // Carry over entries for repos absent from this scan (likely from a
    // failed root). Without this they'd be pruned and look "new" next time.
    for (const [id, entry] of Object.entries(snapshot)) {
      if (!(id in nextSnap)) nextSnap[id] = entry;
    }
  }

  saveScanSnapshot(nextSnap);
};

/**
 * Light background refresh — for every creature, run the cheap probe
 * (`inspectRepoLight`). If HEAD moved since the last full scan, fall back
 * to a single-repo `inspectRepo` and re-run `enrichScans` over the full
 * list so the journal events store stays accurate. Otherwise shallow-
 * merge ahead/behind/dirty/branch into the existing scan and rebuild the
 * creature locally (no snapshot reconcile — nothing of journal-interest
 * changed).
 *
 * Returns the next creature list. Identity-stable when nothing changed:
 * callers can compare reference equality to skip a setState.
 */
export const refreshCreaturesLight = (
  creatures: RepoCreature[]
): RepoCreature[] => {
  let anyHeavyChange = false;
  let anyLightChange = false;
  const nextScans: ScannedRepo[] = creatures.map((c) => c.scan);

  for (let i = 0; i < creatures.length; i++) {
    const creature = creatures[i];
    const probe = inspectRepoLight(creature.scan.path);
    if (!probe) continue; // repo vanished — leave the stale scan, full rescan will clean up

    if (probe.headSha && probe.headSha !== creature.scan.lastCommitSha) {
      // HEAD moved — pay the cost of a full inspect for this one repo so
      // recentCommits / lastCommitSubject / sparkline pick up the new commit.
      const fresh = inspectRepo(creature.scan.path);
      nextScans[i] = fresh;
      anyHeavyChange = true;
      continue;
    }

    const prev = creature.scan;
    const same =
      prev.isDirty === probe.isDirty &&
      prev.ahead === probe.ahead &&
      prev.behind === probe.behind &&
      prev.branch === probe.branch;
    if (same) continue;

    nextScans[i] = {
      ...prev,
      branch: probe.branch ?? prev.branch,
      ahead: probe.ahead,
      behind: probe.behind,
      isDirty: probe.isDirty,
    };
    anyLightChange = true;
  }

  if (anyHeavyChange) {
    // Heavy change went through inspectRepo for at least one repo → run
    // the full enrich path so reconcileWithSnapshot fires and journal
    // events accumulate.
    return enrichScans(nextScans);
  }

  if (!anyLightChange) return creatures;

  // Light-only changes: rebuild creatures from the cheap-updated scans
  // without touching the snapshot. Vibe recomputes naturally because
  // buildCreature reads from scan.
  const now = new Date();
  return nextScans.map((scan, i) => {
    if (scan === creatures[i].scan) return creatures[i];
    return buildCreature(scan, now);
  });
};

export interface EnrichScansOptions {
  /**
   * Reconcile against the on-disk scan snapshot and emit journal events.
   * Pass false on partial / streaming scans: reconciling a partial list
   * trims the snapshot to just the visible creatures, so the next partial
   * batch sees its other repos as "new" and emits phantom repo-added
   * events. Only the final scan result should reconcile.
   */
  reconcile?: boolean;
  /**
   * Treat `scans` as a partial picture (e.g., one configured root errored).
   * Preserves snapshot entries for repos absent from `scans` and suppresses
   * the first-run backfill until we see a full scan.
   */
  preserveMissing?: boolean;
}

/**
 * Re-inspect a single creature's repo and rebuild the full creature list
 * with its updated scan in place. Used by the background observer so a
 * changed HEAD is reflected without paying for a full directory walk.
 * `enrichScans` reconciles against the snapshot so any new commits flow
 * into the journal naturally.
 *
 * Returns the original list when the id is unknown.
 */
export const refreshOneCreature = (
  creatures: RepoCreature[],
  id: string
): RepoCreature[] => {
  const index = creatures.findIndex((creature) => creature.id === id);
  if (index === -1) return creatures;
  const prior = creatures[index].scan;
  const inspected = inspectRepo(prior.path);
  const fresh = {
    ...inspected,
    github: prior.github,
    remote: prior.remote ?? inspected.remote
  };
  const nextScans = creatures.map((creature, i) => (i === index ? fresh : creature.scan));
  return enrichScans(nextScans);
};

export const enrichScans = (
  scans: ScannedRepo[],
  options: EnrichScansOptions = {}
): RepoCreature[] => {
  const { reconcile = true, preserveMissing = false } = options;
  const now = new Date();
  const creatures = scans
    .map((scan) => buildCreature(scan, now))
    .sort((left, right) => {
      // Canonical display order across the UI: awake first, sleepy last —
      // mirrors VIBE_ORDER in garden-layout.ts so the shelf and the chrome
      // vibe summary read the same direction.
      const order: Record<VibeResult["vibe"], number> = {
        awake: 0,
        happy: 1,
        stuck: 2,
        sleepy: 3
      };
      const diff = order[left.vibe.vibe] - order[right.vibe.vibe];
      if (diff !== 0) return diff;
      return left.scan.name.localeCompare(right.scan.name);
    });

  if (reconcile) {
    // Best-effort — a failure here must not crash the UI.
    try {
      reconcileWithSnapshot(creatures, { preserveMissing });
    } catch {
      // non-fatal; event log is supplementary
    }
  }

  return creatures;
};
