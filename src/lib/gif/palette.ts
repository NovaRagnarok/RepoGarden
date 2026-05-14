import type { PaletteIndex } from "@/lib/gif/raster";

const hexToRgb = (hex: string): [number, number, number] | null => {
  const clean = hex.trim().replace(/^#/, "");
  if (clean.length === 3) {
    const r = parseInt(clean[0] + clean[0], 16);
    const g = parseInt(clean[1] + clean[1], 16);
    const b = parseInt(clean[2] + clean[2], 16);
    return Number.isNaN(r + g + b) ? null : [r, g, b];
  }
  if (clean.length === 6) {
    const value = parseInt(clean, 16);
    if (Number.isNaN(value)) return null;
    return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
  }
  return null;
};

export interface BuiltPalette extends PaletteIndex {
  /** Flat RGB triples laid out [r,g,b, r,g,b, ...] for the encoder. */
  rgb: number[][];
  size: number;
}

// Builds a palette index that allocates entries on demand. GIF supports 256
// entries; we reserve slot 0 for transparent/background and grow from there.
// Unknown hex values fall back to the supplied fallback index.
export const createPalette = (backgroundHex: string): BuiltPalette => {
  const lookup = new Map<string, number>();
  const rgb: number[][] = [];

  const allocate = (hex: string): number => {
    const cached = lookup.get(hex);
    if (cached !== undefined) return cached;
    const triplet = hexToRgb(hex);
    if (!triplet) return 0;
    if (rgb.length >= 256) {
      // No more slots — degrade to the background. In practice we stay well
      // under 64 entries (theme colors + creature hues + branding).
      return 0;
    }
    const index = rgb.length;
    rgb.push(triplet);
    lookup.set(hex, index);
    return index;
  };

  // Slot 0 is the canvas background.
  allocate(backgroundHex);

  const palette: BuiltPalette = {
    background: 0,
    rgb,
    get size() {
      return rgb.length;
    },
    resolve(hex, fallback) {
      if (!hex) return fallback ?? 0;
      return allocate(hex);
    }
  };
  return palette;
};
