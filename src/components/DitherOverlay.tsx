import { Box, Text } from "ink";
import { useEffect, useMemo, useState } from "react";

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
// Fraction of cells eligible to ever light up. The remainder stay dark
// for the whole transition, which keeps the wave sparse and starlike
// instead of a noise wall.
const ELIGIBLE_FRACTION = 0.22;
// Wave band width as a fraction of overlay width. Smaller = sharper
// sweep edge; larger = broader glow with longer per-cell on-time.
const BAND_FRACTION = 0.4;
const TICK_MS = 50;
// Cell shows when (waveIntensity × cellBase × twinkle) clears this.
// 0.35 lights up cells solidly near the band peak and fades them out
// cleanly toward the band edges without on/off popping.
const VISIBILITY_THRESHOLD = 0.35;

// Paints a soft star-wipe across a rectangular area. A vertical band
// sweeps left → right over `durationMs`; cells inside the band rise to
// peak brightness as the band's center passes their column, then fall
// back to dark.
//
// Each cell is seeded ONCE per transition with a deterministic glyph,
// base brightness, and twinkle phase. Per-tick rendering only computes
// the band's intensity at the cell's column and modulates it against
// the cell's stable seed — so the same star occupies the same spot
// across all ~28 ticks of the transition, fading smoothly in and out.
// The earlier implementation re-randomized every cell every tick,
// which read as flickering static rather than a sweep of stars.
//
// Cells render as Ink children rather than absolute-cursor escapes:
// one <Text> per row of the overlay area, each containing a width-W
// string of glyphs and spaces. The escape-based predecessor wrote raw
// spaces over Ink's cells, desyncing Ink's per-line diff cache and
// leaving permanent holes in the content below (manual-qa-report B1).
interface CellSeed {
  glyph: string;
  base: number;
  phase: number;
}

export const DitherOverlay = ({
  originRow,
  originCol,
  width,
  height,
  startedAt,
  durationMs
}: DitherOverlayProps) => {
  const theme = useTheme();

  // Stable per-cell seed table. Regenerates on (width × height ×
  // startedAt) — width/height changes drop us into a different cell
  // count, and a fresh startedAt means a brand new transition (so
  // consecutive cross-fades don't replay the same star pattern).
  // Stored flat (length = width × height) to avoid the cost of an
  // array-of-arrays allocation per regeneration.
  const cellField = useMemo<CellSeed[]>(() => {
    const cells = width * height;
    const field: CellSeed[] = new Array(cells);
    for (let i = 0; i < cells; i++) {
      if (Math.random() < ELIGIBLE_FRACTION) {
        field[i] = {
          glyph: GLYPHS[Math.floor(Math.random() * GLYPHS.length)] ?? "·",
          // Per-cell base brightness so stars aren't all the same
          // intensity at the band's peak — gives the wave depth.
          base: 0.7 + Math.random() * 0.3,
          phase: Math.random() * Math.PI * 2,
        };
      } else {
        field[i] = { glyph: " ", base: 0, phase: 0 };
      }
    }
    return field;
  }, [width, height, startedAt]);

  // Per-row string of length `width`, space for empty cells, glyph for lit.
  // Initial state is all-spaces so the overlay is invisible until the first
  // tick fills it in (which happens immediately on mount via the effect).
  const [rows, setRows] = useState<string[]>(() =>
    Array.from({ length: Math.max(0, height) }, () => " ".repeat(Math.max(0, width)))
  );

  useEffect(() => {
    if (width <= 0 || height <= 0) return;
    const blank = " ".repeat(width);

    const tick = () => {
      const t = (performance.now() - startedAt) / durationMs;

      if (t >= 1) {
        // Sweep complete: clear all cells. Ink will reconcile the rows back
        // to whatever the underlying tree renders once the overlay unmounts;
        // until then we render blanks so the band doesn't linger past t=1.
        setRows(prev => {
          if (prev.every(row => row === blank)) return prev;
          return Array.from({ length: height }, () => blank);
        });
        return;
      }

      // Wave band sweeps left → right. Band starts off-screen left at
      // t=0 and ends off-screen right at t=1; the +2·bandWidth padding
      // ensures the leftmost and rightmost columns also see a full
      // rise-and-fall as the wave's center crosses them.
      const bandWidth = Math.max(2, Math.floor(width * BAND_FRACTION));
      const frontX = -bandWidth + t * (width + 2 * bandWidth);
      const now = performance.now();

      const next: string[] = new Array(height);
      for (let r = 0; r < height; r++) {
        const rowOffset = r * width;
        let line = "";
        for (let c = 0; c < width; c++) {
          const cell = cellField[rowOffset + c]!;
          if (cell.base === 0) {
            line += " ";
            continue;
          }
          const dist = Math.abs(c - frontX);
          if (dist > bandWidth) {
            line += " ";
            continue;
          }
          // Quadratic falloff from the band's center column. Same shape
          // the original used — peaks at 1, drops to 0 at the band edge.
          const u = dist / bandWidth;
          const waveIntensity = 1 - u * u;
          // Subtle per-cell twinkle so stars under the wave don't look
          // mechanically uniform. 0.85–1.0 range — wider and we'd be
          // back to flicker, narrower and the wave feels flat.
          const twinkle = 0.85 + 0.15 * Math.sin(now / 110 + cell.phase);
          const visibility = waveIntensity * cell.base * twinkle;
          line += visibility > VISIBILITY_THRESHOLD ? cell.glyph : " ";
        }
        next[r] = line;
      }
      setRows(next);
    };

    tick();
    const id = setInterval(tick, TICK_MS);
    return () => {
      clearInterval(id);
    };
  }, [width, height, startedAt, durationMs, cellField]);

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
