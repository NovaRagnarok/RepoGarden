import test from "node:test";
import assert from "node:assert/strict";

import type { GardenFrame } from "../garden/types";
import { frameToText } from "../lib/text-frame";
import { createPalette } from "../lib/gif/palette";
import { CELL_W, CELL_H, rasteriseFrame } from "../lib/gif/raster";

const makeFrame = (cells: Array<Array<{ char: string; fg?: string; transparent?: boolean }>>): GardenFrame => {
  const height = cells.length;
  const width = cells[0]?.length ?? 0;
  const flat = cells.flatMap((row) => row);
  return { width, height, cells: flat };
};

test("frameToText: emits plain UTF-8 with no escapes, trims trailing space", () => {
  const frame = makeFrame([
    [{ char: "h", fg: "#ff0000" }, { char: "i", fg: "#00ff00" }, { char: " " }],
    [{ char: " " }, { char: " " }, { char: " " }]
  ]);
  const text = frameToText(frame);
  // Trailing blank row dropped, trailing whitespace stripped, no ANSI.
  assert.equal(text, "hi");
  assert.doesNotMatch(text, /\x1b/);
});

test("frameToText: transparent cells become spaces", () => {
  const frame = makeFrame([
    [
      { char: "a", fg: "#ff0000" },
      { char: " ", transparent: true },
      { char: "b", fg: "#ff0000" }
    ]
  ]);
  const text = frameToText(frame);
  assert.equal(text, "a b");
});

test("rasteriseFrame: full-block char paints all 64 pixels of an 8x8 cell", () => {
  const frame = makeFrame([[{ char: "█", fg: "#ff8800" }]]);
  const palette = createPalette("#000000");
  const result = rasteriseFrame(frame, palette, { background: palette.background });
  assert.equal(result.width, CELL_W);
  assert.equal(result.height, CELL_H);
  const fgIndex = palette.resolve("#ff8800");
  // Every pixel must be the foreground index.
  for (let i = 0; i < result.pixels.length; i += 1) {
    assert.equal(result.pixels[i], fgIndex, `pixel ${i} should be fg`);
  }
});

test("rasteriseFrame: top-left quadrant char paints exactly that quadrant", () => {
  const frame = makeFrame([[{ char: "▘", fg: "#ffffff" }]]);
  const palette = createPalette("#000000");
  const result = rasteriseFrame(frame, palette, { background: palette.background });
  const fgIndex = palette.resolve("#ffffff");
  const halfW = CELL_W / 2;
  const halfH = CELL_H / 2;
  for (let y = 0; y < CELL_H; y += 1) {
    for (let x = 0; x < CELL_W; x += 1) {
      const inTopLeft = x < halfW && y < halfH;
      const value = result.pixels[y * CELL_W + x];
      assert.equal(value, inTopLeft ? fgIndex : palette.background);
    }
  }
});

test("rasteriseFrame: empty / transparent / blank cells stay at background", () => {
  const palette = createPalette("#000000");
  const frame = makeFrame([
    [{ char: "" }, { char: " " }, { char: " ", transparent: true }]
  ]);
  const result = rasteriseFrame(frame, palette, { background: palette.background });
  for (const px of result.pixels) {
    assert.equal(px, palette.background);
  }
});

test("createPalette: assigns stable indices, reuses on repeated lookup", () => {
  const palette = createPalette("#000000");
  const a = palette.resolve("#abcdef");
  const b = palette.resolve("#abcdef");
  const c = palette.resolve("#fedcba");
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.equal(palette.rgb[a][0], 0xab);
  assert.equal(palette.rgb[a][1], 0xcd);
  assert.equal(palette.rgb[a][2], 0xef);
});
