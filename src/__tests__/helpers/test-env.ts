// test-env.ts — environment guards for Ink-level integration tests.
//
// This module MUST be evaluated before any app module. ESM hoists import
// declarations, so a test file cannot just set process.env at its own top —
// instead the harness imports this module first (side-effect import), and
// module evaluation order guarantees this body runs before any screen /
// lib module the harness (or the test file) pulls in afterwards.
//
// Why each guard exists:
// - REPOGARDEN_REDUCED_MOTION=1 freezes wander/dither/transition animation so
//   frames are deterministic. theme-provider reads it both at module load
//   (MotionContext default) and at render (ThemeProvider's isReducedMotion()),
//   so it has to be set before either happens. renderScreen() additionally
//   passes reducedMotion explicitly as a belt-and-braces measure.
// - REPOGARDEN_DISABLE_USAGE=1 makes useUsage()/loadAllUsage() short-circuit:
//   no credential reads, no network calls, no 120s refresh interval.
//   src/lib/usage.ts reads it lazily (per call), so module-load timing is not
//   critical there, but we set it here anyway for uniformity.
// - HOME/USERPROFILE point at a fresh temp dir so config/notes/memory/events
//   never touch the real ~/.repogarden. All persistence helpers
//   (src/lib/config.ts, notes.ts, memory.ts, events.ts) resolve their paths
//   through os.homedir() at call time — nothing caches the home dir at module
//   load — and on Linux os.homedir() reads $HOME on every call, so swapping
//   the env var here is sufficient.

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.REPOGARDEN_REDUCED_MOTION = "1";
process.env.REPOGARDEN_DISABLE_USAGE = "1";

const testHome = mkdtempSync(join(tmpdir(), "repogarden-ink-test-"));
process.env.HOME = testHome;
process.env.USERPROFILE = testHome;

/** The isolated fake home directory used for this test process. */
export const TEST_HOME = testHome;
