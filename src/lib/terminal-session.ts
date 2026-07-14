import { writeSync } from "node:fs";

import {
  DISABLE_FOCUS,
  ENABLE_FOCUS,
  subscribeFocus,
  type FocusEventKind,
} from "@/lib/focus";
import { DISABLE_MOUSE, ENABLE_MOUSE } from "@/lib/mouse";

// Switch to the alternate screen buffer + hide the cursor so the habitat has
// a dedicated, scrollback-free canvas.
export const ENTER_ALT_SCREEN = "\x1b[?1049h\x1b[?25l\x1b[H";
export const LEAVE_ALT_SCREEN = "\x1b[?25h\x1b[?1049l";

// DEC synchronized-update mode brackets each Ink frame. Unsupported terminals
// ignore these sequences.
export const BEGIN_SYNCED_UPDATE = "\x1b[?2026h";
export const END_SYNCED_UPDATE = "\x1b[?2026l";

export const ENTER_TERMINAL_SESSION =
  BEGIN_SYNCED_UPDATE + ENTER_ALT_SCREEN + ENABLE_MOUSE + ENABLE_FOCUS + END_SYNCED_UPDATE;
export const LEAVE_TERMINAL_SESSION =
  END_SYNCED_UPDATE + DISABLE_FOCUS + DISABLE_MOUSE + LEAVE_ALT_SCREEN;

export type HandledTerminalSignal = "SIGHUP" | "SIGINT" | "SIGQUIT" | "SIGTERM";

export const SIGNAL_EXIT_CODES: Readonly<Record<HandledTerminalSignal, number>> = {
  SIGHUP: 129,
  SIGINT: 130,
  SIGQUIT: 131,
  SIGTERM: 143,
};

export interface TerminalSession {
  dispose: () => void;
}

export interface TerminalSessionOptions {
  runtimeProcess?: NodeJS.Process;
  stdout?: NodeJS.WriteStream;
  subscribeToFocus?: (listener: (kind: FocusEventKind) => void) => () => void;
  reportError?: (error: unknown) => void;
  /** Return true after synchronously writing all teardown bytes. */
  writeTeardownSynchronously?: (text: string) => boolean;
}

type ProcessListener = (...args: unknown[]) => void;

type SyncBufferWriter = (
  fd: number,
  buffer: Uint8Array,
  offset: number,
  length: number
) => number;

/** Write every teardown byte even when the underlying fd write is short. */
export const writeAllSynchronously = (
  fd: number,
  text: string,
  writer: SyncBufferWriter = (targetFd, buffer, offset, length) =>
    writeSync(targetFd, buffer, offset, length)
): void => {
  const buffer = Buffer.from(text, "utf8");
  let offset = 0;
  while (offset < buffer.length) {
    const remaining = buffer.length - offset;
    const written = writer(fd, buffer, offset, remaining);
    if (!Number.isInteger(written) || written <= 0 || written > remaining) {
      throw new Error("terminal teardown write returned an invalid byte count");
    }
    offset += written;
  }
};

/**
 * Enter RepoGarden's terminal modes and return an idempotent disposer.
 *
 * Cleanup deliberately bypasses the synchronized-update wrapper. This first
 * releases any update a terminal may still be buffering, then disables focus,
 * mouse, and alternate-screen modes through synchronous fd I/O when available
 * or the original writer's completion callback as a fallback.
 */
export const createTerminalSession = ({
  runtimeProcess = process,
  stdout = process.stdout,
  subscribeToFocus = subscribeFocus,
  reportError = (error) => console.error(error),
  writeTeardownSynchronously = (text) => {
    const fd = (stdout as NodeJS.WriteStream & { fd?: number }).fd;
    if (typeof fd !== "number") return false;
    writeAllSynchronously(fd, text);
    return true;
  },
}: TerminalSessionOptions = {}): TerminalSession => {
  if (!stdout.isTTY) return { dispose: () => undefined };

  const originalWrite = stdout.write;
  const directWrite = originalWrite.bind(stdout);
  const registeredListeners: Array<[string, ProcessListener]> = [];
  let disposeStarted = false;
  let disposeFinished = false;
  let requestedExitCode: number | undefined;

  const addProcessListener = (event: string, listener: ProcessListener): void => {
    try {
      runtimeProcess.on(event, listener);
      registeredListeners.push([event, listener]);
    } catch {
      // Some signals are unavailable on some platforms. Skipping an
      // unsupported listener is safer than failing normal TUI startup.
    }
  };

  stdout.write = ((chunk: string | Uint8Array, ...args: unknown[]) => {
    const body = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
    return (directWrite as (...writeArgs: unknown[]) => boolean)(
      BEGIN_SYNCED_UPDATE + body + END_SYNCED_UPDATE,
      ...args
    );
  }) as typeof stdout.write;

  let unsubscribeFocus: () => void = () => undefined;
  try {
    unsubscribeFocus = subscribeToFocus((kind) => {
      if (!disposeStarted && kind === "focus-in") directWrite(END_SYNCED_UPDATE);
    });
  } catch {
    // Input focus recovery is defensive; terminal startup and teardown must
    // remain available if subscription setup is unavailable.
  }

  const finishDispose = (): void => {
    if (disposeFinished) return;
    for (const [event, listener] of registeredListeners) {
      try {
        runtimeProcess.off(event, listener);
      } catch {
        // Continue removing the remaining listeners before completing.
      }
    }
    registeredListeners.length = 0;
    disposeFinished = true;
    if (requestedExitCode !== undefined) {
      runtimeProcess.exit(requestedExitCode);
    }
  };

  const writeTeardown = (): void => {
    try {
      if (writeTeardownSynchronously(LEAVE_TERMINAL_SESSION)) {
        finishDispose();
        return;
      }
    } catch {
      // Fall through to the original stream writer. Signal exits wait for its
      // callback so asynchronous Windows TTY writes are not truncated.
    }

    try {
      directWrite(LEAVE_TERMINAL_SESSION, () => finishDispose());
    } catch {
      finishDispose();
    }
  };

  const requestDispose = (): void => {
    if (disposeStarted) return;
    disposeStarted = true;

    try {
      unsubscribeFocus();
    } catch {
      // Continue best-effort cleanup even if a subscriber misbehaves.
    }
    try {
      stdout.write = originalWrite;
    } catch {
      // The captured writer still provides a teardown fallback below.
    }
    writeTeardown();
  };

  const dispose = (): void => requestDispose();
  const requestExit = (exitCode: number): void => {
    requestedExitCode ??= exitCode;
    if (disposeFinished) {
      runtimeProcess.exit(requestedExitCode);
      return;
    }
    requestDispose();
  };

  addProcessListener("exit", () => dispose());

  for (const [signal, exitCode] of Object.entries(SIGNAL_EXIT_CODES) as Array<
    [HandledTerminalSignal, number]
  >) {
    addProcessListener(signal, () => {
      requestExit(exitCode);
    });
  }

  addProcessListener("uncaughtException", (error) => {
    try {
      reportError(error);
    } catch {
      // Teardown and truthful failure status take precedence over reporting.
    }
    requestExit(1);
  });

  directWrite(ENTER_TERMINAL_SESSION);
  return { dispose };
};
