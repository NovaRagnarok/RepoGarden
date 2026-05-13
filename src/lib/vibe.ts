import type { ScannedRepo } from "@/lib/scanner";
import type { ProjectMemory } from "@/lib/memory";

export type Vibe = "sleepy" | "blocked" | "noisy" | "happy";

const SLEEPY_DAYS = 14;
const STALE_DAYS = 60;

export interface VibeContext {
  repo: ScannedRepo;
  memory?: ProjectMemory;
  now?: Date;
}

export interface VibeResult {
  vibe: Vibe;
  reason: string;
  daysSinceCommit?: number;
}

export const inferVibe = ({ repo, memory, now = new Date() }: VibeContext): VibeResult => {
  const blocker = memory?.currentBlocker?.trim();
  if (blocker) {
    return { vibe: "blocked", reason: `blocker: ${blocker}` };
  }

  let daysSinceCommit: number | undefined;
  if (repo.lastCommitAt) {
    daysSinceCommit = Math.max(
      0,
      Math.floor((now.getTime() - new Date(repo.lastCommitAt).getTime()) / 86_400_000)
    );
  }

  if (daysSinceCommit !== undefined && daysSinceCommit >= SLEEPY_DAYS) {
    return {
      vibe: "sleepy",
      reason:
        daysSinceCommit >= STALE_DAYS
          ? `idle for ${daysSinceCommit} days — almost cobwebs.`
          : `quiet for ${daysSinceCommit} days.`,
      daysSinceCommit
    };
  }

  if (repo.isDirty || (repo.ahead ?? 0) > 0) {
    const parts: string[] = [];
    if (repo.isDirty) parts.push("uncommitted changes");
    if ((repo.ahead ?? 0) > 0) parts.push(`${repo.ahead} unpushed commit${repo.ahead === 1 ? "" : "s"}`);
    return { vibe: "noisy", reason: parts.join(" · "), daysSinceCommit };
  }

  return {
    vibe: "happy",
    reason: daysSinceCommit !== undefined ? `last commit ${daysSinceCommit}d ago, clean.` : "clean.",
    daysSinceCommit
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
