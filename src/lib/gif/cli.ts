import { writeFile } from "node:fs/promises";

import { scanRoots } from "@/lib/scanner";
import { enrichScans, type RepoCreature } from "@/lib/creature";
import { defaultThemeId, themeById } from "@/themes";
import { paginateCreatures, safeGardenCapacity } from "@/lib/garden-layout";
import { buildTiles } from "@/garden/model";
import type { GardenSceneProps, GardenThemeColors } from "@/garden/types";

import { exportGardenGif, planGifTiming } from "@/lib/gif/export";
import { CELL_H, CELL_W } from "@/lib/gif/raster";
import {
  fitShareableTextFrame,
  formatTextBudgetFailure,
  renderTextFrame
} from "@/lib/gif/text-export";

// GIF defaults: "0.5× zoom" — render at scale 1 with a canvas twice as
// dense as previously. 240×67 cells at 8×16 px per cell → 1920×1088 final
// (same output footprint as before) but with 4× more cells, which lets the
// placer fit ~35 creatures per page instead of 4-6.
const DEFAULT_GIF_INNER_WIDTH = 240;
const DEFAULT_GIF_CANVAS_HEIGHT = 67;
const DEFAULT_GIF_SCALE = 1;

// Text defaults: wide-short panorama. With name truncation (see
// DEFAULT_TEXT_NAME_MAX) the placer can fit a single horizontal-ish row of
// many creatures, which reads like a "messy banner" instead of the
// vertical 2-up-3-down grid the longer canvas produced.
const DEFAULT_TEXT_INNER_WIDTH = 180;
const DEFAULT_TEXT_CANVAS_HEIGHT = 12;
const DEFAULT_TEXT_NAME_MAX = 16;

export const EXPORT_CLI_LIMITS = {
  width: { min: 40, max: 320 },
  height: { min: 12, max: 90 },
  scale: { min: 1, max: 5 },
  seconds: { min: 0.25, max: 10 },
  page: { min: 1, max: 1_000 },
  maxChars: { min: 1, max: 100_000 },
  // The per-frame cap bounds the largest upscaled Uint8 canvas. The loop cap
  // bounds total raster/upscale work across every encoded frame.
  gifPixelsPerFrame: 20_000_000,
  gifPixelsPerLoop: 250_000_000
} as const;

export type ExportCommand = "gif" | "text";

export interface ParsedExportArgs {
  root?: string;
  out?: string;
  scale?: number;
  seconds?: number;
  themeId?: string;
  width?: number;
  height?: number;
  maxChars?: number;
  /** Which page (1-indexed) to render when there are more creatures than
   *  fit comfortably on a single canvas. Defaults to 1. */
  page?: number;
}

export class ExportCliArgumentError extends Error {
  override name = "ExportCliArgumentError";
}

const argumentError = (message: string): never => {
  throw new ExportCliArgumentError(message);
};

const parseNumber = (
  option: string,
  raw: string,
  limits: { min: number; max: number },
  integer: boolean
): number => {
  if (raw.trim().length === 0) {
    return argumentError(`${option} requires a value.`);
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    return argumentError(
      `${option} must be a finite number; received ${JSON.stringify(raw)}.`
    );
  }
  if (integer && !Number.isSafeInteger(value)) {
    return argumentError(
      `${option} must be a safe integer; received ${JSON.stringify(raw)}.`
    );
  }
  if (value < limits.min || value > limits.max) {
    return argumentError(
      `${option} must be between ${limits.min} and ${limits.max}; ` +
      `received ${JSON.stringify(raw)}.`
    );
  }
  return value;
};

const validateGifAllocation = (parsed: ParsedExportArgs): void => {
  const width = parsed.width ?? DEFAULT_GIF_INNER_WIDTH;
  const height = parsed.height ?? DEFAULT_GIF_CANVAS_HEIGHT;
  const scale = parsed.scale ?? DEFAULT_GIF_SCALE;
  const timing = planGifTiming(parsed.seconds ?? 3);
  const scaledWidth = width * CELL_W * scale;
  // Export adds one CELL_H-tall brand row beneath the requested canvas.
  const scaledHeight = (height + 1) * CELL_H * scale;
  const pixelsPerFrame = scaledWidth * scaledHeight;
  if (pixelsPerFrame > EXPORT_CLI_LIMITS.gifPixelsPerFrame) {
    argumentError(
      `GIF dimensions and scale produce ${pixelsPerFrame.toLocaleString("en-US")} ` +
      `pixels per frame; the limit is ` +
      `${EXPORT_CLI_LIMITS.gifPixelsPerFrame.toLocaleString("en-US")}. ` +
      `Reduce --width, --height, or --scale.`
    );
  }
  const pixelsPerLoop = pixelsPerFrame * timing.frameCount;
  if (pixelsPerLoop > EXPORT_CLI_LIMITS.gifPixelsPerLoop) {
    argumentError(
      `GIF settings render ${pixelsPerLoop.toLocaleString("en-US")} scaled ` +
      `pixels across ${timing.frameCount} frames; the loop limit is ` +
      `${EXPORT_CLI_LIMITS.gifPixelsPerLoop.toLocaleString("en-US")}. ` +
      `Reduce dimensions, --scale, or --seconds.`
    );
  }
};

export const parseExportArgs = (
  command: ExportCommand,
  rest: string[]
): ParsedExportArgs => {
  const out: ParsedExportArgs = {};
  const seen = new Set<keyof ParsedExportArgs>();

  const claim = <Key extends keyof ParsedExportArgs>(
    key: Key,
    option: string,
    value: ParsedExportArgs[Key]
  ): void => {
    if (seen.has(key)) {
      argumentError(`${option} may only be specified once.`);
    }
    seen.add(key);
    out[key] = value;
  };

  const valueAfter = (index: number, option: string, numeric: boolean): string => {
    const value = rest[index + 1];
    const looksLikeOption =
      value === undefined ||
      value.startsWith("--") ||
      value === "-o" ||
      (!numeric && value.startsWith("-"));
    if (looksLikeOption) {
      argumentError(`${option} requires a value.`);
    }
    return value;
  };

  const stringAfter = (index: number, option: string): string => {
    const value = valueAfter(index, option, false);
    if (value.trim().length === 0) {
      argumentError(`${option} requires a non-empty value.`);
    }
    return value;
  };

  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    switch (arg) {
      case "--root": {
        claim("root", arg, stringAfter(i, arg));
        i += 1;
        break;
      }
      case "--out":
      case "-o": {
        claim("out", arg, stringAfter(i, arg));
        i += 1;
        break;
      }
      case "--scale": {
        if (command !== "gif") {
          argumentError("--scale is only valid with export-gif.");
        }
        const raw = valueAfter(i, arg, true);
        claim("scale", arg, parseNumber(arg, raw, EXPORT_CLI_LIMITS.scale, true));
        i += 1;
        break;
      }
      case "--seconds": {
        if (command !== "gif") {
          argumentError("--seconds is only valid with export-gif.");
        }
        const raw = valueAfter(i, arg, true);
        claim("seconds", arg, parseNumber(arg, raw, EXPORT_CLI_LIMITS.seconds, false));
        i += 1;
        break;
      }
      case "--theme": {
        const themeId = stringAfter(i, arg);
        if (!themeById(themeId)) {
          argumentError(`--theme has unknown id ${JSON.stringify(themeId)}.`);
        }
        claim("themeId", arg, themeId);
        i += 1;
        break;
      }
      case "--width": {
        const raw = valueAfter(i, arg, true);
        claim("width", arg, parseNumber(arg, raw, EXPORT_CLI_LIMITS.width, true));
        i += 1;
        break;
      }
      case "--height": {
        const raw = valueAfter(i, arg, true);
        claim("height", arg, parseNumber(arg, raw, EXPORT_CLI_LIMITS.height, true));
        i += 1;
        break;
      }
      case "--page": {
        const raw = valueAfter(i, arg, true);
        claim("page", arg, parseNumber(arg, raw, EXPORT_CLI_LIMITS.page, true));
        i += 1;
        break;
      }
      case "--discord":
        if (command !== "text") {
          argumentError("--discord is only valid with export-text.");
        }
        // Convenience alias: 1999-char budget, sized for Discord messages.
        claim("maxChars", arg, 1999);
        break;
      case "--max-chars": {
        if (command !== "text") {
          argumentError("--max-chars is only valid with export-text.");
        }
        const raw = valueAfter(i, arg, true);
        claim(
          "maxChars",
          arg,
          parseNumber(arg, raw, EXPORT_CLI_LIMITS.maxChars, true)
        );
        i += 1;
        break;
      }
      default: {
        if (arg.startsWith("-")) {
          argumentError(`unknown export option: ${arg}.`);
        }
        if (seen.has("root")) {
          argumentError(`unexpected positional argument: ${arg}.`);
        }
        if (arg.trim().length === 0) {
          argumentError("repository root must be non-empty.");
        }
        claim("root", "repository root", arg);
        break;
      }
    }
  }
  if (command === "gif") validateGifAllocation(out);
  return out;
};

interface BuiltScene {
  scene: GardenSceneProps;
  pageIndex: number;
  pageCount: number;
}

interface BuildOptions {
  defaultWidth: number;
  defaultHeight: number;
}

interface CreatureLoaderDependencies {
  scanRoots: typeof scanRoots;
  enrichScans: typeof enrichScans;
}

const loadCreatures = (
  parsed: ParsedExportArgs,
  dependencies: CreatureLoaderDependencies = { scanRoots, enrichScans }
): RepoCreature[] => {
  const root = parsed.root ?? process.cwd();
  const result = dependencies.scanRoots([root], 4);
  // Export is a scoped read-only render, not an authoritative inventory of
  // the user's configured garden. Build creatures without touching journal
  // events or the global scan snapshot.
  const creatures = dependencies.enrichScans(result.repos, { reconcile: false });
  if (creatures.length === 0) {
    throw new Error(`no git repositories found under ${root}`);
  }
  return creatures;
};

const resolveThemeColors = (themeId: string | undefined): GardenThemeColors => {
  const choice = themeById(themeId ?? defaultThemeId);
  if (!choice) {
    throw new Error(`unknown theme: ${themeId}`);
  }
  const theme = choice.theme;
  return {
    foreground: theme.colors.foreground,
    background: theme.colors.background,
    muted: theme.colors.muted,
    mutedForeground: theme.colors.mutedForeground,
    primary: theme.colors.primary,
    accent: theme.colors.accent,
    success: theme.colors.success,
    warning: theme.colors.warning,
    error: theme.colors.error,
    info: theme.colors.info,
    creaturePalette: theme.creaturePalette
  };
};

const buildScene = (
  parsed: ParsedExportArgs,
  options: BuildOptions,
  dependencies: CreatureLoaderDependencies = { scanRoots, enrichScans }
): BuiltScene => {
  const scanned = loadCreatures(parsed, dependencies);
  // Strip saved drag positions so the export uses canonical placement.
  // A user's prior manual drag in the TUI would otherwise pull creatures
  // toward the canvas edge in the snapshot, where long labels can clip.
  const creatures = scanned.map((creature) => ({
    ...creature,
    memory: { ...creature.memory, gardenPlacement: undefined }
  }));
  const colors = resolveThemeColors(parsed.themeId);
  const innerWidth = parsed.width ?? options.defaultWidth;
  const canvasH = parsed.height ?? options.defaultHeight;

  // Use the labels-aware capacity instead of the TUI's general-purpose one so
  // long repo names can't cause edge-crop or label overlap. Building tiles up
  // front gives us the same sprite/name dims `placeCreatures` will see, so
  // capacity and placer agree slot-for-slot.
  // `pinForExport` zeroes wander radius / offsets on the model after
  // creation, so we leave `reducedMotion: false` here — wiggle (the 2-frame
  // body bob) keeps animating and the GIF reads as alive.
  const draftProps: GardenSceneProps = {
    creatures,
    focusIndex: -1,
    innerWidth,
    canvasH,
    placementMode: "organic",
    theme: colors,
    reducedMotion: false
  };
  const allTiles = buildTiles(draftProps);
  const capacity = safeGardenCapacity(allTiles, innerWidth, canvasH);
  const pages = paginateCreatures(creatures, capacity);
  const pageIndex = Math.max(0, Math.min(pages.length - 1, (parsed.page ?? 1) - 1));
  const pageCreatures = pages[pageIndex];

  return {
    scene: {
      creatures: pageCreatures,
      focusIndex: -1,
      innerWidth,
      canvasH,
      placementMode: "organic",
      theme: colors,
      reducedMotion: false
    },
    pageIndex,
    pageCount: pages.length
  };
};

export interface ExportGifCliDependencies extends CreatureLoaderDependencies {
  exportGardenGif: typeof exportGardenGif;
  writeStdout: (text: string) => void;
}

export const runExportGifCli = async (
  rest: string[],
  overrides: Partial<ExportGifCliDependencies> = {}
): Promise<number> => {
  const parsed = parseExportArgs("gif", rest);
  const dependencies: ExportGifCliDependencies = {
    scanRoots: overrides.scanRoots ?? scanRoots,
    enrichScans: overrides.enrichScans ?? enrichScans,
    exportGardenGif: overrides.exportGardenGif ?? exportGardenGif,
    writeStdout: overrides.writeStdout ?? ((text) => {
      process.stdout.write(text);
    })
  };
  const built = buildScene(
    parsed,
    {
      defaultWidth: DEFAULT_GIF_INNER_WIDTH,
      defaultHeight: DEFAULT_GIF_CANVAS_HEIGHT
    },
    dependencies
  );
  const timing = planGifTiming(parsed.seconds ?? 3);
  const result = await dependencies.exportGardenGif(built.scene, {
    out: parsed.out,
    scale: parsed.scale ?? DEFAULT_GIF_SCALE,
    frameDelaysMs: timing.frameDelaysMs
  });
  const pageNote =
    built.pageCount > 1
      ? ` (page ${built.pageIndex + 1}/${built.pageCount} — use --page to pick another)`
      : "";
  dependencies.writeStdout(`${result.path}${pageNote}\n`);
  return 0;
};

export interface ExportTextCliDependencies extends CreatureLoaderDependencies {
  writeStdout: (text: string) => void;
  writeStderr: (text: string) => void;
}

export const runExportTextCli = async (
  rest: string[],
  overrides: Partial<ExportTextCliDependencies> = {}
): Promise<number> => {
  const parsed = parseExportArgs("text", rest);
  const dependencies: ExportTextCliDependencies = {
    scanRoots: overrides.scanRoots ?? scanRoots,
    enrichScans: overrides.enrichScans ?? enrichScans,
    writeStdout: overrides.writeStdout ?? ((text) => {
      process.stdout.write(text);
    }),
    writeStderr: overrides.writeStderr ?? ((text) => {
      process.stderr.write(text);
    })
  };
  // `--discord` (or any `--max-chars` budget) implies the user is pasting
  // into a chat — wrap with fences + project-URL footer so the snippet lands
  // as a complete code block. Bare `export-text` stays raw so it pipes cleanly.
  const shareFormat = parsed.maxChars !== undefined;
  const creatures = loadCreatures(parsed, dependencies);
  const theme = resolveThemeColors(parsed.themeId);

  let text: string;
  if (parsed.maxChars !== undefined) {
    const fit = fitShareableTextFrame(creatures, {
      theme,
      maxChars: parsed.maxChars,
      nameMaxChars: DEFAULT_TEXT_NAME_MAX,
      page: parsed.page,
      shareFormat,
      startWidth: parsed.width ?? DEFAULT_TEXT_INNER_WIDTH,
      startHeight: parsed.height ?? DEFAULT_TEXT_CANVAS_HEIGHT
    });
    if (!fit.ok) {
      dependencies.writeStderr(
        `export-text: ${formatTextBudgetFailure(fit)}\n`
      );
      return 1;
    }
    text = fit.text;
  } else {
    text = renderTextFrame(creatures, {
      innerWidth: parsed.width ?? DEFAULT_TEXT_INNER_WIDTH,
      canvasH: parsed.height ?? DEFAULT_TEXT_CANVAS_HEIGHT,
      theme,
      nameMaxChars: DEFAULT_TEXT_NAME_MAX,
      page: parsed.page,
      shareFormat
    });
  }

  if (parsed.out) {
    await writeFile(parsed.out, text + "\n", "utf8");
    dependencies.writeStdout(`${parsed.out} (${text.length} chars)\n`);
  } else {
    dependencies.writeStdout(text + "\n");
  }
  return 0;
};
