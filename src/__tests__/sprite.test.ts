import test from "node:test";
import assert from "node:assert/strict";

import type { ScannedRepo } from "../lib/scanner";
import {
  buildCreatureSizeCohort,
  creatureCharSize,
  generateCreature,
  generateCreatureFrames,
  quadrantChar,
  type SubMatrix
} from "../lib/sprite";

const matrixKey = (matrix: SubMatrix): string =>
  matrix.map((row) => row.join("")).join("\n");

const assertMirrored = (matrix: SubMatrix): void => {
  for (const row of matrix) {
    for (let x = 0; x < row.length; x += 1) {
      assert.equal(row[x], row[row.length - 1 - x]);
    }
  }
};

const densityOf = (matrix: SubMatrix): number => {
  const on = matrix.flat().filter((pixel) => pixel === 1).length;
  return on / Math.max(1, matrix.length * (matrix[0]?.length ?? 1));
};

const nonEmptyRowWidths = (matrix: SubMatrix): number[] =>
  matrix
    .map((row) => row.filter((pixel) => pixel === 1).length)
    .filter((width) => width > 0);

const distinctRowWidths = (matrix: SubMatrix): number =>
  new Set(nonEmptyRowWidths(matrix)).size;

const connectedComponentCount = (matrix: SubMatrix): number => {
  const h = matrix.length;
  const w = matrix[0]?.length ?? 0;
  const seen = Array.from({ length: h }, () => Array.from({ length: w }, () => false));
  let count = 0;

  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (matrix[y][x] !== 1 || seen[y][x]) continue;
      count += 1;
      const queue = [{ y, x }];
      seen[y][x] = true;
      for (let head = 0; head < queue.length; head += 1) {
        const pixel = queue[head];
        for (const [dy, dx] of [
          [-1, 0],
          [1, 0],
          [0, -1],
          [0, 1]
        ] as const) {
          const ny = pixel.y + dy;
          const nx = pixel.x + dx;
          if (ny < 0 || ny >= h || nx < 0 || nx >= w) continue;
          if (seen[ny][nx] || matrix[ny][nx] !== 1) continue;
          seen[ny][nx] = true;
          queue.push({ y: ny, x: nx });
        }
      }
    }
  }

  return count;
};

const smallInternalEyeCuts = (matrix: SubMatrix): number => {
  let cuts = 0;
  const maxY = matrix.length - 1;

  for (let y = 1; y < maxY; y += 1) {
    for (let x = 1; x < matrix[0].length - 1; x += 1) {
      if (matrix[y][x] !== 0) continue;
      const hasLeft = matrix[y][x - 1] === 1;
      const hasRight = matrix[y][x + 1] === 1;
      const hasAbove = matrix[y - 1][x] === 1;
      const hasBelow = matrix[y + 1]?.[x] === 1;
      const surrounded = hasLeft && hasRight && hasAbove && hasBelow;
      if (surrounded) cuts += 1;
    }
  }

  return cuts;
};

const internalUpperEyeCuts = (matrix: SubMatrix): number => {
  let cuts = 0;
  const maxY = matrix.length - 1;
  for (let y = 1; y < maxY; y += 1) {
    for (let x = 1; x < matrix[0].length - 1; x += 1) {
      if (matrix[y][x] !== 0) continue;
      const hasBodyToLeft = matrix[y].slice(0, x).some((pixel) => pixel === 1);
      const hasBodyToRight = matrix[y].slice(x + 1).some((pixel) => pixel === 1);
      const cappedByBody = matrix[y - 1][x] === 1 && matrix[y + 1]?.[x] === 1;
      if (hasBodyToLeft && hasBodyToRight && cappedByBody) cuts += 1;
    }
  }
  return cuts;
};

const occupiedBounds = (matrix: SubMatrix): { width: number; height: number } => {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (let y = 0; y < matrix.length; y += 1) {
    for (let x = 0; x < matrix[0].length; x += 1) {
      if (matrix[y][x] !== 1) continue;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }

  if (!Number.isFinite(minX)) return { width: 0, height: 0 };
  return { width: maxX - minX + 1, height: maxY - minY + 1 };
};

const repo = (commitCount: number, path: string): ScannedRepo => ({
  id: path,
  path,
  name: path.split("/").at(-1) ?? path,
  isDirty: false,
  commitCount
});

test("generateCreature is deterministic, mirrored, and dimension-stable", () => {
  const first = generateCreature("/tmp/alpha", 9, 6);
  const second = generateCreature("/tmp/alpha", 9, 6);

  assert.deepEqual(first, second);
  assert.equal(first.length, 12);
  assert.equal(first[0].length, 18);
  assertMirrored(first);
});

test("creature body generation produces non-rectangular silhouette variance", () => {
  const creatures = [
    "/tmp/alpha",
    "/tmp/beta",
    "/tmp/gamma",
    "/tmp/delta",
    "/tmp/epsilon",
    "/tmp/zeta",
    "/tmp/eta",
    "/tmp/theta",
    "/tmp/iota",
    "/tmp/kappa"
  ].map((identity) => generateCreature(identity, 10, 6));

  const uniqueSilhouettes = new Set(creatures.map(matrixKey));
  assert.ok(uniqueSilhouettes.size >= 8);

  const clearlyNonRectangular = creatures.filter((creature) => distinctRowWidths(creature) >= 4);
  assert.ok(clearlyNonRectangular.length >= 8);

  for (const creature of creatures) {
    const density = densityOf(creature);
    assert.ok(density > 0.12, `density ${density} is too sparse`);
    assert.ok(density < 0.82, `density ${density} is too dense`);
    assertMirrored(creature);
    assert.equal(connectedComponentCount(creature), 1);
  }
});

test("creatures keep tiny internal eyes instead of wide bob holes", () => {
  const creatures = [
    "/tmp/alpha",
    "/tmp/beta",
    "/tmp/gamma",
    "/tmp/delta",
    "/tmp/epsilon",
    "/tmp/zeta",
    "/tmp/eta",
    "/tmp/theta",
    "/tmp/iota",
    "/tmp/kappa",
    "/tmp/lambda",
    "/tmp/mu"
  ].map((identity) => generateCreature(identity, 9, 6));

  const readableFaces = creatures.filter((creature) => smallInternalEyeCuts(creature) >= 2);
  assert.ok(readableFaces.length >= 10, `expected at least 10 tiny-eyed faces, got ${readableFaces.length}`);
});

test("generated sprites never leave floaty disconnected parts", () => {
  for (const size of [
    [4, 3],
    [6, 4],
    [9, 6],
    [12, 7],
    [15, 9]
  ] as const) {
    for (let i = 0; i < 40; i += 1) {
      const creature = generateCreature(`/tmp/no-float-${size[0]}x${size[1]}-${i}`, size[0], size[1]);
      assert.equal(connectedComponentCount(creature), 1, `${size[0]}x${size[1]} creature ${i} disconnected`);
      assert.ok(
        smallInternalEyeCuts(creature) >= 2 || internalUpperEyeCuts(creature) >= 2,
        `${size[0]}x${size[1]} creature ${i} has outside/uncapped eyes`
      );
    }
  }
});

test("creatureCharSize gives cohort-relative visual spread across repo activity levels", () => {
  const repos = [0, 1, 3, 8, 20, 80, 300, 1500].map((commitCount) =>
    repo(commitCount, `/tmp/repo-${commitCount}`)
  );
  const cohort = buildCreatureSizeCohort(repos);
  const sizes = repos.map((scan) => creatureCharSize(scan, undefined, cohort));
  const areas = sizes.map(({ charW, charH }) => charW * charH);

  assert.ok(Math.min(...sizes.map((size) => size.charW)) >= 4);
  assert.ok(Math.min(...sizes.map((size) => size.charH)) >= 2);
  assert.ok(Math.max(...sizes.map((size) => size.charW)) <= 15);
  assert.ok(Math.max(...sizes.map((size) => size.charH)) <= 7);
  assert.ok(Math.max(...areas) >= Math.min(...areas) * 4);
  assert.ok(new Set(sizes.map(({ charW, charH }) => `${charW}x${charH}`)).size >= 6);
  assert.ok(areas.at(-1)! > areas[0]);
});

test("generateCreatureFrames preserves symmetry and dimensions", () => {
  const { frameA, frameB } = generateCreatureFrames("/tmp/steppy", 10, 6);

  assert.equal(frameA.length, frameB.length);
  assert.equal(frameA[0].length, frameB[0].length);
  assertMirrored(frameA);
  assertMirrored(frameB);
  assert.equal(connectedComponentCount(frameA), 1);
  assert.equal(connectedComponentCount(frameB), 1);
});

test("footed creatures bob the body up and down between frames", () => {
  let bobbed = 0;
  let tipWiggled = 0;

  for (let i = 0; i < 40; i += 1) {
    const id = `/tmp/bob-${i}`;
    const { frameA, frameB } = generateCreatureFrames(id, 10, 6);
    const h = frameA.length;
    const w = frameA[0].length;

    let diffCount = 0;
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        if (frameA[y][x] !== frameB[y][x]) diffCount += 1;
      }
    }

    // A whole-body shift produces many more pixel diffs than a tip wiggle.
    if (diffCount >= 6) {
      bobbed += 1;
      // Foot row should be identical for bobbed creatures — only the body
      // above the floor moves.
      for (let x = 0; x < w; x += 1) {
        assert.equal(
          frameA[h - 1][x],
          frameB[h - 1][x],
          `creature ${i} foot row diverged at column ${x}`
        );
      }
    } else if (diffCount > 0) {
      tipWiggled += 1;
    }
  }

  assert.ok(bobbed >= 8, `expected several footed creatures to bob, got ${bobbed}`);
  assert.ok(tipWiggled >= 3, `expected some creatures to keep the limb-tip wiggle, got ${tipWiggled}`);
});

test("some creatures grow their legs from zero to one sub-pixel", () => {
  let legGrew = 0;

  for (let i = 0; i < 80; i += 1) {
    const id = `/tmp/legext-${i}`;
    const { frameA, frameB } = generateCreatureFrames(id, 10, 7);
    const h = frameA.length;
    const w = frameA[0].length;

    let topRowsIdentical = true;
    for (let y = 0; y < h - 1 && topRowsIdentical; y += 1) {
      for (let x = 0; x < w; x += 1) {
        if (frameA[y][x] !== frameB[y][x]) {
          topRowsIdentical = false;
          break;
        }
      }
    }

    let floorRowGrew = false;
    for (let x = 0; x < w; x += 1) {
      if (frameA[h - 1][x] === 1 && frameB[h - 1][x] === 0) {
        floorRowGrew = true;
        break;
      }
    }

    if (topRowsIdentical && floorRowGrew) legGrew += 1;
  }

  assert.ok(legGrew >= 5, `expected several leg-extending creatures, got ${legGrew}`);
});

test("creature limbs animate in a mix of horizontal and vertical directions", () => {
  let horizontal = 0;
  let vertical = 0;

  for (let i = 0; i < 120; i += 1) {
    const id = `/tmp/variance-${i}`;
    const { frameA, frameB } = generateCreatureFrames(id, 10, 6);
    const w = frameA[0].length;
    const leftDiffs: { y: number; x: number }[] = [];

    for (let y = 0; y < frameA.length; y += 1) {
      for (let x = 0; x < Math.floor(w / 2); x += 1) {
        if (frameA[y][x] !== frameB[y][x]) leftDiffs.push({ y, x });
      }
    }

    // Skip bobbing creatures (many diffs) — they're covered by their own test.
    if (leftDiffs.length === 0 || leftDiffs.length > 2) continue;

    if (leftDiffs.length === 1) {
      // Extending arm: a single sub-pixel appears/disappears on the stem's
      // row, which reads as horizontal motion.
      horizontal += 1;
    } else if (leftDiffs[0].y === leftDiffs[1].y && leftDiffs[0].x !== leftDiffs[1].x) {
      horizontal += 1;
    } else if (leftDiffs[0].x === leftDiffs[1].x && leftDiffs[0].y !== leftDiffs[1].y) {
      vertical += 1;
    }
  }

  // Diversity smoke test, not a strict invariant — counts can drift a
  // little when other parts of `createState` change RNG-derived
  // body geometry (e.g., eye offsets feeding `randomContour`).
  assert.ok(horizontal >= 5, `expected horizontal-motion limbs, got ${horizontal}`);
  assert.ok(vertical >= 3, `expected vertical-motion limbs, got ${vertical}`);
});

test("generateCreatureFrames animates a single mirrored appendage tip", () => {
  for (let i = 0; i < 24; i += 1) {
    const { frameA, frameB } = generateCreatureFrames(`/tmp/wiggle-${i}`, 10, 6);
    const w = frameA[0].length;

    let diffCount = 0;
    for (let y = 0; y < frameA.length; y += 1) {
      for (let x = 0; x < w; x += 1) {
        if (frameA[y][x] !== frameB[y][x]) diffCount += 1;
        const mirrored = frameA[y][w - 1 - x] !== frameB[y][w - 1 - x];
        const here = frameA[y][x] !== frameB[y][x];
        assert.equal(here, mirrored, `creature ${i} diff at (${y},${x}) not mirrored`);
      }
    }

    assert.ok(diffCount > 0, `creature ${i} has no animation`);
    assert.ok(diffCount % 2 === 0, `creature ${i} diff is not mirrored (${diffCount} pixels)`);
    assert.equal(connectedComponentCount(frameA), 1, `creature ${i} frame A disconnected`);
    assert.equal(connectedComponentCount(frameB), 1, `creature ${i} frame B disconnected`);
  }
});

test("creatures are vertically normalized for terminal pixel aspect ratio", () => {
  const creatures = Array.from({ length: 24 }, (_, i) =>
    generateCreature(`/tmp/aspect-${i}`, 10, 6)
  );

  const squatEnough = creatures.filter((creature) => {
    const bounds = occupiedBounds(creature);
    if (bounds.width === 0 || bounds.height === 0) return false;
    return bounds.height / bounds.width <= 1.15;
  });

  assert.ok(
    squatEnough.length >= 18,
    `expected most creatures to be visually squashed for terminal aspect ratio, got ${squatEnough.length}`
  );
});

test("quadrantChar maps empty and full cells", () => {
  assert.equal(quadrantChar(false, false, false, false), " ");
  assert.equal(quadrantChar(true, true, true, true), "█");
});

// ---------------------------------------------------------------------------
// eyesClosed variant
// ---------------------------------------------------------------------------

const countZeros = (matrix: SubMatrix): number => {
  let n = 0;
  for (const row of matrix) for (const cell of row) if (cell === 0) n += 1;
  return n;
};

test("generateCreatureFrames reports eye cell coordinates inside sprite bounds", () => {
  // Sleepy-eye overlay paints at these cell positions; the renderer
  // assumes they are valid (0..charW-1, 0..charH-1) coordinates.
  for (let i = 0; i < 8; i += 1) {
    const id = `/tmp/eye-cells-${i}`;
    const { eyeCells } = generateCreatureFrames(id, 6, 4);
    for (const frame of [eyeCells.frameA, eyeCells.frameB]) {
      for (const eye of [frame.left, frame.right]) {
        assert.ok(eye.cx >= 0 && eye.cx < 6, `creature ${i} eye cx=${eye.cx} out of range`);
        assert.ok(eye.cy >= 0 && eye.cy < 4, `creature ${i} eye cy=${eye.cy} out of range`);
      }
      // Eyes sit on the same row, distinct columns.
      assert.equal(frame.left.cy, frame.right.cy, `creature ${i} eyes on different rows`);
      assert.notEqual(frame.left.cx, frame.right.cx, `creature ${i} eyes share a cell`);
    }
  }
});

test("generateCreatureFrames eye cells track the body bob across frames", () => {
  // For body-bobbing creatures with even eyeRow, frame A's eye cell
  // sits one row higher than frame B's so the closed-eye glyph moves
  // with the bouncing body. Sample a wide range of seeds so we hit at
  // least a few bobbers — counts will vary by RNG.
  let bobbersWithFrameDiff = 0;
  for (let i = 0; i < 80; i += 1) {
    const { eyeCells } = generateCreatureFrames(`/tmp/bob-${i}`, 6, 4);
    if (eyeCells.frameA.left.cy !== eyeCells.frameB.left.cy) {
      bobbersWithFrameDiff += 1;
      // The bob shift is exactly one row up.
      assert.equal(eyeCells.frameA.left.cy, eyeCells.frameB.left.cy - 1);
      assert.equal(eyeCells.frameA.right.cy, eyeCells.frameB.right.cy - 1);
    }
  }
  assert.ok(
    bobbersWithFrameDiff > 0,
    "expected at least one body-bobbing creature in 80 samples to shift eye cells between frames"
  );
});
