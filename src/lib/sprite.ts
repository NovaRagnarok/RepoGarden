import type { ScannedRepo } from "@/lib/scanner";

export type SubPixel = 0 | 1;
export type SubMatrix = SubPixel[][];

export const hashString = (input: string): number => {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

export const mulberry32 = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const choose = <T,>(items: readonly T[], rng: () => number): T => {
  if (items.length === 0) throw new Error("cannot choose from an empty list");
  return items[Math.floor(rng() * items.length)];
};

const emptyGrid = (subW: number, subH: number): SubMatrix =>
  Array.from({ length: subH }, () => Array.from({ length: subW }, () => 0 as SubPixel));

const setPixel = (grid: SubMatrix, y: number, x: number, value: SubPixel): void => {
  if (y < 0 || y >= grid.length) return;
  if (x < 0 || x >= grid[0].length) return;
  grid[y][x] = value;
};

const setMirrored = (grid: SubMatrix, y: number, leftX: number, value: SubPixel): void => {
  if (y < 0 || y >= grid.length) return;
  const subW = grid[0].length;
  const x = Math.round(clamp(leftX, 0, subW - 1));
  grid[y][x] = value;
  grid[y][subW - 1 - x] = value;
};

const pixelKey = (y: number, x: number): string => `${y}:${x}`;

interface Pixel {
  y: number;
  x: number;
}

const CARDINAL_NEIGHBORS: readonly (readonly [number, number])[] = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1]
];

type BobStyle = "none" | "bodyBob" | "legExtend";

interface GeneratorState {
  charW: number;
  charH: number;
  subW: number;
  subH: number;
  halfW: number;
  centerLeft: number;
  centerRight: number;
  bodyTop: number;
  bodyBottom: number;
  eyeRow: number;
  eyeLeft: number;
  eyeRight: number;
  rowLeftEdges: number[];
  rowRightEdges: number[];
  protectedZeros: Set<string>;
  bobStyle: BobStyle;
}

const rowHasFill = (grid: SubMatrix, y: number): boolean =>
  y >= 0 && y < grid.length && grid[y].some((pixel) => pixel === 1);

const firstFilledX = (grid: SubMatrix, y: number): number | null => {
  if (y < 0 || y >= grid.length) return null;
  for (let x = 0; x < grid[0].length; x += 1) {
    if (grid[y][x] === 1) return x;
  }
  return null;
};

const lastFilledX = (grid: SubMatrix, y: number): number | null => {
  if (y < 0 || y >= grid.length) return null;
  for (let x = grid[0].length - 1; x >= 0; x -= 1) {
    if (grid[y][x] === 1) return x;
  }
  return null;
};

const fillRow = (grid: SubMatrix, state: GeneratorState, y: number, left: number, right: number): void => {
  const safeLeft = Math.round(clamp(left, 0, state.centerLeft));
  const safeRight = Math.round(clamp(right, state.centerRight, state.subW - 1));
  for (let x = safeLeft; x <= safeRight; x += 1) {
    grid[y][x] = 1;
  }
  state.rowLeftEdges[y] = Math.min(state.rowLeftEdges[y] ?? safeLeft, safeLeft);
  state.rowRightEdges[y] = Math.max(state.rowRightEdges[y] ?? safeRight, safeRight);
};

const drawMirroredBridge = (grid: SubMatrix, from: Pixel, to: Pixel): void => {
  const subW = grid[0].length;
  const halfW = Math.floor(subW / 2);
  const normalize = (x: number): number => Math.round(clamp(Math.min(x, subW - 1 - x), 0, halfW - 1));

  let x = normalize(from.x);
  let y = Math.round(clamp(from.y, 0, grid.length - 1));
  const targetX = normalize(to.x);
  const targetY = Math.round(clamp(to.y, 0, grid.length - 1));

  setMirrored(grid, y, x, 1);
  while (x !== targetX) {
    x += x < targetX ? 1 : -1;
    setMirrored(grid, y, x, 1);
  }
  while (y !== targetY) {
    y += y < targetY ? 1 : -1;
    setMirrored(grid, y, x, 1);
  }
};

const connectedComponents = (grid: SubMatrix): Pixel[][] => {
  const subH = grid.length;
  const subW = grid[0]?.length ?? 0;
  const seen = Array.from({ length: subH }, () => Array.from({ length: subW }, () => false));
  const components: Pixel[][] = [];

  for (let y = 0; y < subH; y += 1) {
    for (let x = 0; x < subW; x += 1) {
      if (grid[y][x] !== 1 || seen[y][x]) continue;
      const queue: Pixel[] = [{ y, x }];
      const component: Pixel[] = [];
      seen[y][x] = true;

      for (let head = 0; head < queue.length; head += 1) {
        const pixel = queue[head];
        component.push(pixel);
        for (const [dy, dx] of CARDINAL_NEIGHBORS) {
          const ny = pixel.y + dy;
          const nx = pixel.x + dx;
          if (ny < 0 || ny >= subH || nx < 0 || nx >= subW) continue;
          if (seen[ny][nx] || grid[ny][nx] !== 1) continue;
          seen[ny][nx] = true;
          queue.push({ y: ny, x: nx });
        }
      }

      components.push(component);
    }
  }

  return components;
};

const nearestPair = (a: readonly Pixel[], b: readonly Pixel[]): { a: Pixel; b: Pixel } => {
  let bestA = a[0];
  let bestB = b[0];
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const pa of a) {
    for (const pb of b) {
      const distance = Math.abs(pa.y - pb.y) + Math.abs(pa.x - pb.x);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestA = pa;
        bestB = pb;
      }
    }
  }

  return { a: bestA, b: bestB };
};

const repairDisconnectedPixels = (grid: SubMatrix, protectedZeros: ReadonlySet<string> = new Set()): void => {
  for (let pass = 0; pass < 16; pass += 1) {
    const components = connectedComponents(grid).sort((a, b) => b.length - a.length);
    if (components.length <= 1) return;

    const main = components[0];
    const stray = components[1];
    const pair = nearestPair(stray, main);
    const subW = grid[0].length;
    const halfW = Math.floor(subW / 2);
    const normalize = (x: number): number => Math.round(clamp(Math.min(x, subW - 1 - x), 0, halfW - 1));

    let x = normalize(pair.a.x);
    let y = pair.a.y;
    const targetX = normalize(pair.b.x);
    const targetY = pair.b.y;

    const paint = () => {
      const mirrorX = subW - 1 - x;
      if (!protectedZeros.has(pixelKey(y, x))) setPixel(grid, y, x, 1);
      if (!protectedZeros.has(pixelKey(y, mirrorX))) setPixel(grid, y, mirrorX, 1);
    };

    paint();
    while (x !== targetX) {
      x += x < targetX ? 1 : -1;
      paint();
    }
    while (y !== targetY) {
      y += y < targetY ? 1 : -1;
      paint();
    }
  }

  const components = connectedComponents(grid).sort((a, b) => b.length - a.length);
  for (const component of components.slice(1)) {
    for (const pixel of component) {
      if (!protectedZeros.has(pixelKey(pixel.y, pixel.x))) setPixel(grid, pixel.y, pixel.x, 0);
    }
  }
};

const randomBodyWindow = (
  charW: number,
  charH: number,
  rng: () => number
): { top: number; bottom: number; bobStyle: BobStyle } => {
  const subH = charH * 2;
  // Three idle styles for footed creatures:
  //   - bodyBob: body shifts up one sub-pixel between frames.
  //   - legExtend: body stays put; foot row "grows" downward so the leg
  //     toggles between zero and one sub-pixel of height.
  //   - none: no foot reserve; the limb tip wiggle is the whole animation.
  // legExtend needs an extra row below the body, so it only kicks in for
  // taller tiles where the body can still read as a creature.
  const r = rng();
  let bobStyle: BobStyle = "none";
  let footReserve = 0;
  if (charH >= 5 && r < 0.3) {
    bobStyle = "legExtend";
    footReserve = 2;
  } else if (charH >= 4 && r < 0.6) {
    bobStyle = "bodyBob";
    footReserve = 1;
  }
  const bottom = subH - 1 - footReserve;
  const targetRows = Math.round(clamp(subH * (0.54 + rng() * 0.20), 4, bottom + 1));
  const top = Math.max(0, bottom - targetRows + 1);
  return { top, bottom, bobStyle };
};

const createState = (charW: number, charH: number, rng: () => number): GeneratorState => {
  const subW = charW * 2;
  const subH = charH * 2;
  const halfW = Math.floor(subW / 2);
  const centerLeft = halfW - 1;
  const centerRight = halfW;
  const { top, bottom, bobStyle } = randomBodyWindow(charW, charH, rng);
  // Cap eyeRow so the cell *directly below* the eye cell still fits
  // inside the sprite. The closed-eye face panel paints with bg=body
  // and a glyph at the bottom of the cell; if the cell below is empty,
  // the panel reads as a dangling dark bar instead of a closed eyelid
  // resting on the face. Cell row of eye must be ≤ charH − 2.
  const maxEyeRow = (charH - 2) * 2 + 1;
  const eyeRow = Math.round(
    clamp(
      top + 1 + Math.floor(rng() * Math.max(1, Math.min(3, bottom - top))),
      top + 1,
      Math.min(bottom - 1, maxEyeRow)
    )
  );
  const maxEyeOffset = Math.max(1, Math.min(centerLeft - 1, Math.floor(charW * 0.24)));
  let eyeOffset = 1 + Math.floor(rng() * maxEyeOffset);
  let eyeLeft = centerLeft - eyeOffset;
  let eyeRight = centerRight + eyeOffset;
  // Eye cells must be at least one cell apart so the closed-eye glyphs
  // don't render in adjacent cells (they'd read as a single connected
  // bar instead of two distinct eyes). Bump `eyeOffset` outward until
  // the cell distance is ≥ 2, capped by `centerLeft − 1` so eyeLeft
  // stays at least 1 sub-pixel inside the body.
  const cellOf = (subPos: number) => Math.floor(subPos / 2);
  while (
    cellOf(eyeRight) - cellOf(eyeLeft) < 2 &&
    eyeOffset < centerLeft - 1
  ) {
    eyeOffset += 1;
    eyeLeft = centerLeft - eyeOffset;
    eyeRight = centerRight + eyeOffset;
  }

  return {
    charW,
    charH,
    subW,
    subH,
    halfW,
    centerLeft,
    centerRight,
    bodyTop: top,
    bodyBottom: bottom,
    eyeRow,
    eyeLeft,
    eyeRight,
    rowLeftEdges: Array.from({ length: subH }, () => subW),
    rowRightEdges: Array.from({ length: subH }, () => -1),
    protectedZeros: new Set<string>(),
    bobStyle
  };
};

const randomContour = (state: GeneratorState, rng: () => number): number[] => {
  const rows = state.bodyBottom - state.bodyTop + 1;
  const minHalf = Math.max(2, Math.min(3, state.halfW - 1));
  const maxHalf = Math.max(minHalf, state.halfW - (rng() < 0.22 ? 0 : 1));
  const contour: number[] = Array.from({ length: state.subH }, () => minHalf);

  const topWidth = clamp(minHalf + Math.floor(rng() * Math.max(1, state.halfW * 0.32)), minHalf, maxHalf);
  const bottomWidth = clamp(minHalf + Math.floor(rng() * Math.max(1, state.halfW * 0.45)), minHalf, maxHalf);
  const lobeCount = 2 + Math.floor(rng() * 4);
  const lobes = Array.from({ length: lobeCount }, () => ({
    center: rng(),
    radius: 0.10 + rng() * 0.34,
    strength: (rng() < 0.76 ? 1 : -1) * (0.6 + rng() * 2.8)
  }));

  let walk = (rng() - 0.5) * 1.5;
  for (let y = state.bodyTop; y <= state.bodyBottom; y += 1) {
    const t = rows <= 1 ? 0 : (y - state.bodyTop) / (rows - 1);
    let width = topWidth * (1 - t) + bottomWidth * t;

    for (const lobe of lobes) {
      const z = (t - lobe.center) / lobe.radius;
      width += lobe.strength * Math.exp(-0.5 * z * z);
    }

    walk += (rng() - 0.5) * 1.35;
    walk *= 0.55;
    width += walk;

    // Keep one-row edge movement; this keeps the mask retro-pixelated while
    // still making each identity look generated rather than categorized.
    const previous = y > state.bodyTop ? contour[y - 1] : width;
    width = clamp(width, previous - 2, previous + 2);
    contour[y] = Math.round(clamp(width, minHalf, maxHalf));
  }

  // Guarantee enough face material for tiny single-pixel eyes without making
  // eyes larger. The eyes stay one sub-pixel holes.
  for (let y = Math.max(state.bodyTop, state.eyeRow - 1); y <= Math.min(state.bodyBottom, state.eyeRow + 1); y += 1) {
    contour[y] = Math.max(contour[y], state.centerLeft - state.eyeLeft + 2);
  }

  return contour;
};

const stampBody = (grid: SubMatrix, state: GeneratorState, rng: () => number): void => {
  const contour = randomContour(state, rng);
  const fillBias = 0.70 + rng() * 0.24;
  const raggedness = 0.10 + rng() * 0.22;

  for (let y = state.bodyTop; y <= state.bodyBottom; y += 1) {
    const halfWidth = contour[y];
    const left = state.centerLeft - halfWidth + 1;
    const right = state.centerRight + halfWidth - 1;

    for (let x = left; x <= state.centerLeft; x += 1) {
      const fromCenter = (state.centerLeft - x) / Math.max(1, halfWidth);
      const fromEye = Math.abs(y - state.eyeRow) / Math.max(1, state.bodyBottom - state.bodyTop);
      const p = fillBias - fromCenter * (0.14 + raggedness) - fromEye * 0.18;
      if (x >= state.centerLeft - 1 || rng() < p) {
        setMirrored(grid, y, x, 1);
      }
    }

    // Connected central spine, not a family-shaped body.
    setMirrored(grid, y, state.centerLeft, 1);
    setMirrored(grid, y, Math.max(0, state.centerLeft - 1), 1);

    // Fill short spans around the face so eyes are internal but stay tiny.
    if (y >= state.eyeRow - 1 && y <= state.eyeRow + 1) {
      fillRow(grid, state, y, Math.max(0, state.eyeLeft - 1), Math.min(state.subW - 1, state.eyeRight + 1));
    }

    const rowLeft = firstFilledX(grid, y);
    const rowRight = lastFilledX(grid, y);
    if (rowLeft !== null && rowRight !== null) {
      state.rowLeftEdges[y] = rowLeft;
      state.rowRightEdges[y] = rowRight;
    }
  }

  // Randomly carve symmetric side chips and interior pinholes. Keep the face
  // row protected so the eyes never become edge cutouts.
  for (let y = state.bodyTop + 1; y <= state.bodyBottom - 1; y += 1) {
    if (Math.abs(y - state.eyeRow) <= 1) continue;
    const left = firstFilledX(grid, y);
    if (left === null || left >= state.centerLeft - 1) continue;

    if (rng() < 0.42) setMirrored(grid, y, left, 0);
    if (rng() < 0.14 && left + 1 < state.centerLeft - 1) setMirrored(grid, y, left + 1, 0);

    if (rng() < 0.16) {
      const pocketX = clamp(left + 2 + Math.floor(rng() * Math.max(1, state.centerLeft - left - 2)), 1, state.centerLeft - 1);
      setMirrored(grid, y, pocketX, 0);
    }
  }

  for (let y = state.bodyTop; y <= state.bodyBottom; y += 1) {
    if (!rowHasFill(grid, y)) {
      setMirrored(grid, y, state.centerLeft, 1);
      setMirrored(grid, y, Math.max(0, state.centerLeft - 1), 1);
    }
    state.rowLeftEdges[y] = firstFilledX(grid, y) ?? state.centerLeft;
    state.rowRightEdges[y] = lastFilledX(grid, y) ?? state.centerRight;
  }
};

const carveEyes = (grid: SubMatrix, state: GeneratorState): void => {
  // Single sub-pixel eyes. They read as little invader eye slots, not the big
  // square holes that made the previous pass look like identical bobs.
  const eyePixels = [
    { y: state.eyeRow, x: state.eyeLeft },
    { y: state.eyeRow, x: state.eyeRight }
  ];

  for (const eye of eyePixels) {
    setPixel(grid, eye.y, eye.x, 0);
    state.protectedZeros.add(pixelKey(eye.y, eye.x));

    // Ensure every eye is inside body: left/right and above/below are body.
    for (const [dy, dx] of CARDINAL_NEIGHBORS) {
      setPixel(grid, eye.y + dy, eye.x + dx, 1);
    }
  }

  setPixel(grid, state.eyeRow, state.eyeLeft, 0);
  setPixel(grid, state.eyeRow, state.eyeRight, 0);
};

const reinforceEyes = (grid: SubMatrix, state: GeneratorState): void => {
  for (const x of [state.eyeLeft, state.eyeRight]) {
    const y = state.eyeRow;
    for (const [dy, dx] of CARDINAL_NEIGHBORS) {
      setPixel(grid, y + dy, x + dx, 1);
    }
    setPixel(grid, y, x, 0);
  }
};

/** Character-cell coordinates (cx, cy) of the two eyes in the rendered
 *  sprite, derived from the sub-pixel eye positions. Renderers can use
 *  this to overlay a closed-eye glyph at those cells without changing
 *  the underlying body grid. */
export interface SpriteEyeCells {
  left: { cx: number; cy: number };
  right: { cx: number; cy: number };
}

/** Per-frame eye cell positions. `frameA` and `frameB` differ only when
 *  the creature is body-bobbing (frame A's body shifts up one sub-pixel)
 *  AND the eye row's parity puts the shifted eye in a different cell. */
export interface SpriteEyeFrames {
  frameA: SpriteEyeCells;
  frameB: SpriteEyeCells;
}

interface AnimatedLimb {
  stem: Pixel[]; // sub-pixels drawn in both frames; always adjacent to body
  tipA: Pixel;   // tip in frame A (resting pose), adjacent to stem
  tipB: Pixel;   // tip in frame B (waved pose), adjacent to stem
}

const isEmpty = (grid: SubMatrix, y: number, x: number): boolean => {
  if (y < 0 || y >= grid.length) return false;
  if (x < 0 || x >= grid[0].length) return false;
  return grid[y][x] === 0;
};

const isAdjacentToBody = (grid: SubMatrix, y: number, x: number): boolean => {
  for (const [dy, dx] of CARDINAL_NEIGHBORS) {
    const ny = y + dy;
    const nx = x + dx;
    if (ny < 0 || ny >= grid.length) continue;
    if (nx < 0 || nx >= grid[0].length) continue;
    if (grid[ny][nx] === 1) return true;
  }
  return false;
};

const limbAtStem = (
  grid: SubMatrix,
  stem: Pixel,
  preferredTips: readonly Pixel[]
): AnimatedLimb | null => {
  if (!isEmpty(grid, stem.y, stem.x)) return null;
  if (!isAdjacentToBody(grid, stem.y, stem.x)) return null;

  const subH = grid.length;
  const subW = grid[0].length;
  const inBoundsEmpty = (p: Pixel): boolean =>
    p.y >= 0 && p.y < subH && p.x >= 0 && p.x < subW && grid[p.y][p.x] === 0;

  const validPreferred = preferredTips.filter(inBoundsEmpty);
  const neighbors = CARDINAL_NEIGHBORS
    .map(([dy, dx]) => ({ y: stem.y + dy, x: stem.x + dx }))
    .filter(inBoundsEmpty);

  if (validPreferred.length >= 2) {
    return { stem: [stem], tipA: validPreferred[0], tipB: validPreferred[1] };
  }
  if (validPreferred.length === 1) {
    const tipA = validPreferred[0];
    const tipB =
      neighbors.find((p) => p.y !== tipA.y || p.x !== tipA.x) ?? stem;
    return { stem: [stem], tipA, tipB };
  }
  if (neighbors.length === 0) return null;
  const tipA = neighbors[0];
  // Collapse tipB onto stem when there is only one adjacent empty cell —
  // the limb still animates as a "tip appears, tip vanishes" wiggle, and
  // both frames stay fully connected.
  const tipB = neighbors[1] ?? stem;
  return { stem: [stem], tipA, tipB };
};

const planAnimatedLimb = (grid: SubMatrix, state: GeneratorState, rng: () => number): AnimatedLimb => {
  const subH = state.subH;
  const subW = grid[0].length;

  // Antenna: stem one row above the body. Two motion variants:
  //   - diagonal: tip swings straight-up vs. sideways (existing feel).
  //   - horizontal: tip flicks left vs. right at the same row.
  const wantsAntenna = state.bodyTop >= 2 && rng() < 0.65;
  if (wantsAntenna) {
    const bodyLeftAtTop = firstFilledX(grid, state.bodyTop) ?? state.centerLeft;
    const minRoot = Math.max(1, bodyLeftAtTop);
    const horizontalSway = rng() < 0.5;
    // Horizontal sway draws tipB at rootX+1, which would otherwise collide
    // with the mirrored stem at subW-1-rootX when rootX equals centerLeft.
    const maxRoot = horizontalSway
      ? Math.max(minRoot, state.centerLeft - 1)
      : state.centerLeft;
    const span = Math.max(1, maxRoot - minRoot + 1);

    for (let attempts = 0; attempts < 8; attempts += 1) {
      const rootX = minRoot + Math.floor(rng() * span);
      const stem = { y: state.bodyTop - 1, x: rootX };
      const preferred: Pixel[] = horizontalSway
        ? [
            { y: stem.y, x: stem.x - 1 },
            { y: stem.y, x: stem.x + 1 }
          ]
        : [
            { y: stem.y - 1, x: stem.x },
            { y: stem.y, x: stem.x - 1 }
          ];
      const limb = limbAtStem(grid, stem, preferred);
      if (limb) return limb;
    }
  }

  // Side arm: two motion variants:
  //   - vertical: tip swings up vs. down beside the body.
  //   - extending: tip reaches outward then retracts onto the stem so the
  //     arm appears to push out and pull back (left/right relative to body).
  const extendingArm = rng() < 0.45;
  const yRange = Math.max(1, state.bodyBottom - state.bodyTop + 1);
  for (let attempts = 0; attempts < 24; attempts += 1) {
    const y = state.bodyTop + Math.floor(rng() * yRange);
    const bodyLeft = firstFilledX(grid, y);
    const minBodyLeft = extendingArm ? 2 : 1;
    if (bodyLeft === null || bodyLeft < minBodyLeft) continue;
    const stem = { y, x: bodyLeft - 1 };
    const preferred: Pixel[] = extendingArm
      ? [{ y, x: stem.x - 1 }]
      : [
          { y: y - 1, x: stem.x },
          { y: y + 1, x: stem.x }
        ];
    const limb = limbAtStem(grid, stem, preferred);
    if (!limb) continue;
    if (extendingArm) {
      // Collapse tipB onto the stem so the limb retracts in frame B and
      // the diff is a single pair of pixels (tipA on either side).
      return { stem: limb.stem, tipA: limb.tipA, tipB: stem };
    }
    return limb;
  }

  // Brute force: any body-adjacent empty cell on the left half is a viable
  // stem. limbAtStem handles tip selection.
  for (let y = 0; y < subH; y += 1) {
    for (let x = 0; x < Math.floor(subW / 2); x += 1) {
      const limb = limbAtStem(grid, { y, x }, []);
      if (limb) return limb;
    }
  }

  // Pathological: solid creature with no empty body-adjacent cell. Return a
  // degenerate limb that won't draw anything outside body.
  return { stem: [], tipA: { y: 0, x: 0 }, tipB: { y: 0, x: 0 } };
};

const drawLimbStem = (grid: SubMatrix, limb: AnimatedLimb): void => {
  for (const pixel of limb.stem) setMirrored(grid, pixel.y, pixel.x, 1);
};

const drawLimbTip = (grid: SubMatrix, tip: Pixel): void => {
  setMirrored(grid, tip.y, tip.x, 1);
};

const stampLegs = (grid: SubMatrix, state: GeneratorState, rng: () => number): void => {
  const footRow = state.bodyBottom + 1;
  if (footRow >= state.subH || rng() < 0.18) return;
  const legCount = choose([1, 2, 2, 3, 4] as const, rng);
  const maxLeft = Math.max(0, state.centerLeft - 1);
  const bodyLeft = firstFilledX(grid, state.bodyBottom) ?? Math.max(0, state.centerLeft - 2);

  for (let i = 0; i < legCount; i += 1) {
    const t = legCount === 1 ? 0.5 : i / (legCount - 1);
    const base = Math.round(bodyLeft + (maxLeft - bodyLeft) * t + (rng() - 0.5) * 2);
    const legX = clamp(base, bodyLeft, maxLeft);
    setMirrored(grid, footRow, legX, 1);
  }
};

interface CreatureBuild {
  base: SubMatrix; // grid with body, legs, eyes, and limb stem — no tip yet
  limb: AnimatedLimb;
  bobStyle: BobStyle;
  bobbable: boolean; // true only for bodyBob; legExtend is always safe to apply
}

const minLimbY = (limb: AnimatedLimb): number => {
  let m = Math.min(limb.tipA.y, limb.tipB.y);
  for (const p of limb.stem) m = Math.min(m, p.y);
  return m;
};

const shiftBodyAndAddLeg = (grid: SubMatrix): SubMatrix => {
  const h = grid.length;
  const w = grid[0].length;
  const shifted = emptyGrid(w, h);
  // Shift rows [1..h-2] up by one; keep the foot row (h-1) where it is.
  for (let y = 1; y <= h - 2; y += 1) {
    for (let x = 0; x < w; x += 1) {
      shifted[y - 1][x] = grid[y][x];
    }
  }
  for (let x = 0; x < w; x += 1) {
    shifted[h - 1][x] = grid[h - 1][x];
    // Bridge the gap with a leg pixel directly above each foot pixel.
    if (grid[h - 1][x] === 1) shifted[h - 2][x] = 1;
  }
  return shifted;
};

const extendFootDown = (grid: SubMatrix): SubMatrix => {
  // For legExtend creatures the base has body bottom at h-3 and foot at h-2,
  // leaving h-1 empty. Copy the foot row down to h-1 so the existing foot row
  // reads as a leg sub-pixel and a new foot pixel sits on the tile floor.
  const h = grid.length;
  const w = grid[0].length;
  const out = grid.map((row) => [...row]);
  for (let x = 0; x < w; x += 1) {
    if (grid[h - 2][x] === 1) out[h - 1][x] = 1;
  }
  return out;
};

interface CreatureBuildResult extends CreatureBuild {
  eyeCells: SpriteEyeCells;
  /** Eye cells when the body has bobbed up one sub-pixel (frame A of a
   *  bodyBob+bobbable creature). Identical to `eyeCells` when eyeRow
   *  is odd — the shift doesn't cross a cell boundary in that case. */
  shiftedEyeCells: SpriteEyeCells;
}

const buildCreature = (
  identity: string,
  charW: number,
  charH: number
): CreatureBuildResult => {
  const safeCharW = Math.max(3, Math.round(charW));
  const safeCharH = Math.max(2, Math.round(charH));
  const grid = emptyGrid(safeCharW * 2, safeCharH * 2);
  const rng = mulberry32(hashString(identity));
  const state = createState(safeCharW, safeCharH, rng);

  stampBody(grid, state, rng);
  stampLegs(grid, state, rng);
  const limb = planAnimatedLimb(grid, state, rng);
  drawLimbStem(grid, limb);
  carveEyes(grid, state);
  repairDisconnectedPixels(grid, state.protectedZeros);
  reinforceEyes(grid, state);
  repairDisconnectedPixels(grid, state.protectedZeros);
  reinforceEyes(grid, state);
  const eyeCells: SpriteEyeCells = {
    left: { cx: Math.floor(state.eyeLeft / 2), cy: Math.floor(state.eyeRow / 2) },
    right: { cx: Math.floor(state.eyeRight / 2), cy: Math.floor(state.eyeRow / 2) }
  };

  // bodyBob shifts the whole body up one sub-pixel; only safe if no limb
  // pixel sits on row 0. legExtend doesn't shift anything, so it's always
  // safe to apply when the style is chosen.
  const bobbable = state.bobStyle === "bodyBob" && minLimbY(limb) >= 1;

  // bodyBob shifts the body up one sub-pixel in frame A. The closed-eye
  // overlay paints at cell coordinates, so when the body bobs the
  // overlay needs to bob with it — otherwise the eyelid stays glued to
  // its original cell while the face slides away. Pre-compute the
  // shifted eye cells here so the renderer can pick per frame without
  // re-deriving body geometry.
  const shiftedEyeCells: SpriteEyeCells = {
    left: { cx: eyeCells.left.cx, cy: Math.floor((state.eyeRow - 1) / 2) },
    right: { cx: eyeCells.right.cx, cy: Math.floor((state.eyeRow - 1) / 2) }
  };

  return { base: grid, limb, bobStyle: state.bobStyle, bobbable, eyeCells, shiftedEyeCells };
};

export const generateCreature = (
  identity: string,
  charW: number,
  charH: number
): SubMatrix => {
  const { base, limb } = buildCreature(identity, charW, charH);
  const out = base.map((row) => [...row]);
  drawLimbTip(out, limb.tipA);
  return out;
};

export const generateCreatureFrames = (
  identity: string,
  charW: number,
  charH: number
): {
  frameA: SubMatrix;
  frameB: SubMatrix;
  eyeCells: SpriteEyeFrames;
} => {
  // Three mutually-exclusive idle styles per creature:
  //   - bodyBob: body lifts one sub-pixel in frame A; a leg pixel bridges
  //     the new gap to the foot. Limb stays in tipA both frames.
  //   - legExtend: body stays put; frame A copies the foot row downward so
  //     the existing foot pixel becomes a leg and a new foot sits on the
  //     tile floor. Limb stays in tipA both frames.
  //   - none (or unbobbable bodyBob): the limb tip swings between tipA
  //     and tipB as before.
  const { base, limb, bobStyle, bobbable, eyeCells, shiftedEyeCells } =
    buildCreature(identity, charW, charH);
  const frameA = base.map((row) => [...row]);
  const frameB = base.map((row) => [...row]);

  if (bobStyle === "bodyBob" && bobbable) {
    drawLimbTip(frameA, limb.tipA);
    drawLimbTip(frameB, limb.tipA);
    return {
      frameA: shiftBodyAndAddLeg(frameA),
      frameB,
      eyeCells: { frameA: shiftedEyeCells, frameB: eyeCells }
    };
  }
  if (bobStyle === "legExtend") {
    drawLimbTip(frameA, limb.tipA);
    drawLimbTip(frameB, limb.tipA);
    return {
      frameA: extendFootDown(frameA),
      frameB,
      eyeCells: { frameA: eyeCells, frameB: eyeCells }
    };
  }
  drawLimbTip(frameA, limb.tipA);
  drawLimbTip(frameB, limb.tipB);
  return { frameA, frameB, eyeCells: { frameA: eyeCells, frameB: eyeCells } };
};

const QUADRANT_CHARS: Record<number, string> = {
  0b0000: " ",
  0b1000: "▘",
  0b0100: "▝",
  0b1100: "▀",
  0b0010: "▖",
  0b1010: "▌",
  0b0110: "▞",
  0b1110: "▛",
  0b0001: "▗",
  0b1001: "▚",
  0b0101: "▐",
  0b1101: "▜",
  0b0011: "▄",
  0b1011: "▙",
  0b0111: "▟",
  0b1111: "█"
};

export const quadrantChar = (
  tl: boolean,
  tr: boolean,
  bl: boolean,
  br: boolean
): string => {
  const mask = (tl ? 8 : 0) | (tr ? 4 : 0) | (bl ? 2 : 0) | (br ? 1 : 0);
  return QUADRANT_CHARS[mask];
};

export interface CreatureSizeCohort {
  /** Sorted ascending list of every cohort member's mass value. Enables
   *  O(log n) rank lookup for rank-based size normalization. */
  sortedMasses: readonly number[];
  count: number;
}

// Pure "mass" — how much stuff is in the repo, not how alive it is. Vitality
// signals (recentCommitDays, ahead/behind, isDirty) deliberately don't appear
// here; they belong to mood/confidence, not size.
//
// Primary signal: log1p(sourceLines) — newline-counted LOC across recognized
// source files, post-SKIP_DIRS/noise filtering. LOC over byte size so a file
// padded with long base64 blobs doesn't read as massive, and verbose-line
// languages (Java/TS) don't get an unfair boost over terse ones (Python/Go).
// Secondary: log1p(fileCount), so a repo of many small files reads larger
// than a repo of one big file with the same LOC. commitCount sticks around
// as a faint tiebreaker / fallback when scanRepoTree hasn't populated stats
// yet (Phase 3 extras race with first paint).
const creatureActivityMass = (repo: ScannedRepo): number => {
  const sourceLines = Math.max(0, repo.sourceLines ?? 0);
  const fileCount = Math.max(0, repo.fileCount ?? 0);
  const commitCount = Math.max(0, repo.commitCount ?? 0);
  if (sourceLines === 0 && fileCount === 0) {
    return Math.log1p(commitCount) * 0.5;
  }
  return (
    Math.log1p(sourceLines) +
    Math.log1p(fileCount) * 0.45 +
    Math.log1p(commitCount) * 0.08
  );
};

export const buildCreatureSizeCohort = (
  repos: readonly ScannedRepo[]
): CreatureSizeCohort | undefined => {
  if (repos.length === 0) return undefined;
  const masses = repos.map(creatureActivityMass).filter(Number.isFinite);
  if (masses.length === 0) return undefined;
  return {
    sortedMasses: [...masses].sort((a, b) => a - b),
    count: masses.length
  };
};

// log1p(1_000_000) ≈ 13.8 — a ~1M LOC repo lands near absolute=1.0. Only used
// as a fallback for tiny cohorts (count < 3); the rank-based path doesn't
// need it.
const ABSOLUTE_MASS_DIVISOR = Math.log1p(1_000_000);

// Lower-bound binary search: returns the index where `mass` would be inserted
// into the sorted list, which is also the count of strictly-smaller masses.
// Ties resolve to the earliest matching index so identical-mass repos share
// a rank rather than fighting for position.
const massRank = (sortedMasses: readonly number[], mass: number): number => {
  let lo = 0;
  let hi = sortedMasses.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sortedMasses[mid] < mass) lo = mid + 1;
    else hi = mid;
  }
  return lo;
};

// Rank-based normalization: the smallest repo in a cohort is always at 0, the
// largest at 1, and everyone else is spread evenly by rank. This is robust to
// skewed mass distributions — if 30 repos cluster at similar LOC plus 2 are
// huge, the 30 still spread evenly instead of crowding near 0. The downside
// is that the absolute size of a repo no longer matters; size is purely a
// statement about ordering within the cohort.
const normalizedCreatureMass = (repo: ScannedRepo, cohort?: CreatureSizeCohort): number => {
  const mass = creatureActivityMass(repo);
  if (!cohort || cohort.count < 3) {
    return clamp(mass / ABSOLUTE_MASS_DIVISOR, 0, 1);
  }
  return clamp(massRank(cohort.sortedMasses, mass) / (cohort.count - 1), 0, 1);
};

export const creatureCharSize = (
  repo: ScannedRepo,
  hashSeed: number = hashString(repo.path || repo.id),
  cohort?: CreatureSizeCohort
): { charW: number; charH: number } => {
  const rng = mulberry32(hashSeed ^ 0x51a7e);
  const activity = normalizedCreatureMass(repo, cohort);
  const noise = (rng() - 0.5) * (cohort ? 0.16 : 0.28);
  const sizeT = Math.pow(clamp(activity + noise, 0, 1), 0.82);

  const minArea = 10;
  // Ceiling raised 130 → 180 (and the dimension clamps 18×9 → 20×11) so the
  // top of the cohort can read as genuinely chunky — under rank-based
  // scaling, the biggest few repos were all bunched against the previous
  // 130-cell cap. Mid and small creatures barely move (the area→dim
  // conversion goes through a sqrt, so a 38% area bump only widens each
  // dim by ~18% on average at the top; mid-cohort sprites stay close to
  // their previous footprints).
  const maxArea = 180;
  const targetArea = minArea + (maxArea - minArea) * sizeT;

  const aspectRoll = rng();
  let aspect: number;
  if (aspectRoll < 0.12) aspect = 1.15 + rng() * 0.22;
  else if (aspectRoll < 0.52) aspect = 1.65 + rng() * 0.72;
  else aspect = 1.32 + rng() * 0.42;

  let charW = Math.round(Math.sqrt(targetArea * aspect));
  let charH = Math.round(targetArea / Math.max(1, charW));

  charW = Math.round(clamp(charW, 4, 20));
  charH = Math.round(clamp(charH, 2, 11));

  // Terminal cells are tall; bias footprints toward wider-than-tall instead
  // of doing a post-render squash that distorts eyes and turns masks into bobs.
  if (charH > Math.ceil(charW * 0.62)) charH = Math.max(2, Math.ceil(charW * 0.62));
  if (charW < 5 && charH < 3) charH = 3;

  return { charW, charH };
};

// Each vibe picks one of these theme tokens as a "hue anchor"; the per-creature
// hash then rotates around that anchor in HSL space so repos within the same
export interface SpriteColors {
  body: string;
}

/** A theme's creature palette. Hues are picked deterministically per
 *  creature id; saturation + lightness are constant within the palette
 *  (with a tiny lightness jitter for variety) so the palette reads as
 *  cohesive instead of randomly distributed. */
export interface CreaturePalette {
  /** Hue angles (0-359). One picked per identity. */
  hues: readonly number[];
  /** 0-1 — defaults to 0.78 (arcade punch). Drop toward 0.4 for muted
   *  themes like rosepine / gruvbox. */
  saturation?: number;
  /** 0-1 — defaults to 0.6. Bump toward 0.7 for neon themes; drop toward
   *  0.5 for darker themes. */
  lightness?: number;
  /** ± lightness jitter so two creatures landing on the same hue still
   *  read as slightly distinct. Defaults to 0.06. */
  lightnessJitter?: number;
}

/** Arcade default — punchy primaries + cute pop colors, dusty mauve band
 *  (270-340°) deliberately absent. Themes that don't ship their own
 *  creaturePalette fall back to this. */
export const DEFAULT_CREATURE_PALETTE: CreaturePalette = {
  hues: [
    355, // crimson
    10,  // tomato red
    25,  // orange
    45,  // amber
    60,  // yellow
    90,  // lime
    120, // grass green
    155, // mint
    180, // cyan
    205, // sky blue
    235, // royal blue
    265  // electric violet
  ],
  saturation: 0.78,
  lightness: 0.6,
  lightnessJitter: 0.06
};

const parseHexChannel = (hex: string, start: number): number =>
  Number.parseInt(hex.slice(start, start + 2), 16);

const hexToRgb = (hex: string): [number, number, number] => {
  const normalized = hex.startsWith("#") ? hex.slice(1) : hex;
  return [
    parseHexChannel(normalized, 0),
    parseHexChannel(normalized, 2),
    parseHexChannel(normalized, 4)
  ];
};

const rgbToHsl = (r: number, g: number, b: number): [number, number, number] => {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  return [h * 60, s, l];
};

const hslToRgb = (h: number, s: number, l: number): [number, number, number] => {
  const hk = (((h % 360) + 360) % 360) / 360;
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue2rgb = (t: number): number => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  return [
    Math.round(hue2rgb(hk + 1 / 3) * 255),
    Math.round(hue2rgb(hk) * 255),
    Math.round(hue2rgb(hk - 1 / 3) * 255)
  ];
};

const rgbToHex = (r: number, g: number, b: number): string => {
  const clamp = (v: number): string =>
    Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${clamp(r)}${clamp(g)}${clamp(b)}`;
};

export const pickSpriteColors = (
  identity: string,
  palette: CreaturePalette = DEFAULT_CREATURE_PALETTE
): SpriteColors => {
  const hues = palette.hues.length > 0 ? palette.hues : DEFAULT_CREATURE_PALETTE.hues;
  const saturation = palette.saturation ?? DEFAULT_CREATURE_PALETTE.saturation!;
  const lightness = palette.lightness ?? DEFAULT_CREATURE_PALETTE.lightness!;
  const lightnessJitter = palette.lightnessJitter ?? DEFAULT_CREATURE_PALETTE.lightnessJitter!;
  const rng = mulberry32(hashString(`body:${identity}`));
  const hue = hues[Math.floor(rng() * hues.length)] ?? hues[0] ?? 0;
  // Tiny lightness jitter so two creatures landing on the same hue still
  // read as slightly distinct without breaking the cohesive palette feel.
  const delta = (rng() - 0.5) * 2 * lightnessJitter;
  const finalL = Math.max(0.4, Math.min(0.78, lightness + delta));
  const [r, g, b] = hslToRgb(hue, saturation, finalL);
  return { body: rgbToHex(r, g, b) };
};
