import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const CLI_HELP_TEXT = `RepoGarden

A local-first terminal habitat for your git repos.

Usage:
  repogarden                              launch the TUI
  repogarden export-gif [--root P] [opts] export an animated habitat GIF
  repogarden export-text [--root P]       print a single garden frame
  repogarden --help                       show this text
  repogarden --version                    print version and exit

Export options:
  --root <path>     scan <path> instead of cwd
  --out  <file>     output file (GIF default: ~/Downloads/repogarden-<ts>.gif)
  --scale <n>       gif upscale: integer 1-5 (default: 1)
  --seconds <n>     gif loop length: 0.25-10 seconds (default: 3)
  --theme <id>      theme id (e.g. high-contrast, dracula, nord)
  --width <cols>    integer 40-320 (gif default 240, text 180)
  --height <rows>   integer 12-90 (gif default 67, text 12)
  --page <n>        page 1-1000 (1-indexed; clamps to the last available)
  --max-chars <n>   text budget: integer 1-100000
  --discord         export-text only: alias for --max-chars 1999

GIF allocation limits:
  At most 20,000,000 scaled pixels per frame and 250,000,000 per loop.
  Extreme width/height/scale/seconds combinations are rejected before scan.

Text export budgets:
  If no supported panorama fits, export-text writes no output, explains the
  smallest required budget on stderr, and exits with status 1.

Environment:
  REPOGARDEN_DISABLE_USAGE=1     hide the Claude/Codex usage bar this run
                                  (opt-in toggle: Settings → u)
  REPOGARDEN_DISABLE_OBSERVER=1  disable live git watches for this run
  REPOGARDEN_DEMO=1              launch with demo data (for screenshots)
  REPOGARDEN_REDUCED_MOTION=1    reduce motion for this run
  NO_MOTION=1                    reduce motion where supported

Requirements:
  Node 22+, git on PATH, terminal at least 80x24

Data:
  App state lives under ~/.repogarden. Reset with: rm -rf ~/.repogarden
  RepoGarden never modifies your git repositories.

Development (from source — repo uses pnpm):
  corepack enable
  pnpm install
  pnpm dev
  pnpm build

More: https://github.com/NovaRagnarok/RepoGarden`;

export const hasHelpFlag = (args: string[]): boolean =>
  args.includes("--help") || args.includes("-h");

export const hasVersionFlag = (args: string[]): boolean =>
  args.includes("--version") || args.includes("-v");

/**
 * Resolve the running package version from package.json. This module has the
 * same depth in both source (`src/lib`) and build output (`dist/lib`), so the
 * package file is always two directories above it.
 */
export const readCurrentVersion = (): string => {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkgPath = join(here, "..", "..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: unknown };
    return typeof pkg.version === "string" ? pkg.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
};
