// Terminal focus events (xterm mode 1004).
//
// Modern terminals (iTerm2, Alacritty, Kitty, WezTerm, Ghostty, Windows
// Terminal, recent VS Code) report focus changes when mode 1004 is enabled:
//   \x1b[I  on focus gained
//   \x1b[O  on focus lost
// Older / minimal terminals just ignore the enable sequence, so opting in is
// safe to do unconditionally.
//
// We use this to recover from a macOS-specific freeze: when the terminal goes
// to another Space and back, the kernel can suspend our process mid-write —
// long enough that the DEC 2026 Synchronized Update Mode bracket we wrap
// every stdout write in (see cli-main.tsx) lands a BSU without its matching ESU.
// The terminal then sits in "buffering, not painting" mode forever. On
// focus-in we re-emit ESU defensively to release any stuck SUM state.

export type FocusEventKind = "focus-in" | "focus-out";

type FocusListener = (kind: FocusEventKind) => void;

const listeners = new Set<FocusListener>();

export const subscribeFocus = (listener: FocusListener): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const emit = (kind: FocusEventKind): void => {
  for (const listener of listeners) listener(kind);
};

// Sequences may straddle chunks (a single trailing `\x1b` or `\x1b[` is held
// until the next chunk so we don't mistake it for an Esc keypress).
let pending = "";

/**
 * Parse a stdin chunk, returning the bytes the rest of the pipeline should
 * still see (with focus sequences stripped out) and emitting focus events
 * for any `\x1b[I` / `\x1b[O` found inline. Composes cleanly with
 * `parseStdinChunk` from `./mouse` — call either order.
 */
export const parseFocusChunk = (chunk: string): string => {
  let combined = pending + chunk;
  pending = "";
  let kept = "";
  let i = 0;

  while (i < combined.length) {
    const esc = combined.indexOf("\x1b", i);
    if (esc < 0) {
      kept += combined.slice(i);
      break;
    }
    kept += combined.slice(i, esc);

    // Need at least 3 bytes (`\x1b[I` or `\x1b[O`) to decide. If we don't
    // have them yet, hold the tail for the next chunk so a real escape key
    // followed by `[I` typed slowly still parses correctly. A lone `\x1b`
    // by itself is held one chunk and then released as a plain Esc on the
    // next pass — this is the same compromise mouse.ts uses.
    if (esc + 2 >= combined.length) {
      pending = combined.slice(esc);
      break;
    }

    const seq = combined.slice(esc, esc + 3);
    if (seq === "\x1b[I") {
      emit("focus-in");
      i = esc + 3;
      continue;
    }
    if (seq === "\x1b[O") {
      emit("focus-out");
      i = esc + 3;
      continue;
    }

    // Not a focus sequence — preserve the escape byte and resume scanning
    // immediately after it. This lets a real Esc keypress (or any other
    // escape sequence we don't handle) flow through to downstream parsers.
    kept += combined[esc];
    i = esc + 1;
  }

  return kept;
};

// xterm "send focus events" mode. Enabling this on a terminal that doesn't
// support it is a no-op — the enable sequence is silently ignored.
export const ENABLE_FOCUS = "\x1b[?1004h";
export const DISABLE_FOCUS = "\x1b[?1004l";
