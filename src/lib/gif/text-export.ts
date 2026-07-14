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
  /** Page to render (1-indexed), clamped to the pages available at this
   *  width. Defaults to the first page. */
  page?: number;
  /** Wrap with `\`\`\`` fences + right-aligned project-URL footer so a single
   *  clipboard paste lands as a complete Markdown / Discord code block. */
  shareFormat?: boolean;
  /** Optionally clip every repo name at this length + `…`. Keeps slot widths
   *  small so the placer can fit a denser horizontal panorama. */
  nameMaxChars?: number;
  reducedMotion?: boolean;
}

/** Render one labels-aware-capacity page of `creatures` to text. */
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
  const pageIndex = Math.max(
    0,
    Math.min(pages.length - 1, (options.page ?? 1) - 1)
  );
  const pageCreatures = pages[pageIndex] ?? [];
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
  /** Largest canvas dimensions to consider. */
  startWidth?: number;
  startHeight?: number;
}

export const MIN_SHAREABLE_TEXT_WIDTH = 24;
const MIN_SHAREABLE_TEXT_HEIGHT = 8;

export interface ShareableTextFrameFit {
  ok: true;
  text: string;
  width: number;
  height: number;
}

export interface ShareableTextFrameFailure {
  ok: false;
  maxChars: number;
  shortestLength: number;
  shortestWidth: number;
  shortestHeight: number;
}

export type ShareableTextFrameResult =
  | ShareableTextFrameFit
  | ShareableTextFrameFailure;

const supportedDimensions = (
  options: ShareableTextOptions
): { startWidth: number; heightAt: (width: number) => number } => {
  const requestedWidth = options.startWidth ?? 180;
  const startWidth = Number.isFinite(requestedWidth)
    ? Math.max(MIN_SHAREABLE_TEXT_WIDTH, Math.floor(requestedWidth))
    : 180;
  const requestedHeight = options.startHeight ?? 12;
  const startHeight = Number.isFinite(requestedHeight)
    ? Math.max(MIN_SHAREABLE_TEXT_HEIGHT, Math.floor(requestedHeight))
    : 12;
  const ratio = startHeight / startWidth;
  return {
    startWidth,
    heightAt: (width) =>
      Math.max(MIN_SHAREABLE_TEXT_HEIGHT, Math.round(width * ratio))
  };
};

/**
 * Select the widest supported panorama that fits `maxChars`.
 *
 * Rendered length is not monotonic with width: pagination can move a creature
 * onto or off the selected page at a layout boundary. Searching from widest to
 * narrowest is exhaustive, so the first fit is correct across those jumps.
 */
export const fitShareableTextFrame = (
  creatures: RepoCreature[],
  options: ShareableTextOptions
): ShareableTextFrameResult => {
  const { startWidth, heightAt } = supportedDimensions(options);
  let shortestLength = Number.POSITIVE_INFINITY;
  let shortestWidth = startWidth;
  let shortestHeight = heightAt(startWidth);

  for (
    let width = startWidth;
    width >= MIN_SHAREABLE_TEXT_WIDTH;
    width -= 1
  ) {
    const height = heightAt(width);
    const candidate = renderTextFrame(creatures, {
      ...options,
      innerWidth: width,
      canvasH: height
    });
    if (candidate.length < shortestLength) {
      shortestLength = candidate.length;
      shortestWidth = width;
      shortestHeight = height;
    }
    if (candidate.length <= options.maxChars) {
      return { ok: true, text: candidate, width, height };
    }
  }

  return {
    ok: false,
    maxChars: options.maxChars,
    shortestLength,
    shortestWidth,
    shortestHeight
  };
};

export const formatTextBudgetFailure = (
  failure: ShareableTextFrameFailure
): string =>
  `--max-chars ${failure.maxChars} is too small; the shortest supported ` +
  `panorama is ${failure.shortestLength} chars at ${failure.shortestWidth}x` +
  `${failure.shortestHeight}. Increase --max-chars to at least ` +
  `${failure.shortestLength}.`;

/** Render the widest fitting shareable frame, or fail instead of overflowing. */
export const renderShareableTextFrame = (
  creatures: RepoCreature[],
  options: ShareableTextOptions
): string => {
  const result = fitShareableTextFrame(creatures, options);
  if (!result.ok) {
    throw new RangeError(formatTextBudgetFailure(result));
  }
  return result.text;
};
