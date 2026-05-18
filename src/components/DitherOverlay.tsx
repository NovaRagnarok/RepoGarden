import { Box, Text } from "ink";
import { useEffect, useState } from "react";

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

const GLYPHS = ["·", "⋆", "✧", "✦"];
const MAX_DENSITY = 0.12;
const BAND_FRACTION = 0.35; // wave band width as a fraction of overlay width
const TICK_MS = 50;

// Paints a sparse star-wipe across a rectangular area. A soft vertical
// band sweeps left-to-right over `durationMs`; only cells inside the band
// are candidates to twinkle, and only at MAX_DENSITY of them at any tick.
// The effect reads as "stars sweep over the box" rather than a noise wall,
// which is loud enough to mask a view swap timed near the midpoint of the
// sweep but quiet enough not to fight the underlying art.
//
// Cells are rendered as Ink children rather than absolute-cursor escapes:
// one <Text> per row of the overlay area, each containing a width-W string
// of glyphs and spaces. This costs more per tick than raw stdout writes,
// but keeps Ink in charge of the surface — when the overlay unmounts, Ink
// reconciles the cells back to whatever the underlying tree renders. The
// earlier escape-based painter would overwrite Ink's cells with raw spaces,
// desyncing Ink's per-line diff cache and leaving permanent holes in the
// content below (see manual-qa-report.md B1).
export const DitherOverlay = ({
  originRow,
  originCol,
  width,
  height,
  startedAt,
  durationMs
}: DitherOverlayProps) => {
  const theme = useTheme();
  // Per-row string of length `width`, space for empty cells, glyph for lit.
  // Initial state is all-spaces so the overlay is invisible until the first
  // tick fills it in (which happens immediately on mount via the effect).
  const [rows, setRows] = useState<string[]>(() =>
    Array.from({ length: Math.max(0, height) }, () => " ".repeat(Math.max(0, width)))
  );

  useEffect(() => {
    if (width <= 0 || height <= 0) return;
    const area = width * height;

    const tick = () => {
      const t = (performance.now() - startedAt) / durationMs;

      if (t >= 1) {
        // Sweep complete: clear all cells. Ink will reconcile the rows back
        // to whatever the underlying tree renders once the overlay unmounts;
        // until then we render blanks so the band doesn't linger past t=1.
        setRows(prev => {
          const blank = " ".repeat(width);
          if (prev.every(row => row === blank)) return prev;
          return Array.from({ length: height }, () => blank);
        });
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
      // Build the next frame as a per-row char array so we can splat
      // glyphs into the right column cheaply.
      const next: string[][] = Array.from({ length: height }, () =>
        Array.from({ length: width }, () => " ")
      );
      let placed = 0;
      let attempts = 0;
      const attemptLimit = area * 2;
      while (placed < targetCap && attempts < attemptLimit) {
        attempts += 1;
        const r = Math.floor(Math.random() * height);
        const c = Math.floor(Math.random() * width);
        if (next[r][c] !== " ") continue;
        if (Math.random() < inBand(c)) {
          next[r][c] = GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
          placed += 1;
        }
      }
      setRows(next.map(row => row.join("")));
    };

    tick();
    const id = setInterval(tick, TICK_MS);
    return () => {
      clearInterval(id);
    };
  }, [width, height, startedAt, durationMs]);

  if (width <= 0 || height <= 0) return null;

  // Position via `position="absolute"` so the overlay floats above the
  // garden/journal panel content. `originRow`/`originCol` are 1-indexed
  // absolute terminal coords (matching the old escape-sequence painter's
  // contract); Ink's absolute positioning is 0-indexed relative to the
  // parent's content box, so we subtract 1 to convert. ReadyShell mounts
  // this directly under the top-level shell Box, so the origin lines up
  // with absolute terminal coords minus 1.
  return (
    <Box
      position="absolute"
      marginTop={Math.max(0, originRow - 1)}
      marginLeft={Math.max(0, originCol - 1)}
      width={width}
      height={height}
      flexDirection="column"
    >
      {rows.map((row, index) => (
        <Text key={index} color={theme.colors.mutedForeground}>
          {row}
        </Text>
      ))}
    </Box>
  );
};
