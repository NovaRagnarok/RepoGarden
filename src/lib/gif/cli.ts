import { writeFile } from "node:fs/promises";

import { scanRoots } from "@/lib/scanner";
import { enrichScans, type RepoCreature } from "@/lib/creature";
import { defaultThemeId, themeById } from "@/themes";
import { paginateCreatures, safeGardenCapacity } from "@/lib/garden-layout";
import { buildTiles } from "@/garden/model";
import type { GardenSceneProps, GardenThemeColors } from "@/garden/types";

import { exportGardenGif } from "@/lib/gif/export";
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

interface ParsedArgs {
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

const parseArgs = (rest: string[]): ParsedArgs => {
  const out: ParsedArgs = {};
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    const next = rest[i + 1];
    switch (arg) {
      case "--root":
        out.root = next;
        i += 1;
        break;
      case "--out":
      case "-o":
        out.out = next;
        i += 1;
        break;
      case "--scale":
        out.scale = Number(next);
        i += 1;
        break;
      case "--seconds":
        out.seconds = Number(next);
        i += 1;
        break;
      case "--theme":
        out.themeId = next;
        i += 1;
        break;
      case "--width":
        out.width = Number(next);
        i += 1;
        break;
      case "--height":
        out.height = Number(next);
        i += 1;
        break;
      case "--page":
        out.page = Number(next);
        i += 1;
        break;
      case "--discord":
        // Convenience alias: 1999-char budget, sized for Discord messages.
        out.maxChars = 1999;
        break;
      case "--max-chars":
        out.maxChars = Number(next);
        i += 1;
        break;
      default:
        if (!arg.startsWith("-") && !out.root) out.root = arg;
        break;
    }
  }
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
  parsed: ParsedArgs,
  dependencies: CreatureLoaderDependencies = { scanRoots, enrichScans }
): RepoCreature[] => {
  const root = parsed.root ?? process.cwd();
  const result = dependencies.scanRoots([root], 4);
  const creatures = dependencies.enrichScans(result.repos);
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

const buildScene = (parsed: ParsedArgs, options: BuildOptions): BuiltScene => {
  const scanned = loadCreatures(parsed);
  // Strip saved drag positions so the export uses canonical placement.
  // A user's prior manual drag in the TUI would otherwise pull creatures
  // toward the canvas edge in the snapshot, where long labels can clip.
  const creatures = scanned.map((creature) => ({
    ...creature,
    memory: { ...creature.memory, gardenPlacement: undefined }
  }));
  const colors = resolveThemeColors(parsed.themeId);
  const innerWidth = Math.max(40, parsed.width ?? options.defaultWidth);
  const canvasH = Math.max(12, parsed.height ?? options.defaultHeight);

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

export const runExportGifCli = async (rest: string[]): Promise<number> => {
  const parsed = parseArgs(rest);
  const built = buildScene(parsed, {
    defaultWidth: DEFAULT_GIF_INNER_WIDTH,
    defaultHeight: DEFAULT_GIF_CANVAS_HEIGHT
  });
  const frames = parsed.seconds ? Math.max(2, Math.round(parsed.seconds * 10)) : undefined;
  const result = await exportGardenGif(built.scene, {
    out: parsed.out,
    scale: parsed.scale ?? DEFAULT_GIF_SCALE,
    frames
  });
  const pageNote =
    built.pageCount > 1
      ? ` (page ${built.pageIndex + 1}/${built.pageCount} — use --page to pick another)`
      : "";
  process.stdout.write(`${result.path}${pageNote}\n`);
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
  const parsed = parseArgs(rest);
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
    if (!Number.isSafeInteger(parsed.maxChars) || parsed.maxChars <= 0) {
      dependencies.writeStderr(
        "export-text: --max-chars must be a positive integer.\n"
      );
      return 1;
    }
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
      innerWidth: Math.max(40, parsed.width ?? DEFAULT_TEXT_INNER_WIDTH),
      canvasH: Math.max(12, parsed.height ?? DEFAULT_TEXT_CANVAS_HEIGHT),
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
