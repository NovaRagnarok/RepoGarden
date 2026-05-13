import { useStdout } from "ink";
import { useEffect, useRef } from "react";

import { useTheme } from "@/components/ui/theme-provider";

export interface DitherOverlayProps {
  /** 1-indexed absolute screen row where the overlay's top-left lives. */
  originRow: number;
  /** 1-indexed absolute screen column where the overlay's top-left lives. */
  originCol: number;
  width: number;
  height: number;
  /** performance.now() at which the dither began. */
  startedAt: number;
  durationMs: number;
}

const SAVE_CURSOR = "\x1b[s";
const RESTORE_CURSOR = "\x1b[u";
const GLYPHS = ["·", "⋆", "✧", "✦"];
const MAX_DENSITY = 0.12;
const BAND_FRACTION = 0.35; // wave band width as a fraction of overlay width
const TICK_MS = 50;

// Paints a sparse star-wipe across a rectangular area. A soft vertical
// band sweeps left-to-right over `durationMs`; only cells inside the band
// are candidates to twinkle, and only at MAX_DENSITY of them at any tick.
// The effect reads as "stars sweep over the box" rather than a noise wall,
// which is loud enough to mask a view swap timed near the midpoint of the
// sweep but quiet enough not to fight the underlying art. Cells are
// written via absolute-cursor escapes (same pipeline as the star painter)
// so the work happens between Ink renders and doesn't cost a full
// re-layout per tick. On unmount we erase every cell we currently own;
// whatever Ink renders next reclaims the surface.
export const DitherOverlay = ({
  originRow,
  originCol,
  width,
  height,
  startedAt,
  durationMs
}: DitherOverlayProps) => {
  const { stdout } = useStdout();
  const theme = useTheme();
  const paintedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!stdout) return;
    if (width <= 0 || height <= 0) return;
    const area = width * height;
    const color = theme.colors.mutedForeground;
    const colorPrefix = color ? `\x1b[38;5;${ansi256FromHex(color)}m` : "";
    const colorSuffix = color ? "\x1b[39m" : "";

    const tick = () => {
      const t = (performance.now() - startedAt) / durationMs;
      const painted = paintedRef.current;
      let out = SAVE_CURSOR;
      let wrote = false;

      if (t >= 1) {
        for (const key of painted) {
          const [r, c] = key.split(",").map(Number);
          out += `\x1b[${originRow + r};${originCol + c}H `;
          wrote = true;
        }
        paintedRef.current = new Set();
        if (wrote) {
          out += RESTORE_CURSOR;
          stdout.write(out);
        }
        return;
      }

      // Wave band sweeps left → right. Band starts off-screen left so the
      // first glow appears just after t=0, and ends off-screen right so the
      // final twinkles trail out as t→1.
      const bandWidth = Math.max(2, Math.floor(width * BAND_FRACTION));
      const frontX = -bandWidth + t * (width + 2 * bandWidth);
      const inBand = (col: number) => {
        const dist = Math.abs(col - frontX);
        if (dist > bandWidth) return 0;
        const u = dist / bandWidth;
        return Math.max(0, 1 - u * u);
      };
      // Sample cells with rejection. Each cell's lit probability is
      // density(col); we cap the total at MAX_DENSITY × area so the wipe
      // doesn't get denser than intended even when the band is wide.
      const targetCap = Math.floor(area * MAX_DENSITY);
      const next = new Set<string>();
      let attempts = 0;
      const attemptLimit = area * 2;
      while (next.size < targetCap && attempts < attemptLimit) {
        attempts += 1;
        const r = Math.floor(Math.random() * height);
        const c = Math.floor(Math.random() * width);
        if (Math.random() < inBand(c)) next.add(`${r},${c}`);
      }
      // Erase last frame's noise that isn't in this frame's noise.
      for (const key of painted) {
        if (next.has(key)) continue;
        const [r, c] = key.split(",").map(Number);
        out += `\x1b[${originRow + r};${originCol + c}H `;
        wrote = true;
      }
      // Paint this frame's noise.
      for (const key of next) {
        const [r, c] = key.split(",").map(Number);
        const glyph = GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
        out += `\x1b[${originRow + r};${originCol + c}H${colorPrefix}${glyph}${colorSuffix}`;
        wrote = true;
      }
      paintedRef.current = next;
      if (wrote) {
        out += RESTORE_CURSOR;
        stdout.write(out);
      }
    };

    tick();
    const id = setInterval(tick, TICK_MS);
    return () => {
      clearInterval(id);
      const painted = paintedRef.current;
      if (painted.size === 0) return;
      let out = SAVE_CURSOR;
      for (const key of painted) {
        const [r, c] = key.split(",").map(Number);
        out += `\x1b[${originRow + r};${originCol + c}H `;
      }
      out += RESTORE_CURSOR;
      stdout.write(out);
      paintedRef.current = new Set();
    };
  }, [stdout, originRow, originCol, width, height, startedAt, durationMs, theme.colors.mutedForeground]);

  return null;
};

// Cheap 24-bit-hex → 256-colour approximation so the noise can adopt the
// theme's muted foreground without requiring the terminal to support
// truecolour escapes. Sticks to the 6×6×6 cube + greys when the hex is
// monochrome enough.
const ansi256FromHex = (hex: string): number => {
  const trimmed = hex.startsWith("#") ? hex.slice(1) : hex;
  const parsed = trimmed.length === 6 ? parseInt(trimmed, 16) : NaN;
  if (Number.isNaN(parsed)) return 244;
  const r = (parsed >> 16) & 0xff;
  const g = (parsed >> 8) & 0xff;
  const b = parsed & 0xff;
  // Greyscale ramp 232..255 covers near-equal RGB; otherwise map into 6×6×6.
  if (Math.abs(r - g) < 8 && Math.abs(g - b) < 8) {
    const grey = Math.round(((r + g + b) / 3 - 8) / 10);
    return Math.max(232, Math.min(255, 232 + grey));
  }
  const r6 = Math.round((r / 255) * 5);
  const g6 = Math.round((g / 255) * 5);
  const b6 = Math.round((b / 255) * 5);
  return 16 + 36 * r6 + 6 * g6 + b6;
};
