export const CLI_HELP_TEXT = `RepoGarden

A local terminal habitat for your git repos. (early beta)

Usage:
  repogarden                              launch the TUI
  repogarden export-gif [--root P] [opts] export an animated habitat GIF
  repogarden export-text [--root P]       print a single garden frame
  repogarden --help                       show this text
  repogarden --version                    print version and exit

Export options:
  --root <path>     scan <path> instead of cwd
  --out  <file>     output path (default: ~/Downloads/repogarden-<ts>.gif)
  --scale <n>       nearest-neighbour upscale (default: 1 for gif)
  --seconds <n>     gif loop length in seconds (default: 3)
  --theme <id>      theme id (e.g. high-contrast, dracula, nord)
  --width <cols>    inner garden width in cells (gif default 240, text 180)
  --height <rows>   inner garden height in cells (gif default 67, text 12)
  --page <n>        pick which page (1-indexed) when repos exceed one page
  --max-chars <n>   export-text only: shrink the canvas to fit the budget
  --discord         export-text only: alias for --max-chars 1999

Environment:
  REPOGARDEN_DISABLE_USAGE=1     hide the Claude/Codex usage bar this run
                                  (opt-in toggle: Settings → u)
  REPOGARDEN_NO_UPDATE_CHECK=1   skip the once-a-day npm version check
  REPOGARDEN_DEMO=1              launch with demo data (for screenshots)
  NO_MOTION=1                    reduce motion where supported

Requirements:
  Node 24+, git on PATH, terminal at least 80x24

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
