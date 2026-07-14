import { PassThrough } from "node:stream";

import {
  flushPending as flushFocusPending,
  hasPending as hasFocusPending,
  parseFocusChunk,
} from "@/lib/focus";
import {
  flushPending as flushMousePending,
  hasPending as hasMousePending,
  parseStdinChunk,
} from "@/lib/mouse";

export interface WrappedStdinOptions {
  pendingFlushMs?: number;
}

export type WrappedStdin = NodeJS.ReadStream & {
  dispose: () => void;
  setRawMode?: (mode: boolean) => NodeJS.ReadStream;
  isTTY?: boolean;
  ref?: () => NodeJS.ReadStream;
  unref?: () => NodeJS.ReadStream;
};

/**
 * Filter terminal mouse/focus reports before Ink sees keyboard input.
 *
 * The source is injectable so the exact production chunking/flush behavior
 * can be exercised with a fake TTY. `dispose` is a no-op-safe test/runtime
 * teardown seam; the real CLI keeps the wrapper alive for the process.
 */
export const buildWrappedStdin = (
  source: NodeJS.ReadStream,
  { pendingFlushMs = 30 }: WrappedStdinOptions = {}
): WrappedStdin => {
  const wrapped = new PassThrough() as unknown as WrappedStdin;
  const sourceWithTty = source as NodeJS.ReadStream & {
    setRawMode?: (mode: boolean) => NodeJS.ReadStream;
    isTTY?: boolean;
    ref?: () => NodeJS.ReadStream;
    unref?: () => NodeJS.ReadStream;
  };

  wrapped.setRawMode = (mode: boolean) => {
    sourceWithTty.setRawMode?.(mode);
    return wrapped;
  };
  wrapped.isTTY = sourceWithTty.isTTY;
  wrapped.ref = () => {
    sourceWithTty.ref?.();
    return wrapped;
  };
  wrapped.unref = () => {
    sourceWithTty.unref?.();
    return wrapped;
  };

  let pendingFlush: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;
  const cancelPendingFlush = (): void => {
    if (pendingFlush === null) return;
    clearTimeout(pendingFlush);
    pendingFlush = null;
  };
  const schedulePendingFlush = (): void => {
    cancelPendingFlush();
    if (!hasMousePending() && !hasFocusPending()) return;
    pendingFlush = setTimeout(() => {
      pendingFlush = null;
      const out = flushMousePending() + flushFocusPending();
      if (!disposed && out.length > 0) wrapped.write(out);
    }, pendingFlushMs);
  };

  const onData = (chunk: Buffer | string): void => {
    const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
    cancelPendingFlush();
    const passthrough = parseFocusChunk(parseStdinChunk(text));
    if (passthrough.length > 0) wrapped.write(passthrough);
    schedulePendingFlush();
  };

  wrapped.dispose = () => {
    if (disposed) return;
    disposed = true;
    cancelPendingFlush();
    source.off("data", onData);
    // Reset the module-level parser buffers so one disposed fixture cannot
    // leak a partial escape prefix into the next session.
    flushMousePending();
    flushFocusPending();
    wrapped.end();
  };

  source.on("data", onData);
  source.resume();
  return wrapped;
};
