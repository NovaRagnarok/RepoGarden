// Pure layout/geometry helpers for the garden scene. Lives outside
// GardenView.tsx so unit tests can exercise them without dragging in React +
// Ink. Anything stateful (the React renderer, the stdout painters, mouse
// hooks) stays in GardenView; anything that maps "creatures + canvas" → cells
// belongs here.

import type { RepoCreature } from "@/lib/creature";
import {
  buildCreatureSizeCohort,
  creatureCharSize,
  hashString,
  mulberry32
} from "@/lib/sprite";
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
  /** Left-most canvas column the divider extends to. Rooms layout uses
   *  per-room dividers so each room gets its own label-with-flanking-dashes
   *  spanning only its own width. */
  canvasCol: number;
  /** Cell width of the divider — typically the room's width. */
  width: number;
  /** Vibe this divider labels — used to colour the label text. */
  vibe: Vibe;
  /** Number of creatures sitting under this divider. */
  count: number;
  /** 1-indexed current page for this vibe's room when the cohort has more
   *  creatures than fit in the room. Omitted when there's only one page. */
  pageIndex?: number;
  /** Total page count for this vibe's room. Omitted when only one page. */
  pageCount?: number;
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

export interface RoomSeparator {
  /** Canvas col (0-indexed) where the vertical line sits. */
  canvasCol: number;
  /** Top-most canvas row the line covers. */
  canvasRow: number;
  /** Number of rows the line spans. */
  length: number;
}

export interface ShelfLayout {
  placements: Placement[];
  dividers: DividerPlacement[];
  overflows: ShelfOverflow[];
  /** Vertical separators between adjacent rooms on the same row.
   *  Horizontal separators are unnecessary — each room's divider line
   *  doubles as the separator from the room above. */
  separators?: RoomSeparator[];
}

/** Display order for shelf groups: liveliest at the top, sleepy at the bottom.
 *  `awake` (recent local changes) sits above `happy` (settled, in sync) so the
 *  shelf reads top-down as "most engaged → least." */
export const VIBE_ORDER: readonly Vibe[] = ["awake", "happy", "stuck", "sleepy"];

const SHELF_LABELS: Record<Vibe, { long: (count: number) => string; short: (count: number) => string }> = {
  awake: {
    long: (count) => `awake · active changes · ${count}`,
    short: (count) => `awake · ${count}`
  },
  happy: {
    long: (count) => `happy · flowing · ${count}`,
    short: (count) => `happy · ${count}`
  },
  stuck: {
    long: (count) => count === 0 ? "stuck · no blockers" : `stuck · blockers to clear · ${count}`,
    short: (count) => count === 0 ? "stuck · clear" : `stuck · ${count}`
  },
  sleepy: {
    long: (count) => `sleepy · quiet lately · ${count}`,
    short: (count) => `sleepy · ${count}`
  }
};

export const formatShelfDividerLabel = (
  vibe: Vibe,
  count: number,
  maxWidth = Number.POSITIVE_INFINITY
): string => {
  const copy = SHELF_LABELS[vibe] ?? SHELF_LABELS.happy;
  const long = copy.long(count);
  if (long.length <= maxWidth) return long;
  const short = copy.short(count);
  if (short.length <= maxWidth) return short;
  return short.slice(0, Math.max(0, maxWidth));
};

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

/** Density preset — passed through from the user's TUI config so the same
 *  "how packed?" knob steers both the garden's per-page slot capacity and
 *  the shelf's per-cell breathing room. `comfortable` is the historical
 *  default; `cozy` is roomier (fewer creatures fit per page / per shelf
 *  row), `dense` is tighter. */
export type GardenDensity = "cozy" | "comfortable" | "dense";

interface RoomRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Lower bounds so a 1-creature cohort still has enough room for the
// divider label + a single sprite + name. Picked from the organic
// placer's own minimums: SKY (1) + GROUND (1) + NAME_RESERVE (2) +
// sprite (≥2) for height; sprite (≥4) + slot pad for width.
export const MIN_ROOM_W = 16;
export const MIN_ROOM_H = 8;
// Functional thresholds for the compact-fallback trigger: at these
// per-room sizes there's enough room AFTER header / footer reservations
// AND the organic placer's SKY+GROUND+NAME_RESERVE for at least a
// modestly-sized creature + name. Below these the rooms render
// labels + boxes but drop all creatures — exactly the state the user
// flagged. Higher than `MIN_ROOM_W` / `MIN_ROOM_H` because those values
// are the splitLen absolute floor (which can still be empty in
// practice). Bumped up so a cohort full of medium-large creatures
// (charH around 5-7) doesn't get every member dropped — the previous
// 13-row threshold only protected the smallest creatures.
export const ROOM_COMPACT_TRIGGER_W = 20;
export const ROOM_COMPACT_TRIGGER_H = 16;

// Proportionally split `length` into N chunks weighted by `weights`,
// clamped to >= `min` each. When the sum of weights is zero (shouldn't
// happen since we skip empty cohorts upstream) the chunks are equal.
// Excess / shortfall after clamping is absorbed into the chunk with
// the largest raw allocation.
const splitLen = (
  length: number,
  weights: number[],
  min: number
): number[] => {
  const n = weights.length;
  if (n === 0) return [];
  if (n === 1) return [length];
  const total = weights.reduce((a, b) => a + b, 0);
  const raw =
    total === 0
      ? weights.map(() => length / n)
      : weights.map((w) => (w / total) * length);
  const out = raw.map((r) => Math.max(min, Math.floor(r)));
  let allocated = out.reduce((a, b) => a + b, 0);
  // Index order from largest raw allocation downward — we add or remove
  // single cells from the biggest chunks first so the proportions stay
  // closest to the requested ratio after clamping.
  const order = raw
    .map((_, i) => i)
    .sort((a, b) => raw[b] - raw[a]);
  let cursor = 0;
  while (allocated > length) {
    const idx = order[cursor % order.length];
    if (out[idx] > min) {
      out[idx] -= 1;
      allocated -= 1;
    }
    cursor += 1;
    if (cursor > order.length * length) break;
  }
  cursor = 0;
  while (allocated < length) {
    const idx = order[cursor % order.length];
    out[idx] += 1;
    allocated += 1;
    cursor += 1;
  }
  return out;
};

// Split a canvas into N rectangular rooms, one per populated vibe.
// Adapts to the cohort count so empty rooms never appear: 1 room takes
// the whole canvas; 2 split side-by-side; 3 use a 2-top, 1-bottom
// arrangement; 4 form a 2×2. Within each layout, both axes are sized
// proportionally to creature count — a 1-creature cohort gets a
// minimum-sized room while a 20-creature cohort gets the lion's share
// of its row / column.
const computeRoomRects = (
  rooms: { count: number }[],
  W: number,
  H: number
): RoomRect[] => {
  const n = rooms.length;
  if (n <= 0 || W <= 0 || H <= 0) return [];
  if (n === 1) {
    return [{ x: 0, y: 0, width: W, height: H }];
  }
  if (n === 2) {
    const widths = splitLen(W, [rooms[0].count, rooms[1].count], MIN_ROOM_W);
    return [
      { x: 0, y: 0, width: widths[0], height: H },
      { x: widths[0], y: 0, width: widths[1], height: H }
    ];
  }
  if (n === 3) {
    // Top row gets rooms[0..1]; bottom row gets rooms[2] full-width.
    const topCount = rooms[0].count + rooms[1].count;
    const bottomCount = rooms[2].count;
    const heights = splitLen(H, [topCount, bottomCount], MIN_ROOM_H);
    const topWidths = splitLen(W, [rooms[0].count, rooms[1].count], MIN_ROOM_W);
    return [
      { x: 0, y: 0, width: topWidths[0], height: heights[0] },
      { x: topWidths[0], y: 0, width: topWidths[1], height: heights[0] },
      { x: 0, y: heights[0], width: W, height: heights[1] }
    ];
  }
  // 4 rooms: 2×2 with both axes proportional. Column widths can differ
  // between rows so each row's split reflects only its own members'
  // counts — the vertical separator therefore sits at different
  // columns in top vs bottom rows when the proportions diverge.
  const topCount = rooms[0].count + rooms[1].count;
  const bottomCount = rooms[2].count + rooms[3].count;
  const heights = splitLen(H, [topCount, bottomCount], MIN_ROOM_H);
  const topWidths = splitLen(W, [rooms[0].count, rooms[1].count], MIN_ROOM_W);
  const botWidths = splitLen(W, [rooms[2].count, rooms[3].count], MIN_ROOM_W);
  return [
    { x: 0, y: 0, width: topWidths[0], height: heights[0] },
    { x: topWidths[0], y: 0, width: topWidths[1], height: heights[0] },
    { x: 0, y: heights[0], width: botWidths[0], height: heights[1] },
    { x: botWidths[0], y: heights[0], width: botWidths[1], height: heights[1] }
  ];
};

// Clip the bottom-right canvas dead zone (workbench card area) to a
// single room, returning the room-local "bottom-right dead zone" the
// organic placer expects. Returns undefined if the zone doesn't touch
// this room.
const clipBottomRightZone = (
  zone: { width: number; height: number },
  room: RoomRect,
  canvasW: number,
  canvasH: number
): { width: number; height: number } | undefined => {
  const roomRight = room.x + room.width;
  const roomBottom = room.y + room.height;
  if (roomRight < canvasW || roomBottom < canvasH) return undefined;
  const zoneLeft = canvasW - zone.width;
  const zoneTop = canvasH - zone.height;
  const localW = Math.min(room.width, roomRight - zoneLeft);
  const localH = Math.min(room.height, roomBottom - zoneTop);
  if (localW <= 0 || localH <= 0) return undefined;
  return { width: localW, height: localH };
};

// Mirror of `clipBottomRightZone` for the top-right dead zone (toast /
// notification slot).
const clipTopRightZone = (
  zone: { width: number; height: number },
  room: RoomRect,
  canvasW: number
): { width: number; height: number } | undefined => {
  const roomRight = room.x + room.width;
  if (roomRight < canvasW || room.y > 0) return undefined;
  const zoneLeft = canvasW - zone.width;
  const localW = Math.min(room.width, roomRight - zoneLeft);
  const localH = Math.min(room.height, zone.height);
  if (localW <= 0 || localH <= 0) return undefined;
  return { width: localW, height: localH };
};

// Grid placer used inside each room. Like `placeCreatures` but with
// jitter removed — every tile lands at the centre of its slot, so
// adjacent rooms feel uniformly lined up rather than the loose
// scatter the organic placer produces. Saves vertical and horizontal
// space too (no jitter slack inside each slot).
const placeTilesGridded = (
  tiles: SizedTile[],
  canvasW: number,
  canvasH: number,
  deadZone?: { width: number; height: number },
  topRightDeadZone?: { width: number; height: number }
): Placement[] => {
  if (tiles.length === 0) return [];

  const maxSpriteCols = Math.max(...tiles.map((t) => t.spriteCols));
  const maxSpriteRows = Math.max(...tiles.map((t) => t.charRows));
  const maxLabelCols = Math.max(
    ...tiles.map((t) => t.creature.scan.name.length + 2)
  );

  const slotW = Math.max(maxSpriteCols, maxLabelCols) + SLOT_PAD_X;
  const slotH = maxSpriteRows + NAME_GAP_ROWS + NAME_H;

  const NAME_RESERVE = NAME_GAP_ROWS + NAME_H;
  const usableW = Math.max(slotW, canvasW - 1);
  const usableH = Math.max(slotH, canvasH - SKY_ROWS - GROUND_ROWS - NAME_RESERVE);
  const maxCols = Math.max(1, Math.floor(usableW / slotW));
  const maxRows = Math.max(1, Math.floor(usableH / slotH));

  // Pick useRows × useCols: fill rows first, then add cols.
  const N = tiles.length;
  const useRows = Math.max(1, Math.min(maxRows, N));
  const useCols = Math.max(1, Math.min(maxCols, Math.ceil(N / useRows)));

  // SPREAD the rows across the full inner canvas, not just pack them from
  // the top. The previous `rowPitch = max(slotH, usableH/useRows)` packed
  // tightly downward, so with maxRows=3 in a 30-row canvas the bottom
  // ~6 rows stayed empty. Now: row 0 sits at the canvas top, the LAST
  // row's slot bottom sits at the canvas bottom (minus GROUND_ROWS), and
  // intermediate rows are evenly spaced between. The `max(slotH, …)`
  // floor prevents row overlap when N is dense; the `max(slotW, …)` floor
  // does the same horizontally.
  const innerTop = SKY_ROWS;
  const innerBottom = canvasH - GROUND_ROWS;
  const rowSpan = Math.max(0, innerBottom - slotH - innerTop);
  const colSpan = Math.max(0, canvasW - slotW);
  const rowStride =
    useRows > 1 ? Math.max(slotH, Math.floor(rowSpan / (useRows - 1))) : 0;
  const colStride =
    useCols > 1 ? Math.max(slotW, Math.floor(colSpan / (useCols - 1))) : 0;

  // Single-row / single-col cases get centered within the inner canvas.
  const gridTop =
    useRows > 1
      ? innerTop
      : innerTop + Math.max(0, Math.floor((innerBottom - innerTop - slotH) / 2));
  const gridLeft =
    useCols > 1 ? 0 : Math.max(0, Math.floor((canvasW - slotW) / 2));

  const deadLeft = deadZone ? canvasW - deadZone.width : Number.POSITIVE_INFINITY;
  const deadTop = deadZone ? canvasH - deadZone.height : Number.POSITIVE_INFINITY;
  const trLeft = topRightDeadZone
    ? canvasW - topRightDeadZone.width
    : Number.POSITIVE_INFINITY;
  const trBottom = topRightDeadZone ? topRightDeadZone.height : 0;

  const placements: Placement[] = [];
  for (let i = 0; i < tiles.length; i += 1) {
    const r = Math.floor(i / useCols);
    const c = i % useCols;
    if (r >= useRows) break;
    const slotX = gridLeft + c * colStride;
    const slotY = gridTop + r * rowStride;
    const slotRight = slotX + slotW;
    const slotBottom = slotY + slotH;
    if (deadZone && slotRight > deadLeft && slotBottom + NAME_RESERVE > deadTop) {
      continue;
    }
    if (topRightDeadZone && slotRight > trLeft && slotY < trBottom) continue;
    const tile = tiles[i];
    // Top-align sprites within the slot. Bottom-align would tie every
    // creature's name row to `slotY + slotH` (i.e. the tallest creature
    // in the cohort), so if the tallest overflows the room's safeBottom
    // every creature gets dropped — including short ones that would
    // individually fit. Top-align decouples each creature's overflow
    // check from its cohort's tallest member.
    const x = slotX + Math.floor((slotW - tile.spriteCols) / 2);
    const charY = slotY;
    placements.push({ tile, x, charY });
  }
  return placements;
};

// Header height per room: 1 row for the divider label + 1 spacer row
// before the room's content starts.
const ROOM_HEADER_ROWS = 2;
// Footer buffer per room: 1 row of unused space at the room's bottom
// so the last name row of a creature in this room doesn't sit
// immediately above the next room's divider line. Without this the
// name + divider read as one visual cluster and it looks like the
// names belong to the room below.
const ROOM_FOOTER_ROWS = 1;

// Place creatures into vibe-grouped rooms (1–4 quadrants on the
// panel canvas). Each populated vibe gets its own sub-canvas and the
// organic placer runs inside it, so creatures keep the exact same
// shape and size they have in garden mode — only the *arrangement*
// differs between the two views. Empty cohorts contribute nothing
// (no room is reserved for them); the layout collapses to fewer
// rooms so populated cohorts get more space.
//
// Returns the same shape as the old shelf placer (placements +
// per-room divider headers) so the renderer doesn't need to know
// which placer produced the layout. `overflows` stays empty because
// the organic placer's per-room call handles its own slot pressure
// via the dead-zone math.
export const placeInRooms = (
  tiles: SizedTile[],
  canvasW: number,
  canvasH: number,
  // `_seedKey` kept for signature compatibility with the previous
  // organic-per-room placer. The current grid placer is deterministic
  // and doesn't need a randomness seed.
  _seedKey: string,
  pageIndexByVibe: Partial<Record<Vibe, number>>,
  deadZone?: { width: number; height: number },
  topRightDeadZone?: { width: number; height: number }
): ShelfLayout => {
  if (tiles.length === 0) return { placements: [], dividers: [], overflows: [] };

  const groups = new Map<Vibe, SizedTile[]>();
  for (const v of VIBE_ORDER) groups.set(v, []);
  for (const tile of tiles) groups.get(tile.creature.vibe.vibe)?.push(tile);

  const rooms: { vibe: Vibe; tiles: SizedTile[] }[] = [];
  for (const vibe of VIBE_ORDER) {
    const groupTiles = groups.get(vibe) ?? [];
    if (groupTiles.length === 0) continue;
    rooms.push({ vibe, tiles: groupTiles });
  }
  if (rooms.length === 0) return { placements: [], dividers: [], overflows: [] };

  // Reserve the panel's sky / ground rows the same way the shelf placer
  // and the organic placer both expect; the rooms live inside that
  // chrome.
  const innerX = 0;
  const innerY = SKY_ROWS;
  const innerH = Math.max(0, canvasH - SKY_ROWS - GROUND_ROWS);
  const innerW = canvasW;
  if (innerH <= 0 || innerW <= 0) {
    return { placements: [], dividers: [], overflows: [] };
  }

  const rects = computeRoomRects(
    rooms.map((r) => ({ count: r.tiles.length })),
    innerW,
    innerH
  );

  // Vertical separators between rooms that share a top edge. Drawn at
  // the row range of whichever row those rooms occupy; for 2×2 the top
  // and bottom row each get their own separator at the same column.
  const separators: RoomSeparator[] = [];
  // Helper: two rects sit side-by-side iff they share a top edge and a
  // height, and one's left edge equals the other's right edge.
  for (let i = 0; i < rects.length; i += 1) {
    for (let j = i + 1; j < rects.length; j += 1) {
      const a = rects[i];
      const b = rects[j];
      if (a.y !== b.y || a.height !== b.height) continue;
      if (a.x + a.width === b.x) {
        separators.push({
          canvasCol: innerX + b.x - 1,
          canvasRow: innerY + a.y,
          length: a.height
        });
      } else if (b.x + b.width === a.x) {
        separators.push({
          canvasCol: innerX + a.x - 1,
          canvasRow: innerY + a.y,
          length: a.height
        });
      }
    }
  }

  const placements: Placement[] = [];
  const dividers: DividerPlacement[] = [];

  rooms.forEach((room, idx) => {
    const rect = rects[idx];
    if (!rect) return;
    const absX = rect.x;
    const absY = innerY + rect.y;

    // Sub-canvas for the grid placer: room rect minus its header
    // AND a footer buffer (so names land at least ROOM_FOOTER_ROWS
    // above the room's bottom edge). When there's only one room the
    // header is skipped (no divider is drawn), so the full rect
    // goes to creatures.
    const headerRows = rooms.length > 1 ? ROOM_HEADER_ROWS : 0;
    const footerRows = rooms.length > 1 ? ROOM_FOOTER_ROWS : 0;
    const subW = rect.width;
    const subH = Math.max(0, rect.height - headerRows - footerRows);

    const roomCanvas: RoomRect = {
      x: absX,
      y: absY + headerRows,
      width: subW,
      height: subH
    };
    const localBR = deadZone
      ? clipBottomRightZone(deadZone, roomCanvas, canvasW, canvasH)
      : undefined;
    const localTR = topRightDeadZone
      ? clipTopRightZone(topRightDeadZone, roomCanvas, canvasW)
      : undefined;

    // Per-room pagination: rooms on small terminals can't fit all of
    // their cohort, so each vibe's room flips through its own pages
    // independently. Capacity is computed against the room's actual
    // sub-canvas dimensions so a wider room (a larger cohort) holds
    // more per page than a narrower one.
    let pageCount = 1;
    let pageIndex = 0;
    let pagedTiles = room.tiles;
    const pathologicallySmall = subW < 6 || subH < 4;
    if (!pathologicallySmall) {
      const capacity = Math.max(
        1,
        safeGardenCapacity(room.tiles, subW, subH, localBR, localTR)
      );
      pageCount = Math.max(1, Math.ceil(room.tiles.length / capacity));
      const requested = pageIndexByVibe[room.vibe] ?? 0;
      pageIndex = Math.max(0, Math.min(pageCount - 1, requested));
      pagedTiles = room.tiles.slice(
        pageIndex * capacity,
        pageIndex * capacity + capacity
      );
    }

    // Divider sits on the top row of the room and spans only that room's
    // width — adjacent rooms each get their own dashes-around-the-label.
    // Page metadata is attached when the cohort spans more than one page
    // so the renderer can append `(N/M)` to the label.
    //
    // Skipped entirely when there's only one room: in that case the
    // section header / compact-mode navigator already names the vibe,
    // and an inline divider just labels the obvious. Single-room is
    // either rooms-compact (filtered to one vibe by the caller) or
    // a roster where only one vibe is populated.
    if (rooms.length > 1) {
      dividers.push({
        vibe: room.vibe,
        count: room.tiles.length,
        canvasRow: absY,
        canvasCol: absX,
        width: rect.width,
        ...(pageCount > 1
          ? { pageIndex: pageIndex + 1, pageCount }
          : {})
      });
    }

    // Pathologically small rooms (e.g. a 2×2 split on a tiny terminal):
    // skip placement rather than crash the organic placer's minSlot math.
    if (pathologicallySmall) return;

    // Grid placement (not the organic placer) — uniform spacing across
    // the room, no jitter, tighter packing than the slot-jittered
    // garden layout. Drops the seed argument since there's no
    // randomness to seed anymore.
    const sub = placeTilesGridded(
      pagedTiles,
      subW,
      subH,
      localBR,
      localTR
    );

    // Translate sub-canvas placements back to absolute canvas coords,
    // dropping any whose sprite body or name row would cross the room's
    // bottom edge. The organic placer is happy to overflow when the
    // sub-canvas can't fit the natural sprite size + name reservation
    // (e.g. an 11-tall sausage creature in an 11-row 2×2 cell). On the
    // garden canvas that overflow lands in the ground/SKY buffer; in
    // rooms it lands in the *next room's content*. Dropping is the
    // safer choice — fewer creatures shown in the cramped room, but
    // no names bleeding through the divider into the room below.
    // Reserve ROOM_FOOTER_ROWS at the bottom for visual breathing room
    // before the next room's divider, so the last name row of THIS
    // room can't visually merge with the divider of the NEXT room.
    const safeBottom = absY + rect.height - footerRows;
    for (const placement of sub) {
      const translatedY = placement.charY + absY + headerRows;
      const nameRowBottom =
        translatedY + placement.tile.charRows + NAME_GAP_ROWS + NAME_H - 1;
      if (nameRowBottom >= safeBottom) continue;
      placements.push({
        ...placement,
        x: placement.x + absX,
        charY: translatedY
      });
    }
  });

  return { placements, dividers, overflows: [], separators };
};

/** Compute how many creatures each vibe's room can fit at once on the
 *  given panel canvas. Mirrors the geometry `placeInRooms` uses (same
 *  room rect math, same sub-canvas reservations, same `safeGardenCapacity`
 *  call), so ReadyShell can clamp `[` / `]` page navigation against the
 *  same page counts the placer renders. */
export const computeRoomPageCounts = (
  tiles: SizedTile[],
  canvasW: number,
  canvasH: number,
  deadZone?: { width: number; height: number },
  topRightDeadZone?: { width: number; height: number }
): Partial<Record<Vibe, number>> => {
  if (tiles.length === 0) return {};

  const groups = new Map<Vibe, SizedTile[]>();
  for (const v of VIBE_ORDER) groups.set(v, []);
  for (const tile of tiles) groups.get(tile.creature.vibe.vibe)?.push(tile);

  const rooms: { vibe: Vibe; tiles: SizedTile[] }[] = [];
  for (const vibe of VIBE_ORDER) {
    const groupTiles = groups.get(vibe) ?? [];
    if (groupTiles.length === 0) continue;
    rooms.push({ vibe, tiles: groupTiles });
  }
  if (rooms.length === 0) return {};

  const innerY = SKY_ROWS;
  const innerH = Math.max(0, canvasH - SKY_ROWS - GROUND_ROWS);
  const innerW = canvasW;
  if (innerH <= 0 || innerW <= 0) return {};

  const rects = computeRoomRects(
    rooms.map((r) => ({ count: r.tiles.length })),
    innerW,
    innerH
  );

  const result: Partial<Record<Vibe, number>> = {};
  const headerRows = rooms.length > 1 ? ROOM_HEADER_ROWS : 0;
  const footerRows = rooms.length > 1 ? ROOM_FOOTER_ROWS : 0;
  rooms.forEach((room, idx) => {
    const rect = rects[idx];
    if (!rect) return;
    const absX = rect.x;
    const absY = innerY + rect.y;
    const subW = rect.width;
    const subH = Math.max(0, rect.height - headerRows - footerRows);
    if (subW < 6 || subH < 4) {
      result[room.vibe] = 1;
      return;
    }
    const roomCanvas: RoomRect = {
      x: absX,
      y: absY + headerRows,
      width: subW,
      height: subH
    };
    const localBR = deadZone
      ? clipBottomRightZone(deadZone, roomCanvas, canvasW, canvasH)
      : undefined;
    const localTR = topRightDeadZone
      ? clipTopRightZone(topRightDeadZone, roomCanvas, canvasW)
      : undefined;
    const capacity = Math.max(
      1,
      safeGardenCapacity(room.tiles, subW, subH, localBR, localTR)
    );
    result[room.vibe] = Math.max(1, Math.ceil(room.tiles.length / capacity));
  });
  return result;
};

/** Convenience wrapper around `computeRoomPageCounts` that takes raw
 *  `RepoCreature`s rather than pre-sized tiles. Used by ReadyShell to
 *  clamp the user's `[` / `]` keystrokes against the actual page count
 *  the engine will render without having to duplicate the engine's
 *  tile-building. Matches the engine's `buildTiles` logic exactly: same
 *  `buildCreatureSizeCohort` + `creatureCharSize` calls, same sprite
 *  dimensions. */
export const computeRoomPageCountsForCreatures = (
  creatures: readonly RepoCreature[],
  canvasW: number,
  canvasH: number,
  deadZone?: { width: number; height: number },
  topRightDeadZone?: { width: number; height: number }
): Partial<Record<Vibe, number>> => {
  if (creatures.length === 0) return {};
  const cohort = buildCreatureSizeCohort(creatures.map((c) => c.scan));
  const tiles: SizedTile[] = creatures.map((creature, index) => {
    const { charW, charH } = creatureCharSize(creature.scan, undefined, cohort);
    return {
      creature,
      index,
      charW,
      charH,
      spriteCols: charW,
      charRows: charH
    };
  });
  return computeRoomPageCounts(tiles, canvasW, canvasH, deadZone, topRightDeadZone);
};

// Per-page slot dimensions used by paginateCreatures. These intentionally
// sit well above the placer's hard minimums (sprite 2..5w, 2..3h) so a page
// reads as roomy rather than barely-fits — pagination's whole job is to
// uncrowd the scene, not to repack at the densest legal level.
//
// `comfortable` (14×9) was the pre-density default — on wide terminals it
// lands ~8-10 creatures per page with breathing room. `cozy` (17×11) shows
// fewer per page for users who want the scene to feel sparse. `dense`
// (11×7) packs ~50% more before pagination kicks in — handy when you
// like seeing all the creatures at once but still want pages, not the
// uncapped placer fallback.
const PAGE_SLOT_DIMS: Record<GardenDensity, { w: number; h: number }> = {
  cozy: { w: 17, h: 11 },
  comfortable: { w: 14, h: 9 },
  dense: { w: 11, h: 7 }
};

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

/** Labels-aware variant of `gardenPageCapacity`. Uses the actual longest
 *  name + sprite dims across the supplied tiles instead of the
 *  baseline `PAGE_SLOT_W`. Use this when guaranteeing zero overlap and zero
 *  edge-crop matters more than density — e.g. the static GIF / text-frame
 *  export pipeline, where the user is sharing a snapshot rather than
 *  interacting with it.
 *
 *  Returns the maximum number of these specific creatures that can be placed
 *  without their labels overflowing their slot or the canvas. The caller
 *  should slice creatures to this count (and paginate the rest) before
 *  handing them to `placeCreatures`. */
export const safeGardenCapacity = (
  tiles: SizedTile[],
  canvasW: number,
  canvasH: number,
  deadZone?: { width: number; height: number },
  topRightDeadZone?: { width: number; height: number }
): number => {
  if (tiles.length === 0) return 0;
  const maxSpriteCols = Math.max(...tiles.map((t) => t.spriteCols));
  const maxSpriteRows = Math.max(...tiles.map((t) => t.charRows));
  const maxLabelCols = Math.max(
    ...tiles.map((t) => t.creature.scan.name.length + 2)
  );
  // Same formula `placeCreatures` uses for its hard minimums — keeping the
  // two in lockstep means the capacity we report matches the capacity the
  // placer actually offers.
  const minSlotW = Math.max(maxSpriteCols, maxLabelCols) + SLOT_PAD_X;
  const minSlotH = maxSpriteRows + NAME_GAP_ROWS + NAME_H;
  const usableW = Math.max(minSlotW, canvasW - 1);
  const nameReserve = NAME_GAP_ROWS + NAME_H;
  const usableH = Math.max(minSlotH, canvasH - SKY_ROWS - GROUND_ROWS - nameReserve);
  const cols = Math.max(1, Math.floor(usableW / minSlotW));
  const rows = Math.max(1, Math.floor(usableH / minSlotH));
  const grid = cols * rows;
  let blocked = 0;
  if (deadZone) {
    blocked += slotsBlockedByZone(
      deadZone.width,
      deadZone.height + nameReserve,
      minSlotW,
      minSlotH,
      cols,
      rows
    );
  }
  if (topRightDeadZone) {
    blocked += slotsBlockedByZone(
      topRightDeadZone.width,
      topRightDeadZone.height,
      minSlotW,
      minSlotH,
      cols,
      rows
    );
  }
  return Math.max(1, grid - blocked);
};

/** Mirror of the placer's "fit creatures into the canvas without overlap"
 *  capacity formula, using PAGE_SLOT_DIMS[density] in place of the placer's
 *  hard minimums so a page leaves room to breathe. Dead-zone discounts are
 *  conservative — any slot the zone clips gets dropped, even if a sliver
 *  remains usable. */
export const gardenPageCapacity = (
  canvasW: number,
  canvasH: number,
  deadZone?: { width: number; height: number },
  topRightDeadZone?: { width: number; height: number },
  density: GardenDensity = "comfortable"
): number => {
  const slot = PAGE_SLOT_DIMS[density];
  const usableW = Math.max(slot.w, canvasW - 1);
  // Match placeCreatures: reserve the name strip at the bottom so capacity
  // math agrees with what the placer actually accepts. Without this match
  // pagination would pack the last row tight and the placer would reject
  // those slots, forcing overlap-packing — the exact thing pagination is
  // here to prevent.
  const nameReserve = NAME_GAP_ROWS + NAME_H;
  const usableH = Math.max(slot.h, canvasH - SKY_ROWS - GROUND_ROWS - nameReserve);
  const cols = Math.max(1, Math.floor(usableW / slot.w));
  const rows = Math.max(1, Math.floor(usableH / slot.h));
  const grid = cols * rows;
  let blocked = 0;
  if (deadZone) {
    blocked += slotsBlockedByZone(
      deadZone.width,
      deadZone.height + nameReserve,
      slot.w,
      slot.h,
      cols,
      rows
    );
  }
  if (topRightDeadZone) {
    blocked += slotsBlockedByZone(
      topRightDeadZone.width,
      topRightDeadZone.height,
      slot.w,
      slot.h,
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
