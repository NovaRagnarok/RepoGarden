// gifenc ships as CJS (no "exports" or "type":"module" in its package.json),
// so Node's ESM loader can only see its `module.exports`. Pull the default
// and destructure to get GIFEncoder.
import gifenc from "gifenc";

import type { BuiltPalette } from "@/lib/gif/palette";

const { GIFEncoder } = gifenc;

export interface EncodedFrame {
  pixels: Uint8Array;
  width: number;
  height: number;
  /** Display duration in milliseconds before advancing to the next frame. */
  delayMs: number;
}

// Wraps gifenc with the bits we care about: a fixed global palette, repeat-
// forever loop, and ms-based per-frame delays (gifenc internally rounds to
// hundredths of a second — anything under 20ms gets clamped by browsers).
export const encodeAnimatedGif = (
  frames: EncodedFrame[],
  palette: BuiltPalette
): Uint8Array => {
  if (frames.length === 0) {
    throw new Error("encodeAnimatedGif: at least one frame is required");
  }
  const encoder = GIFEncoder();
  const paletteRgb = palette.rgb.length > 0 ? palette.rgb : [[0, 0, 0]];

  for (let i = 0; i < frames.length; i += 1) {
    const frame = frames[i];
    encoder.writeFrame(frame.pixels, frame.width, frame.height, {
      palette: i === 0 ? paletteRgb : undefined,
      delay: Math.max(20, frame.delayMs)
    });
  }
  encoder.finish();
  return encoder.bytes();
};
