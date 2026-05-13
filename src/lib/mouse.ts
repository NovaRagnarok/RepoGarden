// Mouse support via xterm SGR mouse reporting.
//
// We enable the SGR (1006) protocol on top of standard click reporting (1000)
// in cli.tsx, parse incoming sequences here, and surface them as discrete
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

const SGR_RE = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/;

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
      // next chunk arrives. Bail out cheaply for chunks that don't contain
      // `\x1b[<` at all.
      const tailIdx = combined.lastIndexOf("\x1b[<");
      if (tailIdx >= 0 && tailIdx > combined.length - 16) {
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
