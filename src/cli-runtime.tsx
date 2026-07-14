import { render } from "ink";

import { Root } from "@/cli-main";
import {
  CLI_HELP_TEXT,
  hasHelpFlag,
  hasVersionFlag,
  readCurrentVersion,
} from "@/lib/cli-help";
import {
  DISABLE_FOCUS,
  ENABLE_FOCUS,
  subscribeFocus,
} from "@/lib/focus";
import { DISABLE_MOUSE, ENABLE_MOUSE } from "@/lib/mouse";
import { buildWrappedStdin } from "@/lib/wrapped-stdin";

// Switch to the alternate screen buffer + hide cursor so the garden gets a
// dedicated, scrollback-free canvas. Most terminals repaint the alt-screen
// much more smoothly during whole-frame changes.
const ENTER_ALT = "\x1b[?1049h\x1b[?25l\x1b[H";
const LEAVE_ALT = "\x1b[?25h\x1b[?1049l";

// Synchronized Update Mode (DEC 2026): bracket every stdout write so the
// terminal presents each Ink repaint atomically. Unsupported terminals ignore
// these CSI sequences.
const BSU = "\x1b[?2026h";
const ESU = "\x1b[?2026l";

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

  if (process.stdout.isTTY) {
    const originalWrite = process.stdout.write.bind(process.stdout);
    // `write` has overloads with and without an encoding; in both, callbacks
    // are forwarded after the wrapped chunk.
    process.stdout.write = ((chunk: string | Uint8Array, ...args: unknown[]) => {
      const body = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (originalWrite as any)(BSU + body + ESU, ...args);
    }) as typeof process.stdout.write;

    process.stdout.write(ENTER_ALT + ENABLE_MOUSE + ENABLE_FOCUS);
    const restore = () => {
      process.stdout.write(DISABLE_FOCUS + DISABLE_MOUSE + LEAVE_ALT);
    };

    // macOS recovery: if suspension lands between a BSU and ESU, focus-in
    // releases synchronized-update mode through the unwrapped writer.
    subscribeFocus((kind) => {
      if (kind === "focus-in") originalWrite(ESU);
    });
    process.on("exit", restore);
    process.on("SIGINT", () => {
      restore();
      process.exit(0);
    });
    process.on("SIGTERM", () => {
      restore();
      process.exit(0);
    });
    process.on("uncaughtException", (error) => {
      restore();
      console.error(error);
      process.exit(1);
    });
  }

  const stdin = process.stdin.isTTY
    ? buildWrappedStdin(process.stdin)
    : process.stdin;
  render(<Root />, { stdin });
};
