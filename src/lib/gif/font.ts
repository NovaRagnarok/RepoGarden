import { FONT_GLYPHS, FONT_H, FONT_KERN, FONT_W } from "@/lib/gif/tamzen-bold";

export { FONT_W, FONT_H, FONT_KERN };

type Glyph = readonly number[];

export const glyphFor = (ch: string): Glyph =>
  FONT_GLYPHS[ch] ?? FONT_GLYPHS["?"];

export const measureText = (text: string): number => {
  if (text.length === 0) return 0;
  return text.length * FONT_W + Math.max(0, text.length - 1) * FONT_KERN;
};
