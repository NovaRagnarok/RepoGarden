import { blendHex } from "@/lib/color";
import type { ProjectMemory } from "@/lib/memory-types";
import type { ScannedRepo } from "@/lib/scanner-types";
import type { Mood, Vibe } from "@/lib/vibe-types";

// Earlier versions used "noisy"/"blocked" — see `events.ts` snapshot reader
// and `event-summary.ts` for the read-time migration of pre-rename data.
export type { Mood, Vibe } from "@/lib/vibe-types";

const SLEEPY_DAYS = 14;
const STALE_DAYS = 60;
const LONELY_DAYS = 60;
const LONELY_VISIT_DAYS = 30;
const CURIOUS_MAX_COMMITS = 3;
const PROUD_AHEAD_THRESHOLD = 5;
const BURST_WINDOW_DAYS = 7;
const BURST_BASELINE_DAYS = 23;
const BURST_MIN_COMMITS = 3;
const BURST_RATIO = 2;

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
  /** Advisory mood descriptor. Layered on top of `vibe`; nothing branches
   *  on it. Renderers may surface it when `confidence >= 0.5` and the
   *  mood is not `content`. */
  mood: Mood;
  /** Confidence in the mood, 0..1. Roughly: how strongly the winning
   *  signal stood out. `content` always carries 0.5. */
  confidence: number;
  /** Human-readable phrase backing the mood, in the same register as
   *  `reason` (e.g. "6 unpushed commits", "60 days quiet, no recent visit"). */
  moodReason: string;
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

// Precedence used to break score ties when two candidate moods score
// equally. Earlier entries win. Matches the discrete priority already
// expressed in inferVibe (blocker beats everything else).
const MOOD_PRECEDENCE: readonly Mood[] = [
  "confused",
  "anxious",
  "excited",
  "proud",
  "curious",
  "lonely",
  "content"
] as const;

interface MoodCandidate {
  mood: Mood;
  score: number;
  reason: string;
}

const inferMood = (
  repo: ScannedRepo,
  memory: ProjectMemory | undefined,
  daysSinceCommit: number | undefined,
  now: Date
): { mood: Mood; confidence: number; reason: string } => {
  const candidates: MoodCandidate[] = [];

  const blocker = memory?.currentBlocker?.trim();
  if (blocker) {
    candidates.push({
      mood: "confused",
      score: 0.85,
      reason: `blocker: ${blocker.split("\n")[0].slice(0, 80)}`
    });
  }

  const behind = repo.behind ?? 0;
  if (behind >= 1) {
    candidates.push({
      mood: "anxious",
      // Bump score for larger gaps; capped at 0.85.
      score: Math.min(0.85, 0.55 + Math.log10(behind + 1) * 0.2),
      reason: `${behind} commit${behind === 1 ? "" : "s"} behind remote`
    });
  }

  const ahead = repo.ahead ?? 0;
  if (ahead >= PROUD_AHEAD_THRESHOLD) {
    candidates.push({
      mood: "proud",
      score: Math.min(0.8, 0.5 + Math.log10(ahead) * 0.2),
      reason: `${ahead} unpushed commits stacked up`
    });
  }

  const days = repo.recentCommitDays;
  if (days && days.length >= BURST_WINDOW_DAYS + 1) {
    const window = days.slice(-BURST_WINDOW_DAYS).reduce((a, b) => a + b, 0);
    const baselineSlice = days.slice(-(BURST_WINDOW_DAYS + BURST_BASELINE_DAYS), -BURST_WINDOW_DAYS);
    const baselineMean = baselineSlice.length > 0
      ? baselineSlice.reduce((a, b) => a + b, 0) / baselineSlice.length
      : 0;
    const windowMean = window / BURST_WINDOW_DAYS;
    // Either the burst beats baseline by BURST_RATIO, or there's no
    // baseline at all (new repo finding its rhythm) and the burst clears
    // BURST_MIN_COMMITS.
    const burstingOverBaseline = baselineMean > 0 && windowMean >= baselineMean * BURST_RATIO;
    const burstingFromCold = baselineMean === 0 && window >= BURST_MIN_COMMITS;
    if (window >= BURST_MIN_COMMITS && (burstingOverBaseline || burstingFromCold)) {
      candidates.push({
        mood: "excited",
        score: Math.min(0.85, 0.6 + Math.log10(window) * 0.1),
        reason: `${window} commits in the last ${BURST_WINDOW_DAYS} days`
      });
    }
  }

  const commitCount = repo.commitCount;
  if (
    commitCount !== undefined &&
    commitCount > 0 &&
    commitCount <= CURIOUS_MAX_COMMITS &&
    daysSinceCommit !== undefined &&
    daysSinceCommit <= SLEEPY_DAYS
  ) {
    candidates.push({
      mood: "curious",
      score: 0.45,
      reason: `only ${commitCount} commit${commitCount === 1 ? "" : "s"} so far`
    });
  }

  if (daysSinceCommit !== undefined && daysSinceCommit >= LONELY_DAYS) {
    const lastVisited = memory?.lastVisitedAt;
    let daysSinceVisit: number | undefined;
    if (lastVisited) {
      const parsed = new Date(lastVisited).getTime();
      if (Number.isFinite(parsed)) {
        daysSinceVisit = Math.max(0, Math.floor((now.getTime() - parsed) / 86_400_000));
      }
    }
    const lonelyByAbsence = daysSinceVisit === undefined;
    const lonelyByVisit = daysSinceVisit !== undefined && daysSinceVisit >= LONELY_VISIT_DAYS;
    if (lonelyByAbsence || lonelyByVisit) {
      candidates.push({
        mood: "lonely",
        score: 0.55,
        reason: lonelyByAbsence
          ? `${daysSinceCommit} days quiet, no recent visit`
          : `${daysSinceCommit} days quiet, last visited ${daysSinceVisit}d ago`
      });
    }
  }

  if (candidates.length === 0) {
    return { mood: "content", confidence: 0.5, reason: "nothing remarkable" };
  }

  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return MOOD_PRECEDENCE.indexOf(a.mood) - MOOD_PRECEDENCE.indexOf(b.mood);
  });
  const winner = candidates[0];
  return {
    mood: winner.mood,
    confidence: Math.max(0.3, Math.min(1, winner.score)),
    reason: winner.reason
  };
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
  const moodInfo = inferMood(repo, memory, daysSinceCommit, now);
  const moodFields = {
    mood: moodInfo.mood,
    confidence: moodInfo.confidence,
    moodReason: moodInfo.reason
  };

  const blocker = memory?.currentBlocker?.trim();
  if (blocker) {
    return {
      vibe: "stuck",
      reason: `blocker: ${blocker}`,
      daysSinceCommit,
      activity,
      ...moodFields
    };
  }

  if (daysSinceCommit !== undefined && daysSinceCommit >= SLEEPY_DAYS) {
    return {
      vibe: "sleepy",
      reason:
        daysSinceCommit >= STALE_DAYS
          ? `idle for ${daysSinceCommit} days — almost cobwebs.`
          : `quiet for ${daysSinceCommit} days.`,
      daysSinceCommit,
      activity,
      ...moodFields
    };
  }

  if (repo.isDirty || (repo.ahead ?? 0) > 0) {
    const parts: string[] = [];
    if (repo.isDirty) parts.push("uncommitted changes");
    if ((repo.ahead ?? 0) > 0) parts.push(`${repo.ahead} unpushed commit${repo.ahead === 1 ? "" : "s"}`);
    return { vibe: "awake", reason: parts.join(" · "), daysSinceCommit, activity, ...moodFields };
  }

  return {
    vibe: "happy",
    reason: daysSinceCommit !== undefined ? `last commit ${daysSinceCommit}d ago, clean.` : "clean.",
    daysSinceCommit,
    activity,
    ...moodFields
  };
};

export const vibeGlyph = (vibe: Vibe): string => {
  switch (vibe) {
    case "stuck":
      return "✕";
    case "sleepy":
      return "z";
    case "awake":
      return "!";
    case "happy":
      return "•";
  }
};

/** Subset of a theme palette needed to render a vibe. Lets `vibeColor`
 *  live in this file (no theme-provider dependency) while still
 *  pulling its colors from whichever theme the host is using. */
export interface VibePalette {
  info: string;
  success: string;
  error: string;
}

// Electric cyan anchor used to push awake's blue toward the alive /
// energetic end of the blue family. Hardcoded rather than pulled from
// the theme because no standard theme token represents "more electric
// than info" — and we want the same characterful tint across themes.
const ELECTRIC_ANCHOR = "#22D3EE";
// Pure white anchor used to pull sleepy's blue toward washed-out pale.
// Hardcoded for the same reason — themes don't carry a "wash this
// toward" token, and "near-white" is the visual intent regardless of
// whether the theme background is dark or light.
const WASH_ANCHOR = "#FFFFFF";

/** Color associated with a vibe across the entire UI — sprite bodies,
 *  divider labels, sidebar glyphs, journal kind chips. Centralized here
 *  so a change like "awake should read as positive, not warning"
 *  propagates everywhere at once.
 *
 *  - `awake`   — bright cyan-leaning blue: in-flight work. The 40%
 *    blend toward `ELECTRIC_ANCHOR` pushes the theme's `info` past
 *    "calm blue" into "alive / electric" territory.
 *  - `happy`   — `success` (green): in sync, calm.
 *  - `stuck`   — `error` (red): blocked, needs attention.
 *  - `sleepy`  — washed-out pale blue: same hue family as awake but
 *    pulled 65% toward white, so it reads as "low-energy version of
 *    the active state" with significantly less saturation than
 *    awake's vivid version. */
export const vibeColor = (vibe: Vibe, palette: VibePalette): string => {
  switch (vibe) {
    case "awake":
      return blendHex(palette.info, ELECTRIC_ANCHOR, 0.4);
    case "happy":
      return palette.success;
    case "stuck":
      return palette.error;
    case "sleepy":
      return blendHex(palette.info, WASH_ANCHOR, 0.65);
  }
};
