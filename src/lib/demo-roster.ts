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
import { computeActivity, type Vibe } from "@/lib/vibe";

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
  "snug-deploy",
  "acorn-rs",
  "sprout-db",
  "mothbot",
  "reed-cli",
  "driftlog",
  "pebble-ci",
  "clover-api",
  "ripple-cms",
  "nestwatch",
  "twig-deploy",
  "garden-lint",
  "puddle-map",
  "wrenpress",
  "loamkit",
  "lichen-sync",
  "dawnqueue"
];

export const DEMO_BRANCHES: readonly string[] = [
  "main",
  "main",
  "main",
  "main",
  "feat/portraits",
  "feat/demo-roster",
  "feat/theme-lab",
  "fix/auth-edge",
  "fix/name-cycle",
  "fix/scroll-jank",
  "release-1.3",
  "wip/refactor",
  "refactor/shelf",
  "chore/seed-data",
  "docs/screenshots",
  "next"
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
  "guard against missing repo paths",
  "add seeded names for larger demo gardens",
  "teach preview creatures to fill the shelf",
  "soften empty-state copy",
  "cache repo colors between scans",
  "dedupe demo roster assignments",
  "trim long aliases in narrow shelves",
  "add keyboard shortcut hints",
  "make branch badges wrap cleanly",
  "fix stale garden counts after refresh",
  "move sprite helpers behind a tiny API",
  "document the demo capture workflow",
  "keep active creatures stable on reload",
  "show quieter defaults in privacy mode",
  "tune idle animation pacing",
  "replace brittle path parsing",
  "add fixtures for masked names"
];

export const DEMO_AUTHORS: readonly string[] = [
  "outsideheaven",
  "jordan-rb",
  "kim.h",
  "noor.s",
  "rae",
  "sam.r",
  "mika",
  "tali.dev",
  "ivy.n",
  "leo-p"
];

// Balanced for the demo screenshot/GIF: each vibe gets equal probability so
// the shelf view shows four roughly-same-sized groups under their dividers.
// Real-world distributions are usually happy-heavy, but the demo's job is to
// show the *vocabulary* (awake / happy / stuck / sleepy), not to look like a
// statistically typical user.
const DEMO_VIBES: readonly Vibe[] = [
  "awake",
  "happy",
  "stuck",
  "sleepy"
];

const pickFrom = <T,>(list: readonly T[], seed: number, salt: string): T => {
  const idx = Math.abs(hashString(`${salt}:${seed}`)) % list.length;
  return list[idx] as T;
};

// Without-replacement assignment of demo names across a known id set. Same
// id set always yields the same id→name map; sort key is the id string
// (paths are stable, so this is stable across renders). Cycles with a "-2",
// "-3" suffix when the set exceeds the roster size — so 17 creatures still
// get unique names.
export const buildDemoNameMap = (
  ids: readonly string[]
): Map<string, string> => {
  const sorted = [...new Set(ids)].sort();
  const map = new Map<string, string>();
  sorted.forEach((id, i) => {
    const baseIdx = i % DEMO_NAMES.length;
    const cycle = Math.floor(i / DEMO_NAMES.length);
    const base = DEMO_NAMES[baseIdx] as string;
    map.set(id, cycle === 0 ? base : `${base}-${cycle + 1}`);
  });
  return map;
};

// Module-level active id set. `useMaskedCreatures` refreshes this each time
// it runs in demo mode so per-id callers (maskName, maskPath, maskCreature)
// all resolve to the same without-replacement assignment without having to
// thread the full list through every context callback.
let activeDemoNameMap: Map<string, string> | null = null;
let activeDemoFingerprint = "";

export const setActiveDemoIds = (ids: readonly string[]): void => {
  const fingerprint = [...new Set(ids)].sort().join("|");
  if (fingerprint === activeDemoFingerprint && activeDemoNameMap) return;
  activeDemoFingerprint = fingerprint;
  activeDemoNameMap = buildDemoNameMap(ids);
};

export const clearActiveDemoIds = (): void => {
  activeDemoFingerprint = "";
  activeDemoNameMap = null;
};

/** Pick a believable demo name for any stable id. Stable: same id always
 *  picks the same name across renders. When the caller has previously
 *  registered the full id set via `setActiveDemoIds`, names are unique
 *  within that set; otherwise we fall back to a hash-modulo pick (which can
 *  collide on small rosters — see #7). */
export const demoNameFor = (id: string): string => {
  const fromMap = activeDemoNameMap?.get(id);
  if (fromMap) return fromMap;
  return pickFrom(DEMO_NAMES, hashString(`demo-name:${id}`), "n");
};

export const demoBranchFor = (id: string): string =>
  pickFrom(DEMO_BRANCHES, hashString(`demo-branch:${id}`), "b");

export const demoSubjectFor = (id: string): string =>
  pickFrom(DEMO_SUBJECTS, hashString(`demo-subject:${id}`), "s");

export const demoAuthorFor = (id: string): string =>
  pickFrom(DEMO_AUTHORS, hashString(`demo-author:${id}`), "a");

export const demoVibeFor = (id: string): Vibe =>
  pickFrom(DEMO_VIBES, hashString(`demo-vibe:${id}`), "v");

// Per-index "size archetype" for the demo roster. Real repos span roughly
// 3 → 5000 commits; the demo used to bunch around 40–240 which the size
// cohort normalised into almost-identical sprite footprints. The wider
// spread below feeds `creatureActivityMass` (commit count is the dominant
// log term) so sprites visibly range from "tiny acorn" to "chunky tile."
const DEMO_SIZE_ARCHETYPES: readonly number[] = [
  4, 11, 22, 38, 65, 110, 175, 280, 440, 680, 1050, 1700, 3200
];

// Density of the 30-day recentCommitDays vector. Pairs with the size
// archetype so a "big" repo also shows a lot of recent activity and a
// "tiny" repo barely has any — that's what the activity scalar would
// look like for the same repos in the wild. The last entry pairs with
// the 3200-commit "boss" archetype — a commit every day for the past 30.
const DEMO_RECENT_DENSITY: readonly number[] = [
  12, 9, 7, 5, 4, 3, 3, 2, 2, 2, 2, 2, 1
];

/** Build a complete synthetic creature roster for the settings preview. */
export const buildDemoCreatures = (): RepoCreature[] =>
  DEMO_NAMES.map((name, idx) => {
    const id = `demo:${name}`;
    const vibe = demoVibeFor(id);
    const branch = demoBranchFor(id);
    const subject = demoSubjectFor(id);
    const author = demoAuthorFor(id);
    // Distribute ages so the vibe summary looks varied: 0-2d for happy/awake,
    // 14+ for sleepy, ~5d for stuck. Deterministic per index.
    const daysSinceCommit =
      vibe === "sleepy" ? 14 + (idx % 8) : vibe === "stuck" ? 5 + (idx % 3) : idx % 3;
    const now = Date.now();
    const lastCommitAt = new Date(now - daysSinceCommit * 24 * 60 * 60 * 1000).toISOString();
    // Cycle the archetype list at an offset coprime with its length so the
    // size sequence doesn't visibly align with vibe groupings.
    const archetypeIdx = (idx * 5) % DEMO_SIZE_ARCHETYPES.length;
    const baseCommits = DEMO_SIZE_ARCHETYPES[archetypeIdx] as number;
    const commitCount = baseCommits + ((idx * 3) % 7);
    const recentEvery = DEMO_RECENT_DENSITY[archetypeIdx] as number;
    return {
      id,
      scan: {
        id,
        path: `~/work/${name}`,
        name,
        branch,
        isDirty: vibe === "awake",
        ahead: vibe === "awake" ? 2 : 0,
        behind: 0,
        lastCommitSubject: subject,
        lastCommitSha: hashString(id).toString(16).slice(0, 7),
        lastCommitAt,
        primaryLanguage: ["TypeScript", "Rust", "Go", "Python", "Ruby"][idx % 5],
        commitCount,
        recentCommitDays: Array.from({ length: 30 }, (_, d) =>
          (d + idx) % recentEvery === 0 ? 1 : 0
        )
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
            : vibe === "awake"
              ? "lots of recent activity"
              : vibe === "stuck"
                ? "something is in the way"
                : "resting for a while",
        daysSinceCommit,
        activity: computeActivity(daysSinceCommit)
      }
    };
  });
