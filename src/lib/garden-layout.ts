// Pure layout/geometry helpers for the garden scene. Lives outside
// GardenView.tsx so unit tests can exercise them without dragging in React +
// Ink. Anything stateful (the React renderer, the stdout painters, mouse
// hooks) stays in GardenView; anything that maps "creatures + canvas" → cells
// belongs here.

import type { RepoCreature } from "@/lib/creature";
import { hashString, mulberry32 } from "@/lib/sprite";
import type { Vibe } from "@/lib/vibe";

export interface SizedTile {
  creature: RepoCreature;
  index: number;
  charW: number;
  charH: number;
  spriteCols: number;
  charRows: number;
}

export interface Placement {
  tile: SizedTile;
  /** Top-left character column of the sprite area. */
  x: number;
  /** Top-left character row of the sprite area. */
  charY: number;
}

export interface PlacementFootprint {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export const NAME_H = 1;
export const SKY_ROWS = 1;
export const GROUND_ROWS = 1;
export const SLOT_PAD_X = 2;
export const SLOT_PAD_Y = 1;
/** Rows of empty space between the bottom of a creature's sprite and the
 *  start of its name row. Keeping it consistent for focused and unfocused
 *  creatures means selecting a creature doesn't reflow its label up or down. */
export const NAME_GAP_ROWS = 1;

export interface DividerPlacement {
  /** Canvas row (0-indexed within the panel canvas) where the divider line sits. */
  canvasRow: number;
  /** Vibe this divider labels — used to colour the label text. */
  vibe: Vibe;
  /** Number of creatures sitting under this divider. */
  count: number;
}

export interface ShelfLayout {
  placements: Placement[];
  dividers: DividerPlacement[];
}

/** Display order for shelf groups: liveliest at the top, sleepy at the bottom. */
export const VIBE_ORDER: readonly Vibe[] = ["happy", "noisy", "blocked", "sleepy"];

// Scene/layout seeds should depend on the creature set, not the current sort
// order. The UI re-sorts creatures as vibes change, and any order-sensitive
// seed turns those routine updates into visible scene resets.
export const stableCreatureIdsKey = (creatures: Array<{ id: string }>): string =>
  creatures
    .map((creature) => creature.id)
    .slice()
    .sort()
    .join("|");

export const creatureNameStartCol = (placement: { tile: SizedTile; x: number }): number =>
  placement.x +
  Math.floor((placement.tile.spriteCols - placement.tile.creature.scan.name.length) / 2);

export const spriteBodyFootprint = (placement: {
  tile: SizedTile;
  x: number;
  charY: number;
}): PlacementFootprint => {
  return {
    top: placement.charY,
    bottom: placement.charY + placement.tile.charRows - 1,
    left: placement.x,
    right: placement.x + placement.tile.spriteCols - 1
  };
};

export const spriteBodyFootprintsOverlap = (
  left: PlacementFootprint,
  right: PlacementFootprint
): boolean =>
  left.left <= right.right &&
  right.left <= left.right &&
  left.top <= right.bottom &&
  right.top <= left.bottom;

// Each divider takes 1 line for the label and 1 blank row of breathing space
// before the next group of creatures starts.
const DIVIDER_HEIGHT = 2;

// Shelf cells get extra breathing room on top of the shared SLOT_PAD_*
// constants the organic placer uses — soldiers shouldn't bump elbows.
const SHELF_EXTRA_PAD_X = 3;
const SHELF_EXTRA_PAD_Y = 1;

// "Soldier" layout: creatures keep their organic shape and natural size but
// march into a uniform grid. Same row → same baseline (feet aligned), uniform
// horizontal spacing, vibes broken into labelled shelves in canonical order.
export const lineUpCreatures = (
  tiles: SizedTile[],
  canvasW: number,
  canvasH: number,
  deadZone?: { width: number; height: number },
  topRightDeadZone?: { width: number; height: number }
): ShelfLayout => {
  if (tiles.length === 0) return { placements: [], dividers: [] };

  const maxSpriteW = Math.max(...tiles.map((t) => t.spriteCols));
  const maxNameW = Math.max(...tiles.map((t) => t.creature.scan.name.length));
  const maxCharH = Math.max(...tiles.map((t) => t.charH));

  const slotW =
    Math.max(maxSpriteW + 2, maxNameW) + SLOT_PAD_X + SHELF_EXTRA_PAD_X;
  const rowH = maxCharH + NAME_GAP_ROWS + NAME_H + SLOT_PAD_Y + SHELF_EXTRA_PAD_Y;

  const usableW = Math.max(slotW, canvasW - 1);
  const usableH = Math.max(rowH, canvasH - SKY_ROWS - GROUND_ROWS);
  const cols = Math.max(1, Math.floor(usableW / slotW));

  // Bucket tiles by vibe in canonical order, preserving input order inside
  // each bucket (keeps the per-vibe alphabetical sort enrichScans gave us).
  const groups = new Map<Vibe, SizedTile[]>();
  for (const v of VIBE_ORDER) groups.set(v, []);
  for (const tile of tiles) groups.get(tile.creature.vibe.vibe)?.push(tile);

  // Pass 1: walk the canonical vibe order and assign each tile a (row, col)
  // inside the grid plus the vertical offset accumulated by dividers above
  // it. The divider at the top of each group gets recorded so the renderer
  // can paint the labelled line on the correct canvas row.
  type Coord = { tile: SizedTile; row: number; col: number; extraY: number };
  type DividerPlan = { vibe: Vibe; gridRow: number; extraYBefore: number; count: number };
  const coords: Coord[] = [];
  const dividerPlans: DividerPlan[] = [];
  let r = 0;
  let c = 0;
  let extraY = 0;

  for (const vibe of VIBE_ORDER) {
    const groupTiles = groups.get(vibe) ?? [];
    // The "blocked" shelf is special: we always show its label so users can
    // glance at the screen and confirm nothing is blocking them. Other empty
    // vibes stay hidden so the formation doesn't waste rows on dead air.
    const renderEmpty = vibe === "blocked";
    if (groupTiles.length === 0 && !renderEmpty) continue;
    if (c !== 0) {
      r += 1;
      c = 0;
    }
    dividerPlans.push({
      vibe,
      gridRow: r,
      extraYBefore: extraY,
      count: groupTiles.length
    });
    extraY += DIVIDER_HEIGHT;
    for (const tile of groupTiles) {
      coords.push({ tile, row: r, col: c, extraY });
      c += 1;
      if (c >= cols) {
        c = 0;
        r += 1;
      }
    }
    // Reserve one creature row's worth of vertical space below the empty
    // blocked divider so the rest of the formation sits where it would if a
    // creature were standing here. Without this the next group's divider
    // would visually clamp onto the blocked label.
    if (groupTiles.length === 0 && renderEmpty) {
      r += 1;
    }
  }

  const totalGridW = cols * slotW;
  const gridLeft = Math.max(0, Math.floor((canvasW - totalGridW) / 2));
  // Pin the shelf to the top of the canvas instead of centring vertically:
  // the happy divider should sit just under the panel's top border so the
  // formation reads as "stacked downward from the top" rather than floating.
  const gridTop = SKY_ROWS;

  // Per-row creature count, used in pass 2 to centre partial rows inside
  // the grid width instead of leaving them left-aligned. Filled here while
  // we still have the grid coords handy.
  const rowCounts = new Map<number, number>();
  for (const coord of coords) {
    rowCounts.set(coord.row, (rowCounts.get(coord.row) ?? 0) + 1);
  }

  // Pass 2: resolve absolute positions, hopping over any slot whose bounding
  // box intersects the dead-zone (so the focus card overlay never lands on a
  // sprite). The hop is sparse — only the bottom-right corner is affected.
  const deadLeft = deadZone ? canvasW - deadZone.width : Number.POSITIVE_INFINITY;
  const deadTop = deadZone ? canvasH - deadZone.height : Number.POSITIVE_INFINITY;
  const trLeft = topRightDeadZone
    ? canvasW - topRightDeadZone.width
    : Number.POSITIVE_INFINITY;
  const trBottom = topRightDeadZone ? topRightDeadZone.height : 0;
  const effectiveRowCount = (
    origin: Coord,
    row: number,
    col: number,
    centeredRowCount: number
  ): number => (row === origin.row && col === origin.col ? centeredRowCount : cols);
  const slotClear = (row: number, col: number, extra: number, rowCount: number): boolean => {
    const rowOffset = Math.floor(((cols - rowCount) * slotW) / 2);
    const slotRight = gridLeft + rowOffset + (col + 1) * slotW;
    const slotTop = gridTop + row * rowH + extra;
    const slotBottom = gridTop + (row + 1) * rowH + extra;
    if (deadZone && slotRight > deadLeft && slotBottom > deadTop) return false;
    if (topRightDeadZone && slotRight > trLeft && slotTop < trBottom) return false;
    return true;
  };

  const placements: Placement[] = [];
  let nudgeRow = 0;
  let nudgeCol = 0;
  for (const coord of coords) {
    let row = coord.row + nudgeRow;
    let col = coord.col + nudgeCol;
    const centeredRowCount = rowCounts.get(coord.row) ?? 1;
    let hopCount = 0;
    const maxHops = Math.max(cols * (Math.max(1, Math.ceil(canvasH / Math.max(1, rowH))) + 2), cols);
    while (
      !slotClear(
        row,
        col,
        coord.extraY,
        effectiveRowCount(coord, row, col, centeredRowCount)
      ) &&
      hopCount < maxHops
    ) {
      // Push past the dead zone. Bumping the column first keeps creatures on
      // the same row when possible; if we hit the row's end, wrap to a fresh
      // row of soldiers below.
      col += 1;
      nudgeCol += 1;
      hopCount += 1;
      if (col >= cols) {
        col = 0;
        row += 1;
        nudgeRow += 1;
        nudgeCol = -coord.col; // restart this tile at column 0 on the new row
      }
    }
    // Centre the row's tiles inside the grid width: a half-empty row of two
    // creatures hangs in the middle instead of clinging to the left edge.
    const rowOffset = Math.floor(
      ((cols - effectiveRowCount(coord, row, col, centeredRowCount)) * slotW) / 2
    );
    const slotX = gridLeft + rowOffset + col * slotW;
    const slotY = gridTop + row * rowH + coord.extraY;
    const charY = slotY + (maxCharH - coord.tile.charH);
    const x = slotX + Math.floor((slotW - coord.tile.spriteCols) / 2);
    placements.push({ tile: coord.tile, x, charY });
  }

  const dividers: DividerPlacement[] = dividerPlans.map((plan) => ({
    vibe: plan.vibe,
    count: plan.count,
    canvasRow: gridTop + plan.gridRow * rowH + plan.extraYBefore
  }));

  return { placements, dividers };
};

// Per-page slot dimensions used by paginateCreatures. These intentionally
// sit a bit above the placer's hard minimums (sprite 2..5w, 2..3h) so a page
// reads as roomy rather than barely-fits — pagination's whole job is to
// uncrowd the scene, not to repack at the densest legal level.
const PAGE_SLOT_W = 10;
const PAGE_SLOT_H = 7;

const slotsBlockedByZone = (
  zoneWidth: number,
  zoneHeight: number,
  slotW: number,
  slotH: number,
  totalCols: number,
  totalRows: number
): number => {
  const dCols = Math.min(totalCols, Math.ceil(zoneWidth / slotW));
  const dRows = Math.min(totalRows, Math.ceil(zoneHeight / slotH));
  return dCols * dRows;
};

/** Mirror of the placer's "fit creatures into the canvas without overlap"
 *  capacity formula, using PAGE_SLOT_* in place of the placer's hard minimums
 *  so a page leaves room to breathe. Dead-zone discounts are conservative —
 *  any slot the zone clips gets dropped, even if a sliver remains usable. */
export const gardenPageCapacity = (
  canvasW: number,
  canvasH: number,
  deadZone?: { width: number; height: number },
  topRightDeadZone?: { width: number; height: number }
): number => {
  const usableW = Math.max(PAGE_SLOT_W, canvasW - 1);
  const usableH = Math.max(PAGE_SLOT_H, canvasH - SKY_ROWS - GROUND_ROWS);
  const cols = Math.max(1, Math.floor(usableW / PAGE_SLOT_W));
  const rows = Math.max(1, Math.floor(usableH / PAGE_SLOT_H));
  const grid = cols * rows;
  let blocked = 0;
  if (deadZone) {
    blocked += slotsBlockedByZone(deadZone.width, deadZone.height, PAGE_SLOT_W, PAGE_SLOT_H, cols, rows);
  }
  if (topRightDeadZone) {
    blocked += slotsBlockedByZone(
      topRightDeadZone.width,
      topRightDeadZone.height,
      PAGE_SLOT_W,
      PAGE_SLOT_H,
      cols,
      rows
    );
  }
  return Math.max(1, grid - blocked);
};

/** Split creatures into pages of at most `capacity` each. Empty input still
 *  yields one empty page so callers can always read `pages[0]` and
 *  `pageCount >= 1`. */
export const paginateCreatures = <T>(items: T[], capacity: number): T[][] => {
  if (items.length === 0) return [[]];
  const size = Math.max(1, capacity);
  const pages: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    pages.push(items.slice(i, i + size));
  }
  return pages;
};

export const placeCreatures = (
  tiles: SizedTile[],
  canvasW: number,
  canvasH: number,
  seedKey: string,
  deadZone?: { width: number; height: number },
  topRightDeadZone?: { width: number; height: number }
): Placement[] => {
  if (tiles.length === 0) return [];
  const rng = mulberry32(hashString(seedKey) ^ 0x9e37);
  const indexedTiles = tiles.map((tile, originalIndex) => ({ tile, originalIndex }));
  const stableTiles = indexedTiles
    .slice()
    .sort((left, right) => left.tile.creature.id.localeCompare(right.tile.creature.id));
  type LayoutSlot = { row: number; col: number; x: number; y: number; width: number; height: number };
  const footprintFitsSlot = (
    footprint: PlacementFootprint,
    slot: LayoutSlot
  ): boolean =>
    footprint.left >= slot.x &&
    footprint.right < slot.x + slot.width &&
    footprint.top >= slot.y &&
    footprint.bottom < slot.y + slot.height;
  const slotRangeForTile = (
    tile: SizedTile,
    slot: LayoutSlot
  ): { minX: number; maxX: number; minY: number; maxY: number } | null => {
    const offsets = spriteBodyFootprint({ tile, x: 0, charY: 0 });
    const minX = slot.x - offsets.left;
    const maxX = slot.x + slot.width - 1 - offsets.right;
    const minY = slot.y - offsets.top;
    const maxY = slot.y + slot.height - 1 - offsets.bottom;
    return minX <= maxX && minY <= maxY ? { minX, maxX, minY, maxY } : null;
  };
  const buildSlotCandidates = (tile: SizedTile, slot: LayoutSlot): Placement[] => {
    const range = slotRangeForTile(tile, slot);
    if (!range) return [];
    const xSpan = range.maxX - range.minX;
    const ySpan = range.maxY - range.minY;
    const jittered: Placement = {
      tile,
      x: range.minX + Math.floor(rng() * (xSpan + 1)),
      charY: range.minY + Math.floor(rng() * (ySpan + 1))
    };
    const centered: Placement = {
      tile,
      x: range.minX + Math.floor(xSpan / 2),
      charY: range.minY + Math.floor(ySpan / 2)
    };
    return jittered.x === centered.x && jittered.charY === centered.charY
      ? [jittered]
      : [jittered, centered];
  };

  // Minimum slot dimensions: fit the largest sprite body + the baseline slot
  // pad so creatures cannot overlap even after jittering within a slot.
  const maxSpriteCols = Math.max(...tiles.map((t) => t.spriteCols));
  const maxSpriteRows = Math.max(...tiles.map((t) => t.charRows));
  const minSlotW = maxSpriteCols + SLOT_PAD_X;
  const minSlotH = maxSpriteRows + SLOT_PAD_Y;

  const usableW = Math.max(minSlotW, canvasW - 1);
  const usableH = Math.max(minSlotH, canvasH - SKY_ROWS - GROUND_ROWS);
  const maxGridCols = Math.max(1, Math.floor(usableW / minSlotW));
  const maxGridRows = Math.max(1, Math.floor(usableH / minSlotH));
  const maxGridCapacity = maxGridCols * maxGridRows;

  // Start from the roomy aspect-aware row count, but keep adding rows until
  // every creature has a unique slot whenever the canvas can physically fit
  // them at the minimum safe slot size. Only reuse slots as a true last
  // resort when the terminal is too small to fit all creatures at once.
  const aspect = usableW / Math.max(1, usableH);
  const desiredRowsRaw = Math.max(1, Math.sqrt(tiles.length / Math.max(0.5, aspect)));
  let rows: number;
  let cols: number;
  if (maxGridCapacity >= tiles.length) {
    rows = Math.max(1, Math.min(maxGridRows, Math.round(desiredRowsRaw)));
    cols = Math.max(1, Math.ceil(tiles.length / rows));
    while (cols > maxGridCols && rows < maxGridRows) {
      rows += 1;
      cols = Math.max(1, Math.ceil(tiles.length / rows));
    }
  } else {
    rows = maxGridRows;
    cols = maxGridCols;
  }

  const slotW = Math.max(minSlotW, Math.floor(usableW / cols));
  const slotH = Math.max(minSlotH, Math.floor(usableH / rows));

  // Centre the slot grid inside the canvas so margins look balanced.
  const gridLeft = Math.max(0, Math.floor((canvasW - cols * slotW) / 2));
  const gridTop = SKY_ROWS + Math.max(0, Math.floor((usableH - rows * slotH) / 2));

  // Bottom-right reservation. Any slot whose bounding box intersects this
  // rectangle is dropped from the rotation so creatures never end up placed
  // under the focus card.
  const deadLeft = deadZone ? canvasW - deadZone.width : Number.POSITIVE_INFINITY;
  const deadTop = deadZone ? canvasH - deadZone.height : Number.POSITIVE_INFINITY;
  const trLeft = topRightDeadZone
    ? canvasW - topRightDeadZone.width
    : Number.POSITIVE_INFINITY;
  const trBottom = topRightDeadZone ? topRightDeadZone.height : 0;

  const slots: LayoutSlot[] = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const slotX = gridLeft + c * slotW;
      const slotY = gridTop + r * slotH;
      const slotRight = gridLeft + (c + 1) * slotW;
      const slotTop = gridTop + r * slotH;
      const slotBottom = gridTop + (r + 1) * slotH;
      if (deadZone && slotRight > deadLeft && slotBottom > deadTop) continue;
      if (topRightDeadZone && slotRight > trLeft && slotTop < trBottom) continue;
      slots.push({ row: r, col: c, x: slotX, y: slotY, width: slotW, height: slotH });
    }
  }
  // Fall back to the full slot list if the dead zone swallowed every slot.
  // Better to overlap the card than to drop creatures entirely.
  if (slots.length === 0) {
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        slots.push({
          row: r,
          col: c,
          x: gridLeft + c * slotW,
          y: gridTop + r * slotH,
          width: slotW,
          height: slotH
        });
      }
    }
  }
  for (let i = slots.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [slots[i], slots[j]] = [slots[j], slots[i]];
  }

  const placementsByIndex = new Map<number, Placement>();
  const acceptedFootprints: PlacementFootprint[] = [];
  const usedSlotIndices = new Set<number>();
  // If the grid is smaller than tiles count, repeat slots — packing will
  // overlap, but that's a graceful degradation when the canvas is tiny.
  stableTiles.forEach(({ tile, originalIndex }, i) => {
    const anchorIndex = i % slots.length;
    const freeSlotIndices: number[] = [];
    const reusedSlotIndices: number[] = [];
    for (let offset = 0; offset < slots.length; offset += 1) {
      const slotIndex = (anchorIndex + offset) % slots.length;
      if (usedSlotIndices.has(slotIndex)) reusedSlotIndices.push(slotIndex);
      else freeSlotIndices.push(slotIndex);
    }
    const slotIndicesToTry = [...freeSlotIndices, ...reusedSlotIndices];

    let resolved: Placement | null = null;
    let resolvedSlotIndex = anchorIndex;

    outer: for (const slotIndex of slotIndicesToTry) {
      const slot = slots[slotIndex];
      for (const candidate of buildSlotCandidates(tile, slot)) {
        const footprint = spriteBodyFootprint(candidate);
        if (!footprintFitsSlot(footprint, slot)) continue;
        if (acceptedFootprints.some((accepted) => spriteBodyFootprintsOverlap(footprint, accepted))) {
          continue;
        }
        resolved = candidate;
        resolvedSlotIndex = slotIndex;
        acceptedFootprints.push(footprint);
        break outer;
      }
    }

    if (!resolved) {
      const fallbackSlot = slots[anchorIndex];
      resolved =
        buildSlotCandidates(tile, fallbackSlot)[1] ??
        buildSlotCandidates(tile, fallbackSlot)[0] ?? {
          tile,
          x: fallbackSlot.x,
          charY: fallbackSlot.y
        };
      acceptedFootprints.push(spriteBodyFootprint(resolved));
    }

    usedSlotIndices.add(resolvedSlotIndex);
    placementsByIndex.set(originalIndex, resolved);
  });

  return indexedTiles.map(({ originalIndex }) => placementsByIndex.get(originalIndex) as Placement);
};

export interface FocusFrameCell {
  row: number;
  col: number;
  char: string;
  /** True for the name characters in the bottom edge — they always render
   *  bold so the name reads clearly even when the rest of the frame is in
   *  its quiet state. */
  alwaysBold: boolean;
}

export interface FocusFrameBounds {
  /** Canvas width in character columns (innerWidth in GardenView). */
  canvasW: number;
  /** Canvas height in character rows. */
  canvasH: number;
  /** Bottom-right rectangle the frame must avoid (in canvas cells). */
  deadZone?: { width: number; height: number };
}

export const computeFocusFrameCells = (
  placement: { tile: SizedTile; x: number; charY: number },
  bounds?: FocusFrameBounds
): FocusFrameCell[] => {
  const { tile, x, charY } = placement;
  const spriteCols = tile.spriteCols;
  const fullName = tile.creature.scan.name;

  // Box hugs the sprite tightly — 1 col of breathing room on each side and
  // the bottom edge lands on the empty `NAME_GAP_ROWS` row between sprite
  // and name, so the name itself (one row further down) is unaffected by
  // focus changes.
  let boxLeft = x - 1;
  let boxRight = x + spriteCols;
  const boxTop = charY - 1;
  const boxBottom = charY + tile.charRows;

  const canvasW = bounds?.canvasW ?? Number.POSITIVE_INFINITY;
  const canvasH = bounds?.canvasH ?? Number.POSITIVE_INFINITY;

  if (bounds) {
    if (boxLeft < 0) {
      const shift = -boxLeft;
      boxLeft += shift;
      boxRight += shift;
    }
    if (boxRight > bounds.canvasW - 1) {
      const shift = boxRight - (bounds.canvasW - 1);
      boxLeft -= shift;
      boxRight -= shift;
    }
    boxLeft = Math.max(0, boxLeft);
    boxRight = Math.min(bounds.canvasW - 1, boxRight);
  }

  // Truncate only when the canvas itself is too narrow to fit the full name.
  const maxNameLen = Math.max(0, Math.floor(canvasW));
  let displayName = fullName;
  if (displayName.length > maxNameLen) {
    displayName =
      maxNameLen >= 2 ? displayName.slice(0, maxNameLen - 1) + "…" : "…";
  }

  const cells: FocusFrameCell[] = [];

  // Top edge.
  for (let c = boxLeft; c <= boxRight; c += 1) {
    const ch = c === boxLeft ? "╭" : c === boxRight ? "╮" : "─";
    cells.push({ row: boxTop, col: c, char: ch, alwaysBold: false });
  }
  // Sides.
  for (let r = charY; r < boxBottom; r += 1) {
    cells.push({ row: r, col: boxLeft, char: "│", alwaysBold: false });
    cells.push({ row: r, col: boxRight, char: "│", alwaysBold: false });
  }
  // Bottom edge.
  for (let c = boxLeft; c <= boxRight; c += 1) {
    const ch = c === boxLeft ? "╰" : c === boxRight ? "╯" : "─";
    cells.push({ row: boxBottom, col: c, char: ch, alwaysBold: false });
  }

  // Name row sits one row below the box — the same row that holds the
  // unfocused name, so picking a creature doesn't shift its label.
  const nameRow = boxBottom + NAME_GAP_ROWS;
  if (displayName.length > 0 && nameRow < canvasH) {
    const boxWidth = boxRight - boxLeft + 1;
    let nameStart = boxLeft + Math.floor((boxWidth - displayName.length) / 2);
    const maxStart = Math.max(0, Math.floor(canvasW) - displayName.length);
    nameStart = Math.max(0, Math.min(maxStart, nameStart));
    for (let i = 0; i < displayName.length; i += 1) {
      const c = nameStart + i;
      if (c < 0 || c >= canvasW) continue;
      cells.push({ row: nameRow, col: c, char: displayName[i], alwaysBold: true });
    }
  }

  return cells;
};
