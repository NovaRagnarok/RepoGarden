import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { createGardenModel, pinForExport, stepGardenModel } from "@/garden/model";
import { renderGardenFrame } from "@/garden/render";
import type { GardenFrame, GardenSceneProps } from "@/garden/types";

import { encodeAnimatedGif, type EncodedFrame } from "@/lib/gif/encode";
import { createPalette } from "@/lib/gif/palette";
import { CELL_W, CELL_H, rasteriseFrame, renderBrandStrip, upscale } from "@/lib/gif/raster";

const BRAND_STRIP_ROWS = 1; // strip height in "cell" units (one tall cell ~16px)
const DEFAULT_FRAME_COUNT = 24; // 24 frames @ 125ms = 3s loop
const DEFAULT_FRAME_DELAY_MS = 125;
// scale 2 keeps the default GIF under ~1 MB at the full 96×28 canvas and
// reads cleanly at Twitter/Discord/Slack thumbnail sizes. Bump via `--scale`
// (3-5) for blog-post pixel-zoom, drop to 1 for the raw cell grid.
const DEFAULT_SCALE = 2;

export interface GifExportOptions {
  /** Output file path. Defaults to `~/Downloads/repogarden-<ts>.gif`. */
  out?: string;
  /** Nearest-neighbour upscale factor. Default 4 → 32px per cell. */
  scale?: number;
  /** Number of frames to capture. Default 30. */
  frames?: number;
  /** Delay between frames in ms. Default 100ms (10 fps). */
  delayMs?: number;
  /** Override the right-hand branding text. */
  brandRight?: string;
}

export interface GifExportResult {
  path: string;
  bytes: Uint8Array;
  width: number;
  height: number;
  frameCount: number;
}

const timestamp = (): string => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    d.getFullYear().toString() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    "-" +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds())
  );
};

const defaultOutputPath = (): string => {
  const dir = process.env.XDG_DOWNLOAD_DIR ?? join(homedir(), "Downloads");
  return join(dir, `repogarden-${timestamp()}.gif`);
};

const compositeCanvas = (
  main: { pixels: Uint8Array; width: number; height: number },
  brand: { pixels: Uint8Array; width: number; height: number },
  backgroundIndex: number
): { pixels: Uint8Array; width: number; height: number } => {
  if (main.width !== brand.width) {
    throw new Error("compositeCanvas: main and brand widths must match");
  }
  const width = main.width;
  const height = main.height + brand.height;
  const pixels = new Uint8Array(width * height);
  pixels.fill(backgroundIndex);
  pixels.set(main.pixels, 0);
  pixels.set(brand.pixels, main.height * width);
  return { pixels, width, height };
};

/**
 * Generate the GIF bytes for a garden scene without writing to disk. Used by
 * both the in-app keybinding and the CLI subcommand; the latter writes the
 * bytes wherever `--out` requests, the former lands them in ~/Downloads.
 */
export const encodeGardenGif = (
  sceneProps: GardenSceneProps,
  options: GifExportOptions = {}
): Omit<GifExportResult, "path"> => {
  const scale = Math.max(1, options.scale ?? DEFAULT_SCALE);
  const frameCount = Math.max(1, options.frames ?? DEFAULT_FRAME_COUNT);
  const delayMs = Math.max(20, options.delayMs ?? DEFAULT_FRAME_DELAY_MS);

  const backgroundHex = sceneProps.theme.background;
  const palette = createPalette(backgroundHex);
  // Pre-seed the palette with theme + creature hues so they get stable indices
  // across all frames (gifenc only emits a global palette from frame 0).
  palette.resolve(sceneProps.theme.foreground);
  palette.resolve(sceneProps.theme.mutedForeground);
  palette.resolve(sceneProps.theme.primary);
  palette.resolve(sceneProps.theme.accent);
  palette.resolve(sceneProps.theme.success);
  palette.resolve(sceneProps.theme.warning);
  palette.resolve(sceneProps.theme.error);
  palette.resolve(sceneProps.theme.info);

  // Drive a fresh model so the export doesn't mutate the running engine.
  // Starting at t=0 + stepping the same number of ms means the wiggle
  // animation is deterministic and the loop closes cleanly when frameCount *
  // delayMs covers an integer number of half-cycles for at least the
  // common-vibe creatures.
  const model = createGardenModel(sceneProps, 0);
  // step once first so wander states are populated, then pin them off.
  stepGardenModel(model, 0);
  pinForExport(model);

  // Pre-render all frames. We used to crop to a bounding box around the
  // creatures here, but that traded breathing room for zoom — when repos
  // span the canvas, cropping just removes the starfield padding that gives
  // the habitat its sense of space. Keep the full canvas; let the layout
  // algorithm and the canvas size be what controls spacing.
  const rawFrames: GardenFrame[] = [];
  for (let i = 0; i < frameCount; i += 1) {
    const t = i * delayMs;
    stepGardenModel(model, t);
    rawFrames.push(renderGardenFrame(model, t));
  }

  const cellW = sceneProps.innerWidth * CELL_W;
  const brandHeight = BRAND_STRIP_ROWS * CELL_H;

  const brandLeft = "★ RepoGarden";
  const brandRight = options.brandRight ?? "github.com/NovaRagnarok/RepoGarden";

  // Render the brand strip once — it's identical across frames. The strip's
  // foreground uses the theme's muted foreground so it blends with the panel
  // chrome.
  const brand = renderBrandStrip(palette, {
    width: cellW,
    height: brandHeight,
    background: palette.resolve(sceneProps.theme.background),
    foreground: palette.resolve(sceneProps.theme.mutedForeground),
    left: brandLeft,
    right: brandRight
  });
  const brandCanvas = { pixels: brand, width: cellW, height: brandHeight };

  const encoded: EncodedFrame[] = [];
  for (const frame of rawFrames) {
    const main = rasteriseFrame(frame, palette, {
      background: palette.background
    });
    const combined = compositeCanvas(main, brandCanvas, palette.background);
    const scaled = upscale(combined.pixels, combined.width, combined.height, scale);
    encoded.push({
      pixels: scaled.pixels,
      width: scaled.width,
      height: scaled.height,
      delayMs
    });
  }

  const bytes = encodeAnimatedGif(encoded, palette);
  return {
    bytes,
    width: encoded[0].width,
    height: encoded[0].height,
    frameCount
  };
};

export const exportGardenGif = async (
  sceneProps: GardenSceneProps,
  options: GifExportOptions = {}
): Promise<GifExportResult> => {
  const { bytes, width, height, frameCount } = encodeGardenGif(sceneProps, options);
  const path = options.out ?? defaultOutputPath();
  await mkdir(dirnameOf(path), { recursive: true });
  await writeFile(path, bytes);
  return { path, bytes, width, height, frameCount };
};

const dirnameOf = (path: string): string => {
  const idx = path.lastIndexOf("/");
  return idx > 0 ? path.slice(0, idx) : ".";
};
