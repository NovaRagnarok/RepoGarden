export const CLI_HELP_TEXT = `RepoGarden

A local terminal habitat for your git repos.

Usage:
  repogarden
  repogarden --help

Development:
  npm run dev
  npm run build
  npm start`;

export const hasHelpFlag = (args: string[]): boolean =>
  args.includes("--help") || args.includes("-h");
