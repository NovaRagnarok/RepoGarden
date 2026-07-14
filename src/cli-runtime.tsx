import { render } from "ink";

import { Root } from "@/cli-main";
import {
  CLI_HELP_TEXT,
  hasHelpFlag,
  hasVersionFlag,
  readCurrentVersion,
} from "@/lib/cli-help";
import { createTerminalSession } from "@/lib/terminal-session";
import { buildWrappedStdin } from "@/lib/wrapped-stdin";

/** Start process-level argument dispatch, terminal plumbing, and Ink. */
export const runCli = async (): Promise<void> => {
  const cliArgs = process.argv.slice(2);

  if (hasVersionFlag(cliArgs)) {
    console.log(`repogarden ${readCurrentVersion()}`);
    process.exit(0);
  }

  if (hasHelpFlag(cliArgs)) {
    console.log(CLI_HELP_TEXT);
    process.exit(0);
  }

  // Headless export subcommands never enter the TUI, so they bypass the
  // alt-screen / mouse / focus plumbing below.
  if (cliArgs[0] === "export-gif" || cliArgs[0] === "export-text") {
    const sub = cliArgs[0];
    const rest = cliArgs.slice(1);
    try {
      // Dynamic import keeps gifenc out of normal TUI startup.
      const mod = await import("@/lib/gif/cli");
      const exit = sub === "export-gif"
        ? await mod.runExportGifCli(rest)
        : await mod.runExportTextCli(rest);
      process.exit(exit);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`${sub} failed: ${message}\n`);
      process.exit(1);
    }
  }

  if (process.stdout.isTTY) createTerminalSession();

  const stdin = process.stdin.isTTY
    ? buildWrappedStdin(process.stdin)
    : process.stdin;
  render(<Root />, { stdin });
};
