export const CLI_HELP_TEXT = `RepoGarden

A local terminal habitat for your git repos. (early beta)

Usage:
  repogarden            launch the TUI
  repogarden --help     show this text
  repogarden --version  print version and exit

Environment:
  REPOGARDEN_DISABLE_USAGE=1     hide the Claude/Codex usage bar this run
                                  (persistent toggle: Settings → u)
  REPOGARDEN_NO_UPDATE_CHECK=1   skip the once-a-day npm version check
  REPOGARDEN_DEMO=1              launch with demo data (for screenshots)
  NO_MOTION=1                    reduce motion where supported

Requirements:
  Node 24+, git on PATH, terminal at least 80x24

Data:
  App state lives under ~/.repogarden. Reset with: rm -rf ~/.repogarden
  RepoGarden never modifies your git repositories.

Development:
  npm run dev
  npm run build
  npm start

More: https://github.com/NovaRagnarok/RepoGarden`;

export const hasHelpFlag = (args: string[]): boolean =>
  args.includes("--help") || args.includes("-h");

export const hasVersionFlag = (args: string[]): boolean =>
  args.includes("--version") || args.includes("-v");
