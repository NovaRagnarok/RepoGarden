import type { ScannedRepo } from "@/lib/scanner";
import type { ProjectMemory } from "@/lib/memory";

export type Vibe = "sleepy" | "blocked" | "noisy" | "happy";

const SLEEPY_DAYS = 14;
const STALE_DAYS = 60;

/**
 * Half-life (in days) for the per-repo activity decay. A 7-day half-life
 * means a commit from yesterday reads as nearly fully active, a week-old
 * commit reads as half active, and a 60-day-old commit reads as
 * essentially inert. Drives animation cadence (wiggle + wander) so a
 * recent repo visibly bustles and a long-quiet one barely moves.
 */
export const ACTIVITY_HALF_LIFE_DAYS = 7;

export interface VibeContext {
  repo: ScannedRepo;
  memory?: ProjectMemory;
  now?: Date;
}

export interface VibeResult {
  vibe: Vibe;
  reason: string;
  daysSinceCommit?: number;
  /** Continuous 0–1 activity scalar derived from `daysSinceCommit` via
   *  exponential decay; 1 = fresh, 0 = never committed / very stale. */
  activity: number;
}

/**
 * Continuous animation scalar from "days since last commit". Clamped to
 * [0, 1]; undefined input (never committed) is treated as fully inert.
 */
export const computeActivity = (daysSinceCommit: number | undefined): number => {
  if (daysSinceCommit === undefined) return 0;
  if (daysSinceCommit <= 0) return 1;
  return Math.pow(0.5, daysSinceCommit / ACTIVITY_HALF_LIFE_DAYS);
};

export const inferVibe = ({ repo, memory, now = new Date() }: VibeContext): VibeResult => {
  let daysSinceCommit: number | undefined;
  if (repo.lastCommitAt) {
    daysSinceCommit = Math.max(
      0,
      Math.floor((now.getTime() - new Date(repo.lastCommitAt).getTime()) / 86_400_000)
    );
  }
  const activity = computeActivity(daysSinceCommit);

  const blocker = memory?.currentBlocker?.trim();
  if (blocker) {
    return { vibe: "blocked", reason: `blocker: ${blocker}`, daysSinceCommit, activity };
  }

  if (daysSinceCommit !== undefined && daysSinceCommit >= SLEEPY_DAYS) {
    return {
      vibe: "sleepy",
      reason:
        daysSinceCommit >= STALE_DAYS
          ? `idle for ${daysSinceCommit} days — almost cobwebs.`
          : `quiet for ${daysSinceCommit} days.`,
      daysSinceCommit,
      activity
    };
  }

  if (repo.isDirty || (repo.ahead ?? 0) > 0) {
    const parts: string[] = [];
    if (repo.isDirty) parts.push("uncommitted changes");
    if ((repo.ahead ?? 0) > 0) parts.push(`${repo.ahead} unpushed commit${repo.ahead === 1 ? "" : "s"}`);
    return { vibe: "noisy", reason: parts.join(" · "), daysSinceCommit, activity };
  }

  return {
    vibe: "happy",
    reason: daysSinceCommit !== undefined ? `last commit ${daysSinceCommit}d ago, clean.` : "clean.",
    daysSinceCommit,
    activity
  };
};

export const vibeGlyph = (vibe: Vibe): string => {
  switch (vibe) {
    case "blocked":
      return "✕";
    case "sleepy":
      return "z";
    case "noisy":
      return "!";
    case "happy":
      return "•";
  }
};
