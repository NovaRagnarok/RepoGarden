import test from "node:test";
import assert from "node:assert/strict";

import {
  computeFocusFrameCells,
  gardenPageCapacity,
  lineUpCreatures,
  paginateCreatures,
  placeCreatures,
  spriteBodyFootprint,
  spriteBodyFootprintsOverlap,
  spriteFullFootprint,
  stableCreatureIdsKey,
  type SizedTile
} from "../lib/garden-layout";

const makeTile = (
  index: number,
  name: string,
  spriteCols = 6,
  charRows = 4
): SizedTile => ({
  creature: {
    id: `id-${index}`,
    // Only `scan.name` is read by computeFocusFrameCells.
    scan: { id: `id-${index}`, path: `/tmp/${name}`, name, isDirty: false } as any,
    memory: {} as any,
    vibe: { vibe: "happy", reason: "" } as any
  },
  index,
  charW: spriteCols,
  charH: charRows,
  spriteCols,
  charRows
});

const placementsOverlap = (placements: ReturnType<typeof placeCreatures>): boolean => {
  const footprints = placements.map((placement) => spriteBodyFootprint(placement));

  for (let i = 0; i < footprints.length; i += 1) {
    for (let j = i + 1; j < footprints.length; j += 1) {
      if (spriteBodyFootprintsOverlap(footprints[i], footprints[j])) return true;
    }
  }
  return false;
};

test("computeFocusFrameCells builds a closed box around the sprite", () => {
  const cells = computeFocusFrameCells({
    tile: makeTile(0, "cat", 6, 4),
    x: 10,
    charY: 5
  });
  // Expect each row of the box to have a left and right side, top and
  // bottom edges with corners.
  const corners = cells.filter((c) => "╭╮╰╯".includes(c.char));
  assert.equal(corners.length, 4);
  const tl = cells.find((c) => c.char === "╭")!;
  const tr = cells.find((c) => c.char === "╮")!;
  const bl = cells.find((c) => c.char === "╰")!;
  const br = cells.find((c) => c.char === "╯")!;
  assert.equal(tl.row, 4);
  assert.equal(bl.row, 9);
  assert.equal(tl.col, bl.col);
  assert.equal(tr.col, br.col);
  assert.ok(tr.col > tl.col);
});

test("computeFocusFrameCells returns only box edges — the name is painted by the regular name pass", () => {
  const cells = computeFocusFrameCells(
    { tile: makeTile(0, "cat", 6, 4), x: 10, charY: 5 },
    { canvasW: 60, canvasH: 30 }
  );
  // Box bottom is on row charY + charRows = 9; name row at 10 should have no
  // focus-frame cells anymore.
  const nameRowCells = cells.filter((c) => c.row === 10);
  assert.equal(nameRowCells.length, 0);
  // Box edges still rendered.
  const bottomRow = cells
    .filter((c) => c.row === 9)
    .sort((a, b) => a.col - b.col)
    .map((c) => c.char)
    .join("");
  assert.equal(bottomRow.startsWith("╰"), true);
  assert.equal(bottomRow.endsWith("╯"), true);
  assert.equal(bottomRow.includes("cat"), false);
});

test("computeFocusFrameCells slides right when the box would clip the left edge", () => {
  const cells = computeFocusFrameCells(
    { tile: makeTile(0, "alpha", 6, 4), x: 0, charY: 5 },
    { canvasW: 40, canvasH: 30 }
  );
  const tl = cells.find((c) => c.char === "╭")!;
  assert.ok(tl.col >= 0, `expected boxLeft >= 0, got ${tl.col}`);
});

test("computeFocusFrameCells slides left when the box would clip the right edge", () => {
  const cells = computeFocusFrameCells(
    { tile: makeTile(0, "alpha", 6, 4), x: 35, charY: 5 },
    { canvasW: 40, canvasH: 30 }
  );
  const tr = cells.find((c) => c.char === "╮")!;
  assert.ok(tr.col <= 39, `expected boxRight <= 39, got ${tr.col}`);
});

test("computeFocusFrameCells drops the name when the canvas can't fit the row below the box", () => {
  // canvasH chosen so boxBottom (charY + charRows = 9) is the last row.
  const cells = computeFocusFrameCells(
    { tile: makeTile(0, "cat", 6, 4), x: 10, charY: 5 },
    { canvasW: 60, canvasH: 10 }
  );
  // No cells should be emitted on row 10 since it sits outside the canvas.
  assert.equal(cells.some((c) => c.row === 10), false);
  // And the box bottom stays a plain rounded line — no embedded label.
  const bottomRow = cells
    .filter((c) => c.row === 9)
    .sort((a, b) => a.col - b.col)
    .map((c) => c.char)
    .join("");
  assert.equal(bottomRow.includes("cat"), false);
});

test("placeCreatures returns one placement per tile and none under the dead zone", () => {
  const tiles = Array.from({ length: 5 }, (_, i) => makeTile(i, `name${i}`, 6, 4));
  const placements = placeCreatures(tiles, 60, 30, "seed", { width: 12, height: 6 });
  assert.equal(placements.length, tiles.length);
  const dzLeft = 60 - 12;
  const dzTop = 30 - 6;
  for (const p of placements) {
    const tileRight = p.x + p.tile.spriteCols;
    const tileBottom = p.charY + p.tile.charRows;
    const intersectsDeadZone = tileRight > dzLeft && tileBottom > dzTop;
    assert.equal(
      intersectsDeadZone,
      false,
      `placement at (${p.x}, ${p.charY}) overlaps dead zone`
    );
  }
});

test("placeCreatures returns empty for empty tiles", () => {
  assert.deepEqual(placeCreatures([], 60, 30, "seed"), []);
});

test("placeCreatures still places every tile when the dead zone covers every slot", () => {
  // Tiny canvas so only one slot fits, then make the dead zone cover it.
  const tiles = [makeTile(0, "a", 6, 4)];
  const placements = placeCreatures(tiles, 8, 6, "seed", { width: 8, height: 6 });
  // Fallback uses the full slot list — placement still exists.
  assert.equal(placements.length, 1);
});

test("placeCreatures keeps creature anchors stable when tile order changes", () => {
  const tiles = [makeTile(0, "alpha"), makeTile(1, "beta"), makeTile(2, "gamma"), makeTile(3, "delta")];
  const seed = stableCreatureIdsKey(tiles.map((tile) => tile.creature));
  const forward = placeCreatures(tiles, 60, 30, seed);
  const reversed = placeCreatures([...tiles].reverse(), 60, 30, seed);

  const forwardById = new Map(forward.map((placement) => [placement.tile.creature.id, placement]));
  const reversedById = new Map(reversed.map((placement) => [placement.tile.creature.id, placement]));

  for (const tile of tiles) {
    const id = tile.creature.id;
    const a = forwardById.get(id);
    const b = reversedById.get(id);
    assert.ok(a, `missing forward placement for ${id}`);
    assert.ok(b, `missing reversed placement for ${id}`);
    assert.equal(a.x, b.x, `x changed for ${id}`);
    assert.equal(a.charY, b.charY, `charY changed for ${id}`);
  }
});

test("lineUpCreatures keeps a centered partial row out of the overlay dead zone", () => {
  const tile = makeTile(0, "repos", 8, 8);
  const layout = lineUpCreatures([tile], 71, 20, { width: 38, height: 15 });
  assert.equal(layout.placements.length, 1);
  const placement = layout.placements[0];
  const deadLeft = 71 - 38;
  const deadTop = 20 - 15;
  const tileRight = placement.x + placement.tile.spriteCols;
  const tileBottom = placement.charY + placement.tile.charRows;
  const intersectsDeadZone = tileRight > deadLeft && tileBottom > deadTop;
  assert.equal(
    intersectsDeadZone,
    false,
    `shelf placement at (${placement.x}, ${placement.charY}) overlaps dead zone`
  );
});

test("placeCreatures keeps sprite bodies separated when long labels are present", () => {
  const tiles = [
    makeTile(0, "GreenCardGuide", 6, 4),
    makeTile(1, "RepositoryAtlas", 6, 4),
    makeTile(2, "Beta", 6, 4)
  ];
  const placements = placeCreatures(
    tiles,
    80,
    24,
    stableCreatureIdsKey(tiles.map((tile) => tile.creature))
  );
  assert.equal(placementsOverlap(placements), false);
});

test("placeCreatures keeps mixed-size organic footprints separated on a normal canvas", () => {
  const tiles = [
    makeTile(0, "repo-0-", 4, 3),
    makeTile(1, "repo-1-xxxxx", 5, 2),
    makeTile(2, "repo-2-", 5, 2),
    makeTile(3, "repo-3-xxxxx", 5, 3),
    makeTile(4, "repo-4-", 6, 2),
    makeTile(5, "repo-5-xxxxx", 5, 3),
    makeTile(6, "repo-6-", 4, 3),
    makeTile(7, "repo-7-xxxxx", 4, 3),
    makeTile(8, "repo-8-", 4, 3)
  ];
  const placements = placeCreatures(
    tiles,
    80,
    24,
    stableCreatureIdsKey(tiles.map((tile) => tile.creature))
  );
  assert.equal(placements.length, tiles.length);
  assert.equal(placementsOverlap(placements), false);
});

test("placeCreatures adds rows before reusing slots when the canvas can still fit everyone", () => {
  const tiles = Array.from({ length: 15 }, (_, i) => makeTile(i, `repo-${i}`, 6, 4));
  const placements = placeCreatures(
    tiles,
    80,
    24,
    stableCreatureIdsKey(tiles.map((tile) => tile.creature))
  );
  assert.equal(placements.length, tiles.length);
  assert.equal(placementsOverlap(placements), false);
});

// Inter-creature overlap including the rendered name label, not just the
// sprite body. Long names center under the sprite and can extend past
// `spriteCols` on either side; without label-aware footprints the
// neighbouring sprite's body cells get painted over.
const placementsOverlapFull = (placements: ReturnType<typeof placeCreatures>): boolean => {
  const footprints = placements.map((placement) => spriteFullFootprint(placement));
  for (let i = 0; i < footprints.length; i += 1) {
    for (let j = i + 1; j < footprints.length; j += 1) {
      if (spriteBodyFootprintsOverlap(footprints[i], footprints[j])) return true;
    }
  }
  return false;
};

test("placeCreatures does not let long names paint into neighbouring sprite bodies", () => {
  // Names visibly longer than the sprite (label = name.length + 2 ≈ 14
  // cells vs spriteCols=6). Pre-fix, the body-only overlap check passed
  // but labels collided with the adjacent slot's body in row N and the
  // sprite below in row N+1. Tile count + canvas chosen so the scene
  // fits comfortably without forcing slot reuse.
  const tiles = Array.from({ length: 6 }, (_, i) =>
    makeTile(i, `long-repo-name-${i}`, 6, 4)
  );
  const placements = placeCreatures(
    tiles,
    100,
    28,
    stableCreatureIdsKey(tiles.map((tile) => tile.creature))
  );
  assert.equal(placements.length, tiles.length);
  assert.equal(
    placementsOverlapFull(placements),
    false,
    "label-aware footprints must not overlap"
  );
});

test("placeCreatures handles 20 creatures on a roomy canvas without label-vs-body collisions", () => {
  const tiles = Array.from({ length: 20 }, (_, i) => makeTile(i, `repo-${i}`, 4, 3));
  const placements = placeCreatures(
    tiles,
    100,
    30,
    stableCreatureIdsKey(tiles.map((tile) => tile.creature))
  );
  assert.equal(placements.length, tiles.length);
  assert.equal(placementsOverlap(placements), false);
  assert.equal(
    placementsOverlapFull(placements),
    false,
    "labels must not overlap adjacent sprite bodies when the canvas can fit everyone"
  );
});

test("spriteFullFootprint extends the body to include the centred label row", () => {
  const tile = makeTile(0, "hello-world", 6, 3); // label = 13 cells
  const placement = { tile, x: 10, charY: 4 };
  const body = spriteBodyFootprint(placement);
  const full = spriteFullFootprint(placement);
  // Body bounds unchanged on top/left/right when label is wider.
  assert.equal(full.top, body.top);
  // Full footprint extends down past the body to the name row.
  assert.ok(full.bottom > body.bottom, "full footprint should reach the name row");
  // 13-cell label centred under a 6-cell sprite extends past both edges.
  assert.ok(full.left < body.left, "wide label should extend left of the sprite");
  assert.ok(full.right > body.right, "wide label should extend right of the sprite");
});

test("stableCreatureIdsKey ignores creature order", () => {
  const ids = [{ id: "gamma" }, { id: "alpha" }, { id: "beta" }];
  assert.equal(stableCreatureIdsKey(ids), "alpha|beta|gamma");
  assert.equal(stableCreatureIdsKey([...ids].reverse()), "alpha|beta|gamma");
});

test("gardenPageCapacity grows with canvas area", () => {
  const small = gardenPageCapacity(40, 12);
  const large = gardenPageCapacity(120, 30);
  assert.ok(large > small, `expected larger canvas (${large}) to hold more than small (${small})`);
  assert.ok(small >= 1);
});

test("gardenPageCapacity discounts dead-zone slots", () => {
  const open = gardenPageCapacity(120, 30);
  const obstructed = gardenPageCapacity(120, 30, { width: 40, height: 14 });
  assert.ok(obstructed < open, `expected dead zone to reduce capacity (open=${open}, obstructed=${obstructed})`);
  assert.ok(obstructed >= 1);
});

test("gardenPageCapacity never returns zero even on a tiny canvas", () => {
  assert.equal(gardenPageCapacity(10, 5), 1);
});

test("paginateCreatures returns a single empty page for an empty list", () => {
  const pages = paginateCreatures<string>([], 5);
  assert.equal(pages.length, 1);
  assert.deepEqual(pages[0], []);
});

test("paginateCreatures keeps a single page when capacity covers everything", () => {
  const items = ["a", "b", "c"];
  const pages = paginateCreatures(items, 10);
  assert.equal(pages.length, 1);
  assert.deepEqual(pages[0], items);
});

test("paginateCreatures splits into multiple pages and preserves every item exactly once", () => {
  const items = Array.from({ length: 11 }, (_, i) => `item-${i}`);
  const pages = paginateCreatures(items, 4);
  assert.equal(pages.length, 3);
  assert.deepEqual(pages[0].length, 4);
  assert.deepEqual(pages[1].length, 4);
  assert.deepEqual(pages[2].length, 3);
  const flat = pages.flat();
  assert.deepEqual(flat, items);
});

test("paginateCreatures treats non-positive capacity as 1 to avoid infinite loops", () => {
  const pages = paginateCreatures(["a", "b", "c"], 0);
  assert.equal(pages.length, 3);
  assert.deepEqual(pages.flat(), ["a", "b", "c"]);
});
