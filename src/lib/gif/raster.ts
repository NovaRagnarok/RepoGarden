import type { GardenFrame } from "@/garden/types";

import { FONT_H, FONT_W, FONT_KERN, glyphFor, measureText } from "@/lib/gif/font";

// Each terminal cell maps to a CELL_W × CELL_H pixel block in the GIF. The
// 8×16 cell matches the bundled Tamzen Bold bitmap font exactly (no
// padding), so each cell holds one glyph with the spacing the font was
// designed for. Using a smaller cell than the previous 10×20 lets the
// logical canvas hold ~50% more cells in the same final pixel footprint,
// which uncrowds pages when long repo names cap horizontal capacity at 2
// columns. Aspect ratio stays at 1:2, so sprite proportions are unchanged.
export const CELL_W = 8;
export const CELL_H = 16;

// Maps each quadrant character to a 2-bit mask: [tl, tr, bl, br] each as a 1.
// Pulled from src/lib/sprite.ts QUADRANT_CHARS so the two stay in lockstep.
const QUADRANT_MASK: Record<string, number> = {
  " ": 0b0000,
  "▘": 0b1000,
  "▝": 0b0100,
  "▀": 0b1100,
  "▖": 0b0010,
  "▌": 0b1010,
  "▞": 0b0110,
  "▛": 0b1110,
  "▗": 0b0001,
  "▚": 0b1001,
  "▐": 0b0101,
  "▜": 0b1101,
  "▄": 0b0011,
  "▙": 0b1011,
  "▟": 0b0111,
  "█": 0b1111
};

const HORIZONTAL_LINE = new Set(["─", "━", "═", "-", "─"]);
const VERTICAL_LINE = new Set(["│", "┃", "║", "|"]);
const HEAVY_DOT = new Set(["•", "●", "★", "✦", "✧", "✩", "✪", "✫", "*", "+", "⋆"]);
const FAINT_DOT = new Set(["·", ".", "·"]);

export interface PaletteIndex {
  /** Indexed color slot for "background" — used as fallback when a cell has no fg. */
  background: number;
  /** Resolve a hex color (#rrggbb / #rgb) to an index, allocating if new. */
  resolve: (hex: string | undefined, fallback?: number) => number;
}

const paintQuadrants = (
  pixels: Uint8Array,
  width: number,
  px: number,
  py: number,
  mask: number,
  color: number
): void => {
  const halfW = CELL_W >> 1;
  const halfH = CELL_H >> 1;
  const quadrants: Array<[number, number]> = [];
  if (mask & 0b1000) quadrants.push([0, 0]);
  if (mask & 0b0100) quadrants.push([halfW, 0]);
  if (mask & 0b0010) quadrants.push([0, halfH]);
  if (mask & 0b0001) quadrants.push([halfW, halfH]);
  for (const [ox, oy] of quadrants) {
    for (let y = 0; y < halfH; y += 1) {
      const rowStart = (py + oy + y) * width + (px + ox);
      for (let x = 0; x < halfW; x += 1) {
        pixels[rowStart + x] = color;
      }
    }
  }
};

const paintGlyph = (
  pixels: Uint8Array,
  width: number,
  px: number,
  py: number,
  ch: string,
  color: number
): void => {
  const glyph = glyphFor(ch);
  const offX = Math.max(0, (CELL_W - FONT_W) >> 1);
  const offY = Math.max(0, (CELL_H - FONT_H) >> 1);
  const drawableRows = Math.min(glyph.length, CELL_H - offY);
  for (let y = 0; y < drawableRows; y += 1) {
    const bits = glyph[y];
    if (bits === 0) continue;
    const rowStart = (py + offY + y) * width + (px + offX);
    for (let x = 0; x < FONT_W; x += 1) {
      if (bits & (1 << (FONT_W - 1 - x))) {
        pixels[rowStart + x] = color;
      }
    }
  }
};

const paintHorizontalLine = (
  pixels: Uint8Array,
  width: number,
  px: number,
  py: number,
  color: number
): void => {
  const y = py + (CELL_H >> 1);
  const rowStart = y * width + px;
  for (let x = 0; x < CELL_W; x += 1) {
    pixels[rowStart + x] = color;
  }
};

const paintVerticalLine = (
  pixels: Uint8Array,
  width: number,
  px: number,
  py: number,
  color: number
): void => {
  const x = px + (CELL_W >> 1);
  for (let y = 0; y < CELL_H; y += 1) {
    pixels[(py + y) * width + x] = color;
  }
};

const paintDot = (
  pixels: Uint8Array,
  width: number,
  px: number,
  py: number,
  color: number,
  size: number
): void => {
  const cx = px + (CELL_W >> 1);
  const cy = py + (CELL_H >> 1);
  const r = Math.max(0, size - 1);
  for (let dy = -r; dy <= r; dy += 1) {
    for (let dx = -r; dx <= r; dx += 1) {
      // Diamond-shaped fill so a "size 2" dot doesn't look like a chunky square.
      if (Math.abs(dx) + Math.abs(dy) > r) continue;
      pixels[(cy + dy) * width + (cx + dx)] = color;
    }
  }
};

export interface RasteriseOptions {
  /** Solid background color applied before painting cells. */
  background: number;
}

export const rasteriseFrame = (
  frame: GardenFrame,
  palette: PaletteIndex,
  options: RasteriseOptions
): { pixels: Uint8Array; width: number; height: number } => {
  const width = frame.width * CELL_W;
  const height = frame.height * CELL_H;
  const pixels = new Uint8Array(width * height);
  pixels.fill(options.background);

  for (let cy = 0; cy < frame.height; cy += 1) {
    for (let cx = 0; cx < frame.width; cx += 1) {
      const cell = frame.cells[cy * frame.width + cx];
      if (!cell || cell.transparent) continue;
      const ch = cell.char;
      if (!ch || ch === " ") continue;

      const fg = palette.resolve(cell.fg, options.background);
      const px = cx * CELL_W;
      const py = cy * CELL_H;

      if (ch in QUADRANT_MASK) {
        paintQuadrants(pixels, width, px, py, QUADRANT_MASK[ch], fg);
        continue;
      }
      if (HORIZONTAL_LINE.has(ch)) {
        paintHorizontalLine(pixels, width, px, py, fg);
        continue;
      }
      if (VERTICAL_LINE.has(ch)) {
        paintVerticalLine(pixels, width, px, py, fg);
        continue;
      }
      if (FAINT_DOT.has(ch)) {
        paintDot(pixels, width, px, py, fg, 1);
        continue;
      }
      if (HEAVY_DOT.has(ch)) {
        paintDot(pixels, width, px, py, fg, 2);
        continue;
      }
      // Default: try the bitmap font. Falls back to "?" inside glyphFor.
      paintGlyph(pixels, width, px, py, ch, fg);
    }
  }

  return { pixels, width, height };
};

export interface BrandStripOptions {
  width: number;
  height: number;
  background: number;
  foreground: number;
  /** Left-aligned text (RepoGarden mark). */
  left: string;
  /** Right-aligned text (project URL or repo name). */
  right: string;
}

export const renderBrandStrip = (
  palette: PaletteIndex,
  options: BrandStripOptions
): Uint8Array => {
  const pixels = new Uint8Array(options.width * options.height);
  pixels.fill(options.background);
  const yOff = Math.max(0, Math.floor((options.height - FONT_H) / 2));

  const drawText = (text: string, xStart: number): void => {
    let cursor = xStart;
    for (const ch of text) {
      const glyph = glyphFor(ch);
      const drawableRows = Math.min(glyph.length, options.height - yOff);
      for (let gy = 0; gy < drawableRows; gy += 1) {
        const bits = glyph[gy];
        if (bits === 0) continue;
        const rowStart = (yOff + gy) * options.width + cursor;
        for (let gx = 0; gx < FONT_W; gx += 1) {
          if (cursor + gx < 0 || cursor + gx >= options.width) continue;
          if (bits & (1 << (FONT_W - 1 - gx))) {
            pixels[rowStart + gx] = options.foreground;
          }
        }
      }
      cursor += FONT_W + FONT_KERN;
      if (cursor >= options.width) break;
    }
  };

  // Left margin = 1 cell (8px) of breathing room.
  drawText(options.left, CELL_W);
  const rightWidth = measureText(options.right);
  drawText(options.right, Math.max(0, options.width - CELL_W - rightWidth));

  // void the unused palette argument for now — kept in the signature so the
  // brand strip can opt into theme-aware accent colors in the future.
  void palette;

  return pixels;
};

export const upscale = (
  src: Uint8Array,
  srcW: number,
  srcH: number,
  scale: number
): { pixels: Uint8Array; width: number; height: number } => {
  if (scale <= 1) return { pixels: src, width: srcW, height: srcH };
  const width = srcW * scale;
  const height = srcH * scale;
  const out = new Uint8Array(width * height);
  for (let y = 0; y < srcH; y += 1) {
    for (let x = 0; x < srcW; x += 1) {
      const value = src[y * srcW + x];
      const dxBase = x * scale;
      for (let dy = 0; dy < scale; dy += 1) {
        const rowStart = (y * scale + dy) * width + dxBase;
        for (let dx = 0; dx < scale; dx += 1) {
          out[rowStart + dx] = value;
        }
      }
    }
  }
  return { pixels: out, width, height };
};
