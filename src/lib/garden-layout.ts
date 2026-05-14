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

export interface ShelfOverflow {
  /** Vibe whose shelf got truncated — drives the indicator's accent colour. */
  vibe: Vibe;
  /** Canvas row where the "+N more" label sits (same baseline as the
   *  truncated shelf's name row, so it reads as part of that shelf). */
  canvasRow: number;
  /** Left-most canvas column of the slot the indicator occupies. */
  canvasCol: number;
  /** Width of that slot in cells — renderers should clip the label to fit. */
  slotW: number;
  /** Count of hidden creatures (what `+N` shows). */
  hidden: number;
}

export interface ShelfLayout {
  placements: Placement[];
  dividers: DividerPlacement[];
  overflows: ShelfOverflow[];
}

/** Display order for shelf groups: liveliest at the top, sleepy at the bottom.
 *  `awake` (recent local changes) sits above `happy` (settled, in sync) so the
 *  shelf reads top-down as "most engaged → least." */
export const VIBE_ORDER: readonly Vibe[] = ["awake", "happy", "stuck", "sleepy"];

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

/**
 * Footprint that includes the rendered name label below the sprite. The
 * label is "<glyph> <space> <name>" (see `render.ts`), centred under the
 * sprite, so for long names it spans further than the sprite body. The
 * gap row between sprite and label is included in `bottom` so adjacent
 * creatures don't paint each other's labels.
 *
 * Use this for inter-creature overlap checks. Slot-fit checks should
 * keep using `spriteBodyFootprint` because slots only need to contain
 * the sprite body — the canvas reserves dedicated rows for labels at
 * the bottom (see `NAME_RESERVE` in `placeCreatures`).
 */
export const spriteFullFootprint = (placement: {
  tile: SizedTile;
  x: number;
  charY: number;
}): PlacementFootprint => {
  const body = spriteBodyFootprint(placement);
  const labelLen = placement.tile.creature.scan.name.length + 2;
  const labelStart =
    placement.x + Math.floor((placement.tile.spriteCols - labelLen) / 2);
  const labelEnd = labelStart + labelLen - 1;
  const nameRow = placement.charY + placement.tile.charRows + NAME_GAP_ROWS;
  return {
    top: body.top,
    bottom: nameRow,
    left: Math.min(body.left, labelStart),
    right: Math.max(body.right, labelEnd)
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
//
// Vertical budgets are allocated *per vibe* proportional to how many tiles
// the bucket holds. A vibe with no room for everyone keeps as many tiles as
// fit in its allotted rows and emits a `+N more` overflow indicator in its
// last slot. This stops one large bucket from blowing past the canvas and
// colliding with the next shelf's divider.
export const lineUpCreatures = (
  tiles: SizedTile[],
  canvasW: number,
  canvasH: number,
  deadZone?: { width: number; height: number },
  topRightDeadZone?: { width: number; height: number }
): ShelfLayout => {
  if (tiles.length === 0) return { placements: [], dividers: [], overflows: [] };

  const maxSpriteW = Math.max(...tiles.map((t) => t.spriteCols));
  const maxNameW = Math.max(...tiles.map((t) => t.creature.scan.name.length));
  const maxCharH = Math.max(...tiles.map((t) => t.charH));

  const slotW =
    Math.max(maxSpriteW + 2, maxNameW) + SLOT_PAD_X + SHELF_EXTRA_PAD_X;
  const rowH = maxCharH + NAME_GAP_ROWS + NAME_H + SLOT_PAD_Y + SHELF_EXTRA_PAD_Y;

  const usableW = Math.max(slotW, canvasW - 1);
  const cols = Math.max(1, Math.floor(usableW / slotW));

  const groups = new Map<Vibe, SizedTile[]>();
  for (const v of VIBE_ORDER) groups.set(v, []);
  for (const tile of tiles) groups.get(tile.creature.vibe.vibe)?.push(tile);

  // Decide which vibes get a shelf this frame: any non-empty bucket, plus the
  // blocked shelf even when empty (its "all clear" label is a glanceable
  // status signal users rely on).
  type ShelfPlan = { vibe: Vibe; tiles: SizedTile[]; naturalRows: number; budget: number };
  const shelves: ShelfPlan[] = [];
  for (const vibe of VIBE_ORDER) {
    const groupTiles = groups.get(vibe) ?? [];
    if (groupTiles.length === 0 && vibe !== "stuck") continue;
    const naturalRows = Math.max(1, Math.ceil(groupTiles.length / cols));
    shelves.push({ vibe, tiles: groupTiles, naturalRows, budget: naturalRows });
  }

  // Vertical budget: total canvas rows minus sky/ground/divider chrome,
  // divided by rowH. Each shelf needs at least 1 row, so under extreme
  // squeeze we accept overflowing the canvas by clamping to a 1-row min.
  const dividerSpace = shelves.length * DIVIDER_HEIGHT;
  const availableRows = Math.max(
    shelves.length,
    Math.floor((canvasH - SKY_ROWS - GROUND_ROWS - dividerSpace) / Math.max(1, rowH))
  );

  // Trim from the largest budget until totals fit. Iterative greedy trim is
  // fine here (at most 4 shelves), and it preserves the "minimum 1 row per
  // shelf" invariant.
  let totalBudget = shelves.reduce((sum, shelf) => sum + shelf.budget, 0);
  while (totalBudget > availableRows) {
    let victim = -1;
    let maxBudget = 1;
    for (let i = 0; i < shelves.length; i += 1) {
      if (shelves[i].budget > maxBudget) {
        maxBudget = shelves[i].budget;
        victim = i;
      }
    }
    if (victim === -1) break;
    shelves[victim].budget -= 1;
    totalBudget -= 1;
  }

  const totalGridW = cols * slotW;
  const gridLeft = Math.max(0, Math.floor((canvasW - totalGridW) / 2));
  const gridTop = SKY_ROWS;

  const deadLeft = deadZone ? canvasW - deadZone.width : Number.POSITIVE_INFINITY;
  const deadTop = deadZone ? canvasH - deadZone.height : Number.POSITIVE_INFINITY;
  const trLeft = topRightDeadZone
    ? canvasW - topRightDeadZone.width
    : Number.POSITIVE_INFINITY;
  const trBottom = topRightDeadZone ? topRightDeadZone.height : 0;
  const slotIntersectsDeadZone = (slotX: number, slotY: number): boolean => {
    const slotRight = slotX + slotW;
    const slotBottom = slotY + rowH;
    if (deadZone && slotRight > deadLeft && slotBottom > deadTop) return true;
    if (topRightDeadZone && slotRight > trLeft && slotY < trBottom) return true;
    return false;
  };

  const placements: Placement[] = [];
  const dividers: DividerPlacement[] = [];
  const overflows: ShelfOverflow[] = [];

  let cursorY = gridTop;
  for (const shelf of shelves) {
    dividers.push({
      vibe: shelf.vibe,
      count: shelf.tiles.length,
      canvasRow: cursorY
    });
    const shelfTop = cursorY + DIVIDER_HEIGHT;
    const shelfRowSpan = shelf.budget;
    const slotCapacity = shelfRowSpan * cols;
    const willOverflow = shelf.tiles.length > slotCapacity;
    // Reserve the last slot for the "+N more" indicator when truncating —
    // otherwise the indicator would push another tile out of view.
    const tilesShown = willOverflow ? Math.max(0, slotCapacity - 1) : shelf.tiles.length;
    const overflowRow = willOverflow ? Math.floor(tilesShown / cols) : -1;
    const overflowCol = willOverflow ? tilesShown % cols : -1;

    // Per-row occupant count (including the overflow indicator if it lives
    // in this shelf) so we know how to centre partial rows.
    const rowCounts: number[] = [];
    for (let row = 0; row < shelfRowSpan; row += 1) {
      const start = row * cols;
      const end = Math.min(tilesShown, start + cols);
      let count = Math.max(0, end - start);
      if (willOverflow && row === overflowRow) count += 1;
      rowCounts.push(count);
    }

    // Pre-compute each row's left offset. We centre by default; if centring
    // would push the row's right edge into the focus-card dead zone, we
    // drop to left-aligned for that row. Centring back into the dead zone
    // is the only way an empty bucket lands on the overlay, so this kills
    // the regression where a one-tile happy shelf clipped the focus card.
    const rowOffsets: number[] = [];
    for (let row = 0; row < shelfRowSpan; row += 1) {
      const occupants = Math.max(1, rowCounts[row]);
      let rowOffset = Math.floor(((cols - occupants) * slotW) / 2);
      if (rowOffset > 0) {
        const slotY = shelfTop + row * rowH;
        const slotBottom = slotY + rowH;
        const centeredRight = gridLeft + rowOffset + occupants * slotW;
        const hitsBottomRight =
          deadZone !== undefined && slotBottom > deadTop && centeredRight > deadLeft;
        const hitsTopRight =
          topRightDeadZone !== undefined && slotY < trBottom && centeredRight > trLeft;
        if (hitsBottomRight || hitsTopRight) rowOffset = 0;
      }
      rowOffsets.push(rowOffset);
    }

    const placeSlot = (row: number, col: number): { slotX: number; slotY: number } => {
      const slotX = gridLeft + rowOffsets[row] + col * slotW;
      const slotY = shelfTop + row * rowH;
      return { slotX, slotY };
    };

    let deadZoneDropped = 0;
    let lastPlacedRow = 0;
    let lastPlacedCol = 0;
    for (let i = 0; i < tilesShown; i += 1) {
      const row = Math.floor(i / cols);
      const col = i % cols;
      const tile = shelf.tiles[i];
      const { slotX, slotY } = placeSlot(row, col);
      if (slotIntersectsDeadZone(slotX, slotY)) {
        deadZoneDropped += 1;
        continue;
      }
      const charY = slotY + (maxCharH - tile.charH);
      const x = slotX + Math.floor((slotW - tile.spriteCols) / 2);
      placements.push({ tile, x, charY });
      lastPlacedRow = row;
      lastPlacedCol = col;
    }

    const totalHidden = (willOverflow ? shelf.tiles.length - tilesShown : 0) + deadZoneDropped;
    if (totalHidden > 0) {
      const row = willOverflow && overflowRow < shelfRowSpan ? overflowRow : lastPlacedRow;
      const col = willOverflow && overflowRow < shelfRowSpan ? overflowCol : lastPlacedCol;
      const { slotX, slotY } = placeSlot(row, col);
      overflows.push({
        vibe: shelf.vibe,
        canvasRow: slotY + maxCharH + NAME_GAP_ROWS,
        canvasCol: slotX,
        slotW,
        hidden: totalHidden
      });
    }

    cursorY = shelfTop + shelfRowSpan * rowH;
  }

  return { placements, dividers, overflows };
};

// Per-page slot dimensions used by paginateCreatures. These intentionally
// sit well above the placer's hard minimums (sprite 2..5w, 2..3h) so a page
// reads as roomy rather than barely-fits — pagination's whole job is to
// uncrowd the scene, not to repack at the densest legal level. Tuned by
// eye on wide terminals where the lower 10×7 slot was still landing 15-20
// creatures on a page; 14×9 brings that down to ~8-10 with comfortable
// margins between sprites.
const PAGE_SLOT_W = 14;
const PAGE_SLOT_H = 9;

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
  // Match placeCreatures: reserve the name strip at the bottom so capacity
  // math agrees with what the placer actually accepts. Without this match
  // pagination would pack the last row tight and the placer would reject
  // those slots, forcing overlap-packing — the exact thing pagination is
  // here to prevent.
  const nameReserve = NAME_GAP_ROWS + NAME_H;
  const usableH = Math.max(PAGE_SLOT_H, canvasH - SKY_ROWS - GROUND_ROWS - nameReserve);
  const cols = Math.max(1, Math.floor(usableW / PAGE_SLOT_W));
  const rows = Math.max(1, Math.floor(usableH / PAGE_SLOT_H));
  const grid = cols * rows;
  let blocked = 0;
  if (deadZone) {
    blocked += slotsBlockedByZone(
      deadZone.width,
      deadZone.height + nameReserve,
      PAGE_SLOT_W,
      PAGE_SLOT_H,
      cols,
      rows
    );
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
    // Use the full footprint (sprite body + name label row) so the
    // label fits within the slot — otherwise long names overflow into
    // neighbouring slots' columns or rows and collide with their bodies.
    const offsets = spriteFullFootprint({ tile, x: 0, charY: 0 });
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

  // Minimum slot dimensions: fit the largest *full* footprint (sprite body
  // plus the centred name label one gap-row below) + the baseline slot pad
  // so neither bodies nor labels overlap after jittering within a slot.
  // Labels span `name.length + 2` cells (glyph + space + name) centred under
  // the sprite, so for long names they're wider than the sprite body.
  const maxSpriteCols = Math.max(...tiles.map((t) => t.spriteCols));
  const maxSpriteRows = Math.max(...tiles.map((t) => t.charRows));
  const maxLabelCols = Math.max(
    ...tiles.map((t) => t.creature.scan.name.length + 2)
  );
  const minSlotW = Math.max(maxSpriteCols, maxLabelCols) + SLOT_PAD_X;
  // The label row inside the slot already provides visual separation
  // between adjacent rows, so SLOT_PAD_Y isn't added a second time —
  // doing so dropped grid capacity below what the canvas can fit.
  const minSlotH = maxSpriteRows + NAME_GAP_ROWS + NAME_H;

  const usableW = Math.max(minSlotW, canvasW - 1);
  // Reserve enough rows at the bottom for the name strip beneath every
  // sprite (NAME_GAP_ROWS + NAME_H). Without this the lowest row of sprites
  // pushes its name row into the GROUND row — the name silently clips
  // against the panel's content edge.
  const NAME_RESERVE = NAME_GAP_ROWS + NAME_H;
  const usableH = Math.max(minSlotH, canvasH - SKY_ROWS - GROUND_ROWS - NAME_RESERVE);
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
      // Extend the bottom by NAME_RESERVE when testing against the focus
      // card — the name row sits below the sprite footprint and the
      // unextended check let names paint into the card's territory where
      // the overlay then covered them.
      const slotBottomWithName = slotBottom + NAME_RESERVE;
      if (deadZone && slotRight > deadLeft && slotBottomWithName > deadTop) continue;
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
        const fullFootprint = spriteFullFootprint(candidate);
        // Slot must contain the *full* footprint so the label doesn't
        // overflow into a neighbouring slot's body.
        if (!footprintFitsSlot(fullFootprint, slot)) continue;
        if (acceptedFootprints.some((accepted) => spriteBodyFootprintsOverlap(fullFootprint, accepted))) {
          continue;
        }
        resolved = candidate;
        resolvedSlotIndex = slotIndex;
        acceptedFootprints.push(fullFootprint);
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
      acceptedFootprints.push(spriteFullFootprint(resolved));
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

  // Box hugs the sprite tightly — 1 col of breathing room on each side and
  // the bottom edge lands on the empty `NAME_GAP_ROWS` row between sprite
  // and name, so the name itself (one row further down) is unaffected by
  // focus changes.
  let boxLeft = x - 1;
  let boxRight = x + spriteCols;
  const boxTop = charY - 1;
  const boxBottom = charY + tile.charRows;

  const canvasW = bounds?.canvasW ?? Number.POSITIVE_INFINITY;

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
  // Name + vibe glyph are painted by the regular name pass in render.ts so
  // the focused state can keep the glyph in vibe colour while the name flips
  // to primary+bold. Centering matches the unfocused state exactly — no
  // 1-cell shift on focus.

  return cells;
};
