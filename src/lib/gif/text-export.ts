import { buildTiles, createGardenModel, pinForExport } from "@/garden/model";
import { renderGardenFrame } from "@/garden/render";
import { paginateCreatures, safeGardenCapacity } from "@/lib/garden-layout";
import { frameToText } from "@/lib/text-frame";
import type { RepoCreature } from "@/lib/creature";
import type { GardenSceneProps, GardenThemeColors } from "@/garden/types";

/** Truncate a repo name to `max` chars, appending `…` when it overflows. */
const truncateName = (name: string, max: number): string =>
  name.length <= max ? name : name.slice(0, Math.max(1, max - 1)) + "…";

const prepareCreatures = (
  creatures: RepoCreature[],
  nameMaxChars: number | undefined
): RepoCreature[] =>
  creatures.map((c) => ({
    ...c,
    scan: {
      ...c.scan,
      name: nameMaxChars ? truncateName(c.scan.name, nameMaxChars) : c.scan.name
    },
    // Strip any saved drag offset so the export uses canonical placement —
    // a past TUI drag would otherwise pull creatures toward canvas edges
    // where their labels clip.
    memory: { ...c.memory, gardenPlacement: undefined }
  }));

export interface TextFrameOptions {
  innerWidth: number;
  canvasH: number;
  theme: GardenThemeColors;
  /** Wrap with `\`\`\`` fences + right-aligned project-URL footer so a single
   *  clipboard paste lands as a complete Markdown / Discord code block. */
  shareFormat?: boolean;
  /** Optionally clip every repo name at this length + `…`. Keeps slot widths
   *  small so the placer can fit a denser horizontal panorama. */
  nameMaxChars?: number;
  reducedMotion?: boolean;
}

/** Render the first labels-aware-capacity page of `creatures` to text. */
export const renderTextFrame = (
  creatures: RepoCreature[],
  options: TextFrameOptions
): string => {
  const prepared = prepareCreatures(creatures, options.nameMaxChars);
  const draftProps: GardenSceneProps = {
    creatures: prepared,
    focusIndex: -1,
    innerWidth: options.innerWidth,
    canvasH: options.canvasH,
    placementMode: "organic",
    theme: options.theme,
    reducedMotion: options.reducedMotion ?? false
  };
  const tiles = buildTiles(draftProps);
  const capacity = safeGardenCapacity(tiles, options.innerWidth, options.canvasH);
  const pages = paginateCreatures(prepared, capacity);
  const pageCreatures = pages[0] ?? [];
  const model = createGardenModel(
    { ...draftProps, creatures: pageCreatures },
    0
  );
  pinForExport(model);
  const frame = renderGardenFrame(model, 0);
  return frameToText(frame, {
    brand: options.shareFormat,
    fenced: options.shareFormat
  });
};

export interface ShareableTextOptions extends Omit<TextFrameOptions, "innerWidth" | "canvasH"> {
  maxChars: number;
  /** Starting canvas dims for the bisect. Larger = wider panorama before
   *  the bisect shrinks to fit. */
  startWidth?: number;
  startHeight?: number;
}

/**
 * Bisect canvas dimensions until the rendered text fits `maxChars`. Always
 * returns *some* output — falls back to the smallest tested size when even
 * that overshoots (truncating mid-glyph would look worse than oversized).
 */
export const renderShareableTextFrame = (
  creatures: RepoCreature[],
  options: ShareableTextOptions
): string => {
  const startW = options.startWidth ?? 180;
  const startH = options.startHeight ?? 12;
  const ratio = startH / startW;
  let lo = 24;
  let hi = startW;
  let best = "";
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const candidate = renderTextFrame(creatures, {
      ...options,
      innerWidth: mid,
      canvasH: Math.max(8, Math.round(mid * ratio))
    });
    if (candidate.length <= options.maxChars) {
      best = candidate;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return (
    best ||
    renderTextFrame(creatures, {
      ...options,
      innerWidth: 24,
      canvasH: Math.max(8, Math.round(24 * ratio))
    })
  );
};
