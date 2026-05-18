// Mouse support via xterm SGR mouse reporting.
//
// We enable the SGR (1006) protocol on top of standard click reporting (1000)
// in cli-main.tsx, parse incoming sequences here, and surface them as discrete
// events. Mouse data is filtered out of the stdin stream Ink consumes so the
// raw escape sequences don't leak into Ink's keyboard parser (where the `<`,
// digits, `;`, and `M`/`m` chars would otherwise look like keystrokes — and
// the leading `\x1b` would fire `key.escape`, dropping the user out of filter
// mode on every click).

export type MouseEventKind = "press" | "release" | "drag" | "move" | "wheel";

export interface MouseEvent {
  kind: MouseEventKind;
  /** 1-indexed terminal column reported by the terminal. */
  col: number;
  /** 1-indexed terminal row reported by the terminal. */
  row: number;
  /** "left" | "middle" | "right" | "wheel-up" | "wheel-down" | "unknown" */
  button: "left" | "middle" | "right" | "wheel-up" | "wheel-down" | "unknown";
}

type MouseListener = (event: MouseEvent) => void;

const listeners = new Set<MouseListener>();

export const subscribeMouse = (listener: MouseListener): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const emit = (event: MouseEvent): void => {
  for (const listener of listeners) listener(event);
};

// Sequences may straddle chunk boundaries — keep a tiny pending buffer so we
// can resume parsing on the next chunk instead of dropping incomplete events.
let pending = "";

// A bare `\x1b` that lands at the tail of a chunk is held back in `pending`
// (it might be the first byte of a split SGR-mouse sequence). Without a
// follow-up that disambiguates it, the held ESC never reaches Ink — so a user
// pressing Escape alone in workbench/help/usage gets no response until they
// type another key. flushPending() releases the buffered prefix; the wrapped
// stdin in cli-main.tsx schedules it on a short timer after each chunk so a
// lone Escape resolves within ~30ms instead of never.
export const flushPending = (): string => {
  const out = pending;
  pending = "";
  return out;
};

/** True if the partial buffer currently holds bytes. */
export const hasPending = (): boolean => pending.length > 0;

const SGR_RE = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/;

// Length of a partial SGR-mouse prefix we should hold back across chunk
// boundaries. The longest reasonable in-flight prefix is `\x1b[<` plus three
// decimal fields with `;` separators but no terminator — bounded above to
// avoid pathological buffering on adversarial input.
const MAX_PARTIAL_PREFIX = 24;

/**
 * If `combined` ends with a partial SGR-mouse prefix (i.e. something that
 * could still become a complete `\x1b[<…M/m` once more bytes arrive), return
 * the byte index where that prefix begins. Otherwise return -1.
 *
 * The partial-prefix states we care about — any of which, if forwarded to
 * Ink's keyboard parser as-is, would leak a stray Esc (the leading `\x1b`):
 *   `\x1b`                       — lone escape; could be the start of a seq
 *   `\x1b[`                      — CSI introducer
 *   `\x1b[<`                     — SGR-mouse introducer
 *   `\x1b[<\d+`                  — cb only
 *   `\x1b[<\d+;\d*`              — cb + partial col
 *   `\x1b[<\d+;\d+;\d*`          — cb + col + partial row (no terminator yet)
 */
const partialMousePrefixStart = (combined: string): number => {
  // Cap the scan window so we never walk arbitrarily far back.
  const scanStart = Math.max(0, combined.length - MAX_PARTIAL_PREFIX);
  const escIdx = combined.indexOf("\x1b", scanStart);
  if (escIdx < 0) return -1;
  const tail = combined.slice(escIdx);
  // Anything strictly shorter than a complete sequence and consistent with an
  // in-flight SGR-mouse prefix gets held back. Regex describes the shape of
  // every partial that could still complete on the next chunk.
  if (/^\x1b(?:\[(?:<(?:\d+(?:;\d*(?:;\d*)?)?)?)?)?$/.test(tail)) {
    return escIdx;
  }
  return -1;
};

const decodeButton = (cb: number): MouseEvent["button"] => {
  if (cb & 64) return cb & 1 ? "wheel-down" : "wheel-up";
  const base = cb & 3;
  if (base === 0) return "left";
  if (base === 1) return "middle";
  if (base === 2) return "right";
  return "unknown";
};

const decodeKind = (cb: number, terminator: "M" | "m"): MouseEventKind => {
  if (cb & 64) return "wheel";
  if (terminator === "m") return "release";
  if (cb & 32) {
    // bit 5 = motion. With no button held (button bits = 3, "released")
    // this is pure mouse movement; otherwise it's a drag.
    return (cb & 3) === 3 ? "move" : "drag";
  }
  return "press";
};

/**
 * Parse a stdin chunk, returning the bytes Ink should still see (with mouse
 * sequences stripped out) and emitting any mouse events found inline. The
 * `pending` carryover handles sequences split across two chunks.
 */
export const parseStdinChunk = (chunk: string): string => {
  let combined = pending + chunk;
  pending = "";
  let kept = "";

  while (combined.length > 0) {
    const match = SGR_RE.exec(combined);
    if (!match) {
      // Watch for a half-finished sequence at the tail and hold it until the
      // next chunk arrives. A trailing `\x1b`, `\x1b[`, `\x1b[<`, or a partial
      // `\x1b[<…` without its `M`/`m` terminator must NOT be forwarded —
      // otherwise the leading `\x1b` leaks into Ink's keyboard parser as a
      // stray Esc keystroke (back-out + filter-clear on every mouse click
      // whose sequence happens to straddle a stdin chunk boundary).
      const tailIdx = partialMousePrefixStart(combined);
      if (tailIdx >= 0) {
        kept += combined.slice(0, tailIdx);
        pending = combined.slice(tailIdx);
      } else {
        kept += combined;
      }
      break;
    }
    kept += combined.slice(0, match.index);
    const cb = Number.parseInt(match[1], 10);
    const col = Number.parseInt(match[2], 10);
    const row = Number.parseInt(match[3], 10);
    const terminator = match[4] as "M" | "m";
    if (Number.isFinite(cb) && Number.isFinite(col) && Number.isFinite(row)) {
      emit({
        kind: decodeKind(cb, terminator),
        col,
        row,
        button: decodeButton(cb)
      });
    }
    combined = combined.slice(match.index + match[0].length);
  }

  return kept;
};

// Enable SGR mouse reporting + any-event motion (mode 1003) so we get a
// stream of "move" events for hover highlights. Yes, this is a lot of
// events on a busy terminal — the parser short-circuits on whole chunks
// without `\x1b[<` and listeners decide whether to act.
export const ENABLE_MOUSE = "\x1b[?1000h\x1b[?1003h\x1b[?1006h";
export const DISABLE_MOUSE = "\x1b[?1006l\x1b[?1003l\x1b[?1000l";
