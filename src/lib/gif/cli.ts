import { writeFile } from "node:fs/promises";

import { scanRoots } from "@/lib/scanner";
import { enrichScans } from "@/lib/creature";
import { defaultThemeId, themeById } from "@/themes";
import { paginateCreatures, safeGardenCapacity } from "@/lib/garden-layout";
import { buildTiles, createGardenModel, pinForExport } from "@/garden/model";
import type { GardenSceneProps, GardenThemeColors } from "@/garden/types";

import { exportGardenGif } from "@/lib/gif/export";
import { frameToText } from "@/lib/text-frame";
import { renderGardenFrame } from "@/garden/render";

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
  /** When set, names longer than this are clipped to (n-1) chars + "…" so
   *  the placer can pack more creatures per row. Used by `export-text` to
   *  keep the panorama dense at the Discord paste budget. */
  nameMaxChars?: number;
}

const truncateName = (name: string, max: number): string =>
  name.length <= max ? name : name.slice(0, Math.max(1, max - 1)) + "…";

const buildScene = (parsed: ParsedArgs, options: BuildOptions): BuiltScene => {
  const root = parsed.root ?? process.cwd();
  const result = scanRoots([root], 4);
  const scanned = enrichScans(result.repos);
  if (scanned.length === 0) {
    throw new Error(`no git repositories found under ${root}`);
  }
  // Strip saved drag positions so the export uses canonical placement.
  // A user's prior manual drag in the TUI would otherwise pull creatures
  // toward the canvas edge in the snapshot, where long labels can clip.
  // Also optionally truncate names so a very long repo name doesn't bloat
  // every slot.
  const creatures = scanned.map((c) => {
    const name = options.nameMaxChars
      ? truncateName(c.scan.name, options.nameMaxChars)
      : c.scan.name;
    return {
      ...c,
      scan: { ...c.scan, name },
      memory: { ...c.memory, gardenPlacement: undefined }
    };
  });
  const choice = themeById(parsed.themeId ?? defaultThemeId);
  if (!choice) {
    throw new Error(`unknown theme: ${parsed.themeId}`);
  }
  const theme = choice.theme;
  const colors: GardenThemeColors = {
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

export const runExportTextCli = async (rest: string[]): Promise<number> => {
  const parsed = parseArgs(rest);
  // `--discord` (or any `--max-chars` budget) implies the user is pasting
  // into a chat — wrap with fences + project-URL footer so the snippet lands
  // as a complete code block. Bare `export-text` stays raw so it pipes cleanly.
  const shareFormat = parsed.maxChars !== undefined;
  const textBuildOptions: BuildOptions = {
    defaultWidth: DEFAULT_TEXT_INNER_WIDTH,
    defaultHeight: DEFAULT_TEXT_CANVAS_HEIGHT,
    nameMaxChars: DEFAULT_TEXT_NAME_MAX
  };
  const renderAt = (w: number, h: number): string => {
    const built = buildScene({ ...parsed, width: w, height: h }, textBuildOptions);
    const model = createGardenModel(built.scene, 0);
    pinForExport(model);
    const frame = renderGardenFrame(model, 0);
    return frameToText(frame, { brand: shareFormat, fenced: shareFormat });
  };

  let text: string;
  if (parsed.maxChars && parsed.maxChars > 0) {
    // Greedy bisect: start at requested (or default) dimensions, halve until
    // we fit, then expand back up. Width and height drop in proportion so
    // the aspect ratio stays close to the request.
    const startW = parsed.width ?? DEFAULT_TEXT_INNER_WIDTH;
    const startH = parsed.height ?? DEFAULT_TEXT_CANVAS_HEIGHT;
    const ratio = startH / startW;
    let lo = 24;
    let hi = startW;
    let best = "";
    // Pre-check: if the smallest size still overshoots, return it anyway —
    // truncation would corrupt mid-escape and look worse than a slightly
    // oversized frame.
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const candidate = renderAt(mid, Math.max(8, Math.round(mid * ratio)));
      if (candidate.length <= parsed.maxChars) {
        best = candidate;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    text = best || renderAt(24, Math.max(8, Math.round(24 * ratio)));
  } else {
    text = renderAt(
      parsed.width ?? DEFAULT_TEXT_INNER_WIDTH,
      parsed.height ?? DEFAULT_TEXT_CANVAS_HEIGHT
    );
  }

  if (parsed.out) {
    await writeFile(parsed.out, text + "\n", "utf8");
    process.stdout.write(`${parsed.out} (${text.length} chars)\n`);
  } else {
    process.stdout.write(text + "\n");
  }
  return 0;
};
