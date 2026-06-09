// ink-harness.tsx — a minimal, hand-rolled ink-testing-library equivalent.
//
// Renders real Ink trees against fake TTY streams so integration tests can
// mount actual screens (ReadyShell, WorkbenchScreen, …), drive them with
// keyboard input, and assert on the rendered frames. No new npm deps.
//
// Ink 7 stream contract (verified against node_modules/ink/build):
// - stdin: Ink checks `stdin.isTTY` (raw-mode support), calls `setEncoding`,
//   `setRawMode`, `ref`/`unref`, and consumes input by listening for
//   'readable' events and draining `stdin.read()` until it returns null
//   (components/App.js → handleReadable). A bare ESC byte is buffered by
//   Ink's input parser and auto-flushed after 20ms
//   (pendingInputFlushDelayMilliseconds), so writing "\x1b" alone is enough
//   for an escape keypress — no follow-up byte needed. (The 30ms flush timer
//   in cli-main.tsx belongs to the mouse-filtering stdin wrapper, which tests
//   bypass entirely.)
// - stdout: Ink reads `columns`/`rows`, subscribes to 'resize', and writes
//   each frame as a single chunk (erase prefix + newline-joined frame text +
//   cursor suffix). Ink keeps a per-stdout instance map, so every renderInk()
//   call uses a fresh FakeStdout and must be unmounted before the process can
//   exit cleanly.
//
// Garden caveat: GardenView's direct-stdout painter (src/garden/engine.ts)
// writes cursor-addressed cell diffs OUTSIDE Ink's renderer. It resolves its
// stream via Ink's useStdout(), so it writes to THIS fake stdout too — but
// those chunks are absolute-cursor escapes with no newlines, not full frames.
// lastFrame() therefore returns the most recent chunk that still contains a
// newline after ANSI-stripping (an Ink frame), and output() exposes the
// stripped concatenation of everything written (Ink chrome + garden canvas
// cells) for assertions on engine-painted content like room divider labels.

// Env guards must be in place before any app module evaluates — see the
// comment in test-env.ts. Keep this the first import in this file, and keep
// this harness the first import in every integration test file.
import "./test-env";

import { EventEmitter } from "node:events";
import type { ReactElement, ReactNode } from "react";
import { render } from "ink";

import { PrivacyProvider } from "../../components/privacy-context";
import { ThemeProvider } from "../../components/ui/theme-provider";
import { ToastProvider } from "../../components/ui/toast-host";

// ---------------------------------------------------------------------------
// ANSI stripping (inline strip-ansi equivalent; covers CSI sequences — SGR
// colors, cursor moves like \x1b[12;34H, save/restore \x1b[s / \x1b[u, erase
// codes — plus OSC strings terminated by BEL/ST).
// ---------------------------------------------------------------------------

const ANSI_PATTERN = new RegExp(
  [
    "[\\u001B\\u009B][[\\]()#;?]*(?:(?:(?:(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]+)*|[a-zA-Z\\d]+(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]*)*)?(?:\\u0007|\\u001B\\u005C|\\u009C))",
    "(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-nq-uy=><~]))"
  ].join("|"),
  "g"
);

export const stripAnsi = (input: string): string => input.replace(ANSI_PATTERN, "");

// ---------------------------------------------------------------------------
// Fake TTY streams
// ---------------------------------------------------------------------------

export class FakeStdin extends EventEmitter {
  readonly isTTY = true;
  private chunks: string[] = [];

  setEncoding(_encoding?: string): this {
    return this;
  }

  setRawMode(_mode: boolean): this {
    return this;
  }

  ref(): this {
    return this;
  }

  unref(): this {
    return this;
  }

  pause(): this {
    return this;
  }

  resume(): this {
    return this;
  }

  /** Ink drains input via read() in a loop until null (paused-stream style). */
  read(): string | null {
    return this.chunks.shift() ?? null;
  }

  /** Queue raw bytes as if the user typed them, and wake Ink's reader. */
  write(data: string): void {
    this.chunks.push(data);
    this.emit("readable");
  }
}

export class FakeStdout extends EventEmitter {
  readonly isTTY = true;
  columns: number;
  rows: number;
  /** Every chunk written, in order — Ink frames AND garden-engine diffs. */
  readonly frames: string[] = [];

  constructor({ columns = 100, rows = 30 }: { columns?: number; rows?: number } = {}) {
    super();
    this.columns = columns;
    this.rows = rows;
  }

  write(chunk: string | Uint8Array, ...rest: unknown[]): boolean {
    this.frames.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    // Honor the optional write callback (Ink's writeBestEffort passes one).
    const callback = rest.find((arg): arg is () => void => typeof arg === "function");
    callback?.();
    return true;
  }

  /**
   * Latest Ink-rendered frame with ANSI escapes stripped. Skips garden-engine
   * diff chunks (cursor-addressed, no newlines) so a trailing canvas repaint
   * can't shadow the actual frame. Falls back to the very last chunk when no
   * multi-line frame has been written yet.
   */
  lastFrame(): string {
    for (let i = this.frames.length - 1; i >= 0; i -= 1) {
      const stripped = stripAnsi(this.frames[i]);
      if (stripped.includes("\n")) return stripped;
    }
    return stripAnsi(this.frames.at(-1) ?? "");
  }

  /** Stripped concatenation of everything written, including engine paints. */
  output(): string {
    return stripAnsi(this.frames.join(""));
  }
}

// ---------------------------------------------------------------------------
// Key encoding
// ---------------------------------------------------------------------------

const NAMED_KEYS: Record<string, string> = {
  escape: "\x1b",
  return: "\r",
  enter: "\r",
  tab: "\t",
  backspace: "\x7f",
  delete: "\x1b[3~",
  up: "\x1b[A",
  upArrow: "\x1b[A",
  down: "\x1b[B",
  downArrow: "\x1b[B",
  right: "\x1b[C",
  rightArrow: "\x1b[C",
  left: "\x1b[D",
  leftArrow: "\x1b[D",
  pageUp: "\x1b[5~",
  pageDown: "\x1b[6~",
  home: "\x1b[H",
  end: "\x1b[F"
};

export interface PressOptions {
  ctrl?: boolean;
}

/**
 * Translate a key name / plain character (+ modifiers) into the byte sequence
 * a terminal would send.
 *
 * Ctrl chords: legacy terminal encoding only covers ctrl+letter (codes 1-26);
 * ctrl+digit chords like the workbench's ctrl+1/ctrl+2 have NO legacy byte —
 * real terminals send them via the kitty keyboard protocol's CSI-u form
 * (`ESC [ <codepoint> ; 5 u`, modifier 5 = 1+ctrl(4)). Ink's parse-keypress
 * understands CSI-u unconditionally (no protocol negotiation needed) and
 * surfaces it as `input === "2", key.ctrl === true`, which is exactly what
 * WorkbenchScreen's `key.ctrl && input === "2"` handler matches. We use the
 * CSI-u form for every ctrl chord for uniformity.
 */
export const keySequence = (key: string, options: PressOptions = {}): string => {
  if (options.ctrl) {
    const codePoint = key.codePointAt(0);
    if (key.length !== 1 || codePoint === undefined) {
      throw new Error(`ctrl chord requires a single character, got ${JSON.stringify(key)}`);
    }
    return `\x1b[${codePoint};5u`;
  }
  return NAMED_KEYS[key] ?? key;
};

// ---------------------------------------------------------------------------
// waitFor
// ---------------------------------------------------------------------------

export interface WaitForOptions {
  timeoutMs?: number;
  intervalMs?: number;
  /** Extra context appended to the timeout error (e.g. () => lastFrame()). */
  onTimeout?: () => string;
}

/** Poll `predicate` (default every 20ms) until truthy or the timeout hits. */
export const waitFor = async (
  predicate: () => boolean,
  { timeoutMs = 3_000, intervalMs = 20, onTimeout }: WaitForOptions = {}
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (predicate()) return;
    if (Date.now() >= deadline) {
      const extra = onTimeout ? `\n--- context at timeout ---\n${onTimeout()}` : "";
      throw new Error(`waitFor timed out after ${timeoutMs}ms${extra}`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
};

// ---------------------------------------------------------------------------
// renderInk / renderScreen
// ---------------------------------------------------------------------------

export interface RenderOptions {
  columns?: number;
  rows?: number;
}

export interface InkHarness {
  stdin: FakeStdin;
  stdout: FakeStdout;
  /** All chunks written to stdout (same array instance as stdout.frames). */
  frames: string[];
  /** Latest Ink frame, ANSI-stripped. */
  lastFrame: () => string;
  /** Everything written (Ink frames + garden-engine paints), ANSI-stripped. */
  output: () => string;
  /** Send a keypress: plain chars, named keys ("escape", "up", …), ctrl chords. */
  press: (key: string, options?: PressOptions) => void;
  rerender: (tree: ReactElement) => void;
  /** Idempotent; clears Ink's timers and the app's own intervals/watchers. */
  unmount: () => void;
}

/** Render a raw Ink tree against fresh fake TTY streams. */
export const renderInk = (tree: ReactElement, opts: RenderOptions = {}): InkHarness => {
  const stdout = new FakeStdout(opts);
  const stdin = new FakeStdin();
  const instance = render(tree, {
    stdout: stdout as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream,
    exitOnCtrlC: false,
    patchConsole: false,
    // Ink consults is-in-ci before stdout.isTTY: under CI=true (GitHub
    // Actions) it goes non-interactive and writes nothing until unmount,
    // so lastFrame() never sees a frame and every waitFor times out.
    // The fake streams ARE the terminal here — force interactive mode.
    interactive: true
  });

  let unmounted = false;
  return {
    stdin,
    stdout,
    frames: stdout.frames,
    lastFrame: () => stdout.lastFrame(),
    output: () => stdout.output(),
    press: (key, options) => stdin.write(keySequence(key, options)),
    rerender: instance.rerender,
    unmount: () => {
      if (unmounted) return;
      unmounted = true;
      instance.unmount();
    }
  };
};

// Same provider stack cli-main.tsx mounts around App (ThemeProvider →
// PrivacyProvider → ToastProvider). Screens consume useTheme/useMotion,
// usePrivacy, and useToasts from these; useTheme/useToasts degrade to
// defaults without a provider, but PrivacyProvider is required (usePrivacy
// throws without it) and explicit reducedMotion keeps frames deterministic
// regardless of env-read timing.
const Providers = ({ children }: { children: ReactNode }) => (
  <ThemeProvider reducedMotion={true}>
    <PrivacyProvider>
      <ToastProvider>{children}</ToastProvider>
    </PrivacyProvider>
  </ThemeProvider>
);

/** Render a screen wrapped in the same providers cli-main uses. */
export const renderScreen = (tree: ReactElement, opts: RenderOptions = {}): InkHarness => {
  const harness = renderInk(<Providers>{tree}</Providers>, opts);
  const rerender = harness.rerender;
  return {
    ...harness,
    rerender: (next: ReactElement) => rerender(<Providers>{next}</Providers>)
  };
};
