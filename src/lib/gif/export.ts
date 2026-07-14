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
const DEFAULT_GIF_SECONDS = 3;
const TARGET_FRAME_DELAY_MS = 125; // 8 fps; smooth without bloating the file
// scale 2 keeps the default GIF under ~1 MB at the full 96×28 canvas and
// reads cleanly at Twitter/Discord/Slack thumbnail sizes. Bump via `--scale`
// (3-5) for blog-post pixel-zoom, drop to 1 for the raw cell grid.
const DEFAULT_SCALE = 2;

export interface GifExportOptions {
  /** Output file path. Defaults to `~/Downloads/repogarden-<ts>.gif`. */
  out?: string;
  /** Nearest-neighbour upscale factor. Default 2. */
  scale?: number;
  /** Number of frames to capture. Default 24. */
  frames?: number;
  /** Delay between frames in ms. Default timing totals 3 seconds. */
  delayMs?: number;
  /** Per-frame delays in ms. When set, its length determines frame count and
   *  it takes precedence over `frames` / `delayMs`. Values are normalized to
   *  GIF's 10ms precision. */
  frameDelaysMs?: readonly number[];
  /** Override the right-hand branding text. */
  brandRight?: string;
}

export interface GifExportResult {
  path: string;
  bytes: Uint8Array;
  width: number;
  height: number;
  frameCount: number;
  frameDelaysMs: number[];
  durationMs: number;
}

export interface GifTimingPlan {
  frameCount: number;
  frameDelaysMs: number[];
  /** Duration that will be encoded after GIF's 10ms quantization. */
  durationMs: number;
}

/**
 * Build an approximately 8 fps timing plan whose centisecond frame delays
 * sum to the requested duration. Remainder centiseconds are spread across
 * the loop, keeping adjacent delays within 10ms of one another.
 */
export const planGifTiming = (seconds: number): GifTimingPlan => {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new RangeError("GIF duration must be a positive finite number");
  }
  const durationCentiseconds = Math.round(seconds * 100);
  if (durationCentiseconds < 4) {
    throw new RangeError("GIF duration must allow two frames of at least 20ms");
  }
  let frameCount = Math.max(
    2,
    Math.round((seconds * 1000) / TARGET_FRAME_DELAY_MS)
  );
  // GIF viewers clamp sub-20ms delays. Keep every planned frame representable
  // even when this helper is called outside the range-limited CLI.
  frameCount = Math.min(frameCount, Math.floor(durationCentiseconds / 2));
  if (frameCount > 10_000) {
    throw new RangeError("GIF timing plan exceeds 10,000 frames");
  }

  const baseDelay = Math.floor(durationCentiseconds / frameCount);
  const remainder = durationCentiseconds % frameCount;
  const frameDelaysMs = Array.from({ length: frameCount }, (_, index) => {
    const extrasBefore = Math.floor((index * remainder) / frameCount);
    const extrasAfter = Math.floor(((index + 1) * remainder) / frameCount);
    return (baseDelay + extrasAfter - extrasBefore) * 10;
  });
  return {
    frameCount,
    frameDelaysMs,
    durationMs: durationCentiseconds * 10
  };
};

const normalizeDelay = (delayMs: number): number => {
  if (!Number.isFinite(delayMs) || delayMs <= 0) {
    throw new RangeError("GIF frame delays must be positive finite numbers");
  }
  return Math.max(20, Math.round(delayMs / 10) * 10);
};

const resolveFrameDelays = (options: GifExportOptions): number[] => {
  if (options.frameDelaysMs !== undefined) {
    if (options.frameDelaysMs.length === 0) {
      throw new RangeError("GIF frameDelaysMs must contain at least one delay");
    }
    return options.frameDelaysMs.map(normalizeDelay);
  }
  if (options.frames === undefined && options.delayMs === undefined) {
    return planGifTiming(DEFAULT_GIF_SECONDS).frameDelaysMs;
  }
  const frames = options.frames ?? 24;
  if (!Number.isSafeInteger(frames) || frames < 1) {
    throw new RangeError("GIF frame count must be a positive integer");
  }
  const delayMs = normalizeDelay(options.delayMs ?? TARGET_FRAME_DELAY_MS);
  return Array.from({ length: frames }, () => delayMs);
};

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
  const scale = options.scale ?? DEFAULT_SCALE;
  if (!Number.isSafeInteger(scale) || scale < 1) {
    throw new RangeError("GIF scale must be a positive integer");
  }
  const frameDelaysMs = resolveFrameDelays(options);
  const frameCount = frameDelaysMs.length;

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
  // Starting at t=0 and stepping by each encoded frame delay keeps animation
  // deterministic while honoring the timing plan used by the GIF encoder.
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
  let elapsedMs = 0;
  for (let i = 0; i < frameCount; i += 1) {
    const t = elapsedMs;
    stepGardenModel(model, t);
    rawFrames.push(renderGardenFrame(model, t));
    elapsedMs += frameDelaysMs[i] as number;
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
  for (let index = 0; index < rawFrames.length; index += 1) {
    const frame = rawFrames[index] as GardenFrame;
    const main = rasteriseFrame(frame, palette, {
      background: palette.background
    });
    const combined = compositeCanvas(main, brandCanvas, palette.background);
    const scaled = upscale(combined.pixels, combined.width, combined.height, scale);
    encoded.push({
      pixels: scaled.pixels,
      width: scaled.width,
      height: scaled.height,
      delayMs: frameDelaysMs[index] as number
    });
  }

  const bytes = encodeAnimatedGif(encoded, palette);
  return {
    bytes,
    width: encoded[0].width,
    height: encoded[0].height,
    frameCount,
    frameDelaysMs,
    durationMs: frameDelaysMs.reduce((total, delay) => total + delay, 0)
  };
};

export const exportGardenGif = async (
  sceneProps: GardenSceneProps,
  options: GifExportOptions = {}
): Promise<GifExportResult> => {
  const encoded = encodeGardenGif(sceneProps, options);
  const path = options.out ?? defaultOutputPath();
  await mkdir(dirnameOf(path), { recursive: true });
  await writeFile(path, encoded.bytes);
  return { path, ...encoded };
};

const dirnameOf = (path: string): string => {
  const idx = path.lastIndexOf("/");
  return idx > 0 ? path.slice(0, idx) : ".";
};
