// Synthetic roster used by:
//  - demo mode (renames real creatures with these names + commit subjects for
//    screenshot-friendly captures that read as a real garden rather than ▓▓▓)
//  - settings garden preview (renders the whole roster so a theme swap shows
//    every part of the palette + vibe styling at once)
//
// Names lean cute but plausibly-real ("pocket-cron", "moss-cms",
// "tidepool") — distinct from mask mode's poetic aliases ("plum-thistle-mole")
// which read as obviously fake. Same set, used in two ways.

import type { RepoCreature } from "@/lib/creature";
import { hashString } from "@/lib/sprite";
import type { Vibe } from "@/lib/vibe";

export const DEMO_NAMES: readonly string[] = [
  "pocket-cron",
  "moss-cms",
  "tidepool",
  "habit-fossil",
  "rivertown",
  "glassmark",
  "dewdrop",
  "briar",
  "pinecone-press",
  "lantern-rs",
  "salt-and-paper",
  "kettle",
  "minnow",
  "fernway",
  "thornbush",
  "snug-deploy"
];

export const DEMO_BRANCHES: readonly string[] = [
  "main",
  "main",
  "main",
  "feat/portraits",
  "fix/auth-edge",
  "release-1.3",
  "wip/refactor",
  "main",
  "next",
  "fix/scroll-jank"
];

export const DEMO_SUBJECTS: readonly string[] = [
  "fix the loading spinner edge case",
  "bump deps and clean unused imports",
  "wire up the new portrait section",
  "render markdown in notes",
  "tighten the scroll-into-view logic",
  "drop ink-text-input from deps",
  "extract toast-host into its own module",
  "make pagination capacity dynamic",
  "preserve sprite identity through mask toggle",
  "tune the arcade palette saturation",
  "swap dusty colors for arcade hues",
  "let themes ship their own palettes",
  "rework the settings preview grid",
  "stabilize the dither-overlay timing",
  "fix flicker on garden→shelf swap",
  "guard against missing repo paths"
];

export const DEMO_AUTHORS: readonly string[] = [
  "outsideheaven",
  "jordan-rb",
  "kim.h",
  "noor.s",
  "rae",
  "sam.r"
];

const DEMO_VIBES: readonly Vibe[] = [
  "happy",
  "happy",
  "happy",
  "happy",
  "happy",
  "noisy",
  "noisy",
  "noisy",
  "blocked",
  "sleepy",
  "sleepy"
];

const pickFrom = <T,>(list: readonly T[], seed: number, salt: string): T => {
  const idx = Math.abs(hashString(`${salt}:${seed}`)) % list.length;
  return list[idx] as T;
};

/** Pick a believable demo name for any stable id. Stable: same id always
 *  picks the same name across renders. */
export const demoNameFor = (id: string): string =>
  pickFrom(DEMO_NAMES, hashString(`demo-name:${id}`), "n");

export const demoBranchFor = (id: string): string =>
  pickFrom(DEMO_BRANCHES, hashString(`demo-branch:${id}`), "b");

export const demoSubjectFor = (id: string): string =>
  pickFrom(DEMO_SUBJECTS, hashString(`demo-subject:${id}`), "s");

export const demoAuthorFor = (id: string): string =>
  pickFrom(DEMO_AUTHORS, hashString(`demo-author:${id}`), "a");

export const demoVibeFor = (id: string): Vibe =>
  pickFrom(DEMO_VIBES, hashString(`demo-vibe:${id}`), "v");

/** Build a complete synthetic creature roster for the settings preview. */
export const buildDemoCreatures = (): RepoCreature[] =>
  DEMO_NAMES.map((name, idx) => {
    const id = `demo:${name}`;
    const vibe = demoVibeFor(id);
    const branch = demoBranchFor(id);
    const subject = demoSubjectFor(id);
    const author = demoAuthorFor(id);
    // Distribute ages so the vibe summary looks varied: 0-2d for happy/noisy,
    // 14+ for sleepy, ~5d for blocked. Deterministic per index.
    const daysSinceCommit =
      vibe === "sleepy" ? 14 + (idx % 8) : vibe === "blocked" ? 5 + (idx % 3) : idx % 3;
    const now = Date.now();
    const lastCommitAt = new Date(now - daysSinceCommit * 24 * 60 * 60 * 1000).toISOString();
    return {
      id,
      scan: {
        id,
        path: `~/work/${name}`,
        name,
        branch,
        isDirty: vibe === "noisy",
        ahead: vibe === "noisy" ? 2 : 0,
        behind: 0,
        lastCommitSubject: subject,
        lastCommitSha: hashString(id).toString(16).slice(0, 7),
        lastCommitAt,
        primaryLanguage: ["TypeScript", "Rust", "Go", "Python", "Ruby"][idx % 5],
        commitCount: 40 + (idx * 17) % 200,
        recentCommitDays: Array.from({ length: 30 }, (_, d) => (d + idx) % 4 === 0 ? 1 : 0)
      },
      memory: {
        lastVisitedAt: lastCommitAt,
        hidden: false
      },
      vibe: {
        vibe,
        reason:
          vibe === "happy"
            ? "humming along quietly"
            : vibe === "noisy"
              ? "lots of recent activity"
              : vibe === "blocked"
                ? "something is in the way"
                : "resting for a while",
        daysSinceCommit
      }
    };
  });
