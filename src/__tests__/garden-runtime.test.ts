import test from "node:test";
import assert from "node:assert/strict";

import { GardenEngine } from "../garden/engine";
import { diffFrames } from "../garden/diff";
import {
  applyManualGardenPlacement,
  commitManualGardenPlacement,
  createGardenModel,
  findCreatureAtCell,
  findCreatureDragHandleAtCell,
  stepGardenModel,
  syncGardenModel,
  wiggleFrameAt
} from "../garden/model";
import { renderGardenFrame } from "../garden/render";
import type { GardenSceneProps, GardenSpriteInfo } from "../garden/types";
import {
  NAME_GAP_ROWS,
  spriteBodyFootprint,
  spriteBodyFootprintsOverlap,
  type Placement
} from "../lib/garden-layout";

const makeProps = (): GardenSceneProps => ({
  creatures: [
    {
      id: "alpha",
      scan: {
        id: "alpha",
        path: "/tmp/alpha",
        name: "alpha",
        isDirty: false
      } as any,
      memory: {} as any,
      vibe: { vibe: "happy", reason: "clean", activity: 1 } as any
    }
  ],
  focusIndex: 0,
  innerWidth: 28,
  canvasH: 14,
  placementMode: "organic",
  theme: {
    foreground: "#ffffff",
    background: "#000000",
    muted: "#444444",
    mutedForeground: "#777777",
    primary: "#00ff00",
    accent: "#ffff00",
    success: "#00ff00",
    warning: "#ffcc00",
    error: "#ff0000",
    info: "#00ccff"
  }
});

const solidFrame = (charW: number, charH: number): number[][] =>
  Array.from({ length: charH * 2 }, () => Array.from({ length: charW * 2 }, () => 1));

const makePlacement = (
  id: string,
  index: number,
  name: string,
  x: number,
  charY: number,
  spriteCols = 4,
  charRows = 3
): Placement => ({
  tile: {
    creature: {
      id,
      scan: {
        id,
        path: `/tmp/${id}`,
        name,
        isDirty: false
      } as any,
      memory: {} as any,
      vibe: { vibe: "happy", reason: "clean", activity: 1 } as any
    },
    index,
    charW: spriteCols,
    charH: charRows,
    spriteCols,
    charRows
  },
  x,
  charY
});

const makeSprite = (placement: Placement): GardenSpriteInfo => ({
  frameA: solidFrame(placement.tile.spriteCols, placement.tile.charRows),
  frameB: solidFrame(placement.tile.spriteCols, placement.tile.charRows),
  body: "#ffffff",
  charW: placement.tile.spriteCols,
  charH: placement.tile.charRows,
  spriteCols: placement.tile.spriteCols,
  name: placement.tile.creature.scan.name,
  vibeGlyph: "·",
  vibeColor: "#888888",
  wiggle: { halfCycleMs: 1000, phaseMs: 0 },
  // Point default eye cells outside the sprite so tests using
  // hand-rolled tiny frames don't unintentionally trigger the
  // face-panel paint. Tests that *want* to exercise eyes pass real
  // GardenSpriteInfo built via createGardenModel.
  eyeCells: {
    frameA: { left: { cx: -1, cy: -1 }, right: { cx: -1, cy: -1 } },
    frameB: { left: { cx: -1, cy: -1 }, right: { cx: -1, cy: -1 } }
  },
  eyesClosed: false,
  blink: { intervalMs: 5000, durationMs: 140, phaseMs: 0 }
});

const emptySprite = (placement: Placement): GardenSpriteInfo => ({
  ...makeSprite(placement),
  frameA: Array.from({ length: placement.tile.charRows * 2 }, () =>
    Array.from({ length: placement.tile.spriteCols * 2 }, () => 0)
  ),
  frameB: Array.from({ length: placement.tile.charRows * 2 }, () =>
    Array.from({ length: placement.tile.spriteCols * 2 }, () => 0)
  )
});

const overlaps = (left: Placement, right: Placement): boolean => {
  return spriteBodyFootprintsOverlap(spriteBodyFootprint(left), spriteBodyFootprint(right));
};

test("diffFrames returns empty for identical frames", () => {
  const props = makeProps();
  const model = createGardenModel(props, 0);
  const frame = renderGardenFrame(model, 0);
  assert.equal(diffFrames(frame, frame, 1, 1), "");
});

test("diffFrames does not write transparent dead-zone cells", () => {
  const output = diffFrames(
    null,
    {
      width: 3,
      height: 1,
      cells: [
        { char: "A" },
        { char: " ", transparent: true },
        { char: "B" }
      ]
    },
    1,
    1
  );
  assert.match(output, /\x1b\[1;1HA/);
  assert.match(output, /\x1b\[1;3HB/);
  assert.doesNotMatch(output, /\x1b\[1;2H/);
});

test("focused creatures stay anchored across time steps", () => {
  const props = makeProps();
  const model = createGardenModel(props, 0);
  const anchor = model.scene.placements[0];
  stepGardenModel(model, 120_000);
  const visual = model.visualPlacements.get("alpha");
  assert.ok(visual, "missing focused visual placement");
  assert.equal(visual.x, anchor.x);
  assert.equal(visual.charY, anchor.charY);
});

test("renderGardenFrame paints the focused repo name with the primary color", () => {
  const props = makeProps();
  const model = createGardenModel(props, 0);
  const frame = renderGardenFrame(model, 0);
  const primaryCells = frame.cells.filter(
    (cell) => cell.fg === props.theme.primary && /[a-z]/i.test(cell.char)
  );
  assert.ok(primaryCells.length > 0, "expected focused name cells in the primary color");
});

test("renderGardenFrame keeps the dead-zone transparent", () => {
  const deadZone = { width: 8, height: 5 };
  const props: GardenSceneProps = {
    ...makeProps(),
    deadZone
  };
  const model = createGardenModel(props, 0);
  const frame = renderGardenFrame(model, 0);
  for (let y = props.canvasH - deadZone.height; y < props.canvasH; y += 1) {
    for (let x = props.innerWidth - deadZone.width; x < props.innerWidth; x += 1) {
      const cell = frame.cells[y * frame.width + x];
      assert.equal(cell.transparent, true);
    }
  }
});

test("renderGardenFrame leaves creature partial-block backgrounds transparent", () => {
  const placement = makePlacement("alpha", 0, "alpha", 2, 2, 1, 1);
  const model = {
    props: {
      ...makeProps(),
      focusIndex: -1,
      innerWidth: 8,
      canvasH: 6
    },
    scene: {
      placements: [placement],
      dividers: [],
      sprites: new Map<string, GardenSpriteInfo>([
        [
          "alpha",
          {
            ...makeSprite(placement),
            frameA: [
              [1, 0],
              [0, 0]
            ],
            frameB: [
              [1, 0],
              [0, 0]
            ],
            body: "#abcdef"
          }
        ]
      ]),
      sceneSeed: 0
    },
    hoverIndex: -1,
    originX: 0,
    originY: 0,
    visualPlacements: new Map<string, Placement>()
  } as any;

  const frame = renderGardenFrame(model, 0);
  const spriteCell = frame.cells[placement.charY * frame.width + placement.x];
  assert.equal(spriteCell.char, "▘");
  assert.equal(spriteCell.fg, "#abcdef");
  assert.equal(spriteCell.bg, undefined);
});

test("organic garden starts with non-overlapping visual placements for mixed-size creatures", () => {
  const creatures = Array.from({ length: 9 }, (_, i) => ({
    id: `id-${i}`,
    scan: {
      id: `id-${i}`,
      path: `/tmp/${i}`,
      name: `repo-${i}-${"x".repeat((i * 5) % 10)}`,
      isDirty: false
    } as any,
    memory: {} as any,
    vibe: { vibe: (["happy", "awake", "stuck", "sleepy"] as const)[i % 4], reason: "" } as any
  }));
  const props: GardenSceneProps = {
    ...makeProps(),
    creatures,
    focusIndex: -1,
    innerWidth: 80,
    canvasH: 24,
    placementMode: "organic"
  };
  const model = createGardenModel(props, 0);
  const placements = model.scene.placements.map(
    (placement) => model.visualPlacements.get(placement.tile.creature.id) ?? placement
  );

  for (let i = 0; i < placements.length; i += 1) {
    for (let j = i + 1; j < placements.length; j += 1) {
      assert.equal(
        overlaps(placements[i], placements[j]),
        false,
        `expected ${placements[i].tile.creature.id} and ${placements[j].tile.creature.id} not to overlap`
      );
    }
  }
});

test("relocate wanders persist a new home position", () => {
  const originalRandom = Math.random;
  try {
    const props: GardenSceneProps = {
      ...makeProps(),
      focusIndex: -1,
      placementMode: "rooms",
      innerWidth: 40
    };
    const model = createGardenModel(props, 0);
    const sequence = [
      0,    // initial idleUntil
      0,    // relocate chance
      0,    // wander duration
      0,    // outpoint angle
      0.5,  // outpoint radius => x ~= +1.6 => rounds to +2
      0     // next idleUntil after relocate completes
    ];
    let index = 0;
    Math.random = () => sequence[index++] ?? 0;
    const anchor = model.scene.placements[0];
    stepGardenModel(model, 1);
    stepGardenModel(model, 10_001);
    stepGardenModel(model, 20_000);
    const visual = model.visualPlacements.get("alpha");
    const state = model.wander.get("alpha");
    assert.ok(visual, "missing relocated visual placement");
    assert.ok(state, "missing relocated wander state");
    assert.equal(state.persistentOffset.y, 0);
    assert.ok(state.persistentOffset.x > 0, "expected persistent x relocation");
    assert.ok(visual.x > anchor.x, "expected visual placement to move right");
    assert.equal(visual.charY, anchor.charY);
  } finally {
    Math.random = originalRandom;
  }
});

test("garden-to-shelf layout changes tween creature placements instead of hard-swapping", () => {
  const props: GardenSceneProps = {
    ...makeProps(),
    creatures: [
      {
        id: "alpha",
        scan: { id: "alpha", path: "/tmp/alpha", name: "alpha", isDirty: false } as any,
        memory: {} as any,
        vibe: { vibe: "happy", reason: "clean", activity: 1 } as any
      },
      {
        id: "beta",
        scan: { id: "beta", path: "/tmp/beta", name: "beta", isDirty: false } as any,
        memory: {} as any,
        vibe: { vibe: "awake", reason: "dirty" } as any
      },
      {
        id: "gamma",
        scan: { id: "gamma", path: "/tmp/gamma", name: "gamma", isDirty: false } as any,
        memory: {} as any,
        vibe: { vibe: "sleepy", reason: "quiet" } as any
      }
    ],
    innerWidth: 48,
    canvasH: 18,
    focusIndex: -1,
    placementMode: "organic"
  };
  const model = createGardenModel(props, 0);
  const before = model.visualPlacements.get("alpha");
  assert.ok(before, "missing initial placement");

  syncGardenModel(model, { ...props, placementMode: "rooms" }, 100);
  const target = model.scene.placements.find((placement) => placement.tile.creature.id === "alpha");
  const during = model.visualPlacements.get("alpha");
  assert.ok(target, "missing target placement");
  assert.ok(during, "missing tweened placement");
  assert.notDeepEqual(
    { x: during.x, charY: during.charY },
    { x: target.x, charY: target.charY },
    "expected transition to start away from the final shelf placement"
  );

  stepGardenModel(model, 700);
  const midway = model.visualPlacements.get("alpha");
  assert.ok(midway, "missing midpoint placement");
  assert.notDeepEqual(
    { x: midway.x, charY: midway.charY },
    { x: before.x, charY: before.charY },
    "expected tween to move away from the original organic placement"
  );

  stepGardenModel(model, 1_600);
  const settled = model.visualPlacements.get("alpha");
  assert.ok(settled, "missing settled placement");
  assert.deepEqual(
    { x: settled.x, charY: settled.charY },
    { x: target.x, charY: target.charY }
  );
});

test("findCreatureAtCell ignores the empty gap between adjacent creatures", () => {
  const left = makePlacement("alpha", 0, "alpha", 10, 5);
  const right = makePlacement("beta", 1, "beta", 15, 5);
  const model = {
    scene: {
      placements: [left, right],
      sprites: new Map([
        ["alpha", makeSprite(left)],
        ["beta", makeSprite(right)]
      ])
    },
    visualPlacements: new Map<string, Placement>()
  } as any;

  const hit = findCreatureAtCell(model, 14, 6);
  assert.equal(hit, undefined);
});

test("findCreatureAtCell still hits visible sprite and label cells", () => {
  const placement = makePlacement("alpha", 0, "alpha", 10, 5);
  const model = {
    scene: {
      placements: [placement],
      sprites: new Map([["alpha", makeSprite(placement)]])
    },
    visualPlacements: new Map<string, Placement>()
  } as any;

  assert.equal(findCreatureAtCell(model, 10, 5)?.tile.creature.id, "alpha");
  const nameRow = placement.charY + placement.tile.charRows + NAME_GAP_ROWS;
  assert.equal(findCreatureAtCell(model, 10, nameRow)?.tile.creature.id, "alpha");
  assert.equal(findCreatureAtCell(model, 10, nameRow - 1), undefined);
});

test("findCreatureDragHandleAtCell hits transparent cells inside the sprite box", () => {
  const placement = makePlacement("alpha", 0, "alpha", 10, 5);
  const model = {
    scene: {
      placements: [placement],
      sprites: new Map([["alpha", emptySprite(placement)]])
    },
    visualPlacements: new Map<string, Placement>()
  } as any;

  assert.equal(findCreatureAtCell(model, 11, 6), undefined);
  assert.equal(findCreatureDragHandleAtCell(model, 11, 6)?.tile.creature.id, "alpha");
});

test("GardenEngine commits active drag on button-code-3 release", () => {
  const writes: string[] = [];
  const stdout = {
    write: (chunk: string) => {
      writes.push(chunk);
      return true;
    }
  } as any;
  const changes: Array<{ creature: { id: string }; offset: { offsetX: number; offsetY: number } }> = [];
  const engine = new GardenEngine(stdout, {
    ...makeProps(),
    focusIndex: -1,
    originRow: 1,
    originCol: 1,
    onCreaturePlacementChange: (next) => changes.push(...next)
  });

  try {
    const model = (engine as any).model;
    const placement = model.scene.placements[0] as Placement;
    engine.handleMouse({
      kind: "press",
      button: "left",
      row: 1 + placement.charY,
      col: 1 + placement.x
    });
    engine.handleMouse({
      kind: "drag",
      button: "left",
      row: 1 + placement.charY,
      col: 1 + placement.x + 2
    });
    engine.handleMouse({
      kind: "release",
      button: "unknown",
      row: 1 + placement.charY,
      col: 1 + placement.x + 2
    });

    assert.equal(changes.length, 1);
    assert.equal(changes[0].creature.id, "alpha");
    assert.deepEqual(changes[0].offset, { offsetX: 2, offsetY: 0 });
  } finally {
    engine.destroy();
  }
});

test("GardenEngine commits the squishy preview when strict resolution fails on release", () => {
  // Two creatures placed flush against the right wall so a drag of the
  // left one onto the right one has nowhere to push to. The strict
  // resolver returns null in that case; before the fix, the user's drag
  // silently snapped back. The squishy preview is what the user saw on
  // screen, so it is what we commit.
  const writes: string[] = [];
  const stdout = { write: (chunk: string) => (writes.push(chunk), true) } as any;
  const changes: Array<{ creature: { id: string }; offset: { offsetX: number; offsetY: number } }> = [];
  const engine = new GardenEngine(stdout, {
    ...makeProps(),
    focusIndex: -1,
    originRow: 1,
    originCol: 1,
    innerWidth: 16,
    canvasH: 10,
    creatures: [
      {
        id: "alpha",
        scan: { id: "alpha", path: "/tmp/alpha", name: "alpha", isDirty: false } as any,
        memory: {} as any,
        vibe: { vibe: "happy", reason: "", activity: 1 } as any
      },
      {
        id: "beta",
        scan: { id: "beta", path: "/tmp/beta", name: "beta", isDirty: false } as any,
        memory: {} as any,
        vibe: { vibe: "happy", reason: "", activity: 1 } as any
      }
    ],
    onCreaturePlacementChange: (next) => changes.push(...next)
  });

  try {
    const model = (engine as any).model;
    const placements = model.scene.placements as Placement[];
    const alpha = placements.find((p) => p.tile.creature.id === "alpha");
    const beta = placements.find((p) => p.tile.creature.id === "beta");
    assert.ok(alpha && beta, "expected both creatures placed");

    // Drag alpha onto beta. Pick a target row inside beta's body so the
    // resolved candidate definitively overlaps something the strict
    // policy refuses.
    const targetCol = 1 + beta.x;
    const targetRow = 1 + beta.charY;
    engine.handleMouse({
      kind: "press",
      button: "left",
      row: 1 + alpha.charY,
      col: 1 + alpha.x
    });
    engine.handleMouse({
      kind: "drag",
      button: "left",
      row: targetRow,
      col: targetCol
    });
    engine.handleMouse({
      kind: "release",
      button: "unknown",
      row: targetRow,
      col: targetCol
    });

    // Some change must have been committed — even if the strict resolver
    // gave up, the user's drag should not silently vanish.
    assert.ok(changes.length > 0, "drag onto a packed neighbour committed nothing");
    const alphaChange = changes.find((c) => c.creature.id === "alpha");
    assert.ok(alphaChange, "alpha did not receive a placement change");
    assert.ok(
      alphaChange.offset.offsetX !== 0 || alphaChange.offset.offsetY !== 0,
      "alpha committed a zero offset — drag snapped back"
    );
  } finally {
    engine.destroy();
  }
});

test("GardenEngine commits a prior drag when a fresh press arrives without a release", () => {
  // A release event can be lost when the cursor leaves the terminal mid-drag.
  // The next press should not destroy the in-flight drag's progress.
  const writes: string[] = [];
  const stdout = { write: (chunk: string) => (writes.push(chunk), true) } as any;
  const changes: Array<{ creature: { id: string }; offset: { offsetX: number; offsetY: number } }> = [];
  const engine = new GardenEngine(stdout, {
    ...makeProps(),
    focusIndex: -1,
    originRow: 1,
    originCol: 1,
    onCreaturePlacementChange: (next) => changes.push(...next)
  });

  try {
    const model = (engine as any).model;
    const placement = model.scene.placements[0] as Placement;

    engine.handleMouse({
      kind: "press",
      button: "left",
      row: 1 + placement.charY,
      col: 1 + placement.x
    });
    engine.handleMouse({
      kind: "drag",
      button: "left",
      row: 1 + placement.charY,
      col: 1 + placement.x + 3
    });
    // No release. User clicks again — this should commit the prior drag
    // rather than throwing it away.
    engine.handleMouse({
      kind: "press",
      button: "left",
      row: 1 + placement.charY,
      col: 1 + placement.x + 3
    });

    assert.equal(changes.length, 1);
    assert.equal(changes[0].creature.id, "alpha");
    assert.deepEqual(changes[0].offset, { offsetX: 3, offsetY: 0 });
  } finally {
    engine.destroy();
  }
});

test("GardenEngine setProps with identical scene fields does not disturb an in-flight drag", () => {
  // A mid-drag re-render (toast pop, background scan tick, any
  // unmemoized callback in the React tree) was tearing down
  // `dragPreviewPlacements` and resetting every wander state's
  // `manualOffset` back to the last committed memory value. The
  // engine's `drag` pointer survived but pointed into a wiped model —
  // the user's drag silently undid itself.
  const writes: string[] = [];
  const stdout = { write: (chunk: string) => (writes.push(chunk), true) } as any;
  const baseProps = {
    ...makeProps(),
    focusIndex: -1,
    originRow: 1,
    originCol: 1,
    onCreatureSelect: () => {},
    onFocusDelta: () => {}
  };
  const changes: Array<{ creature: { id: string }; offset: { offsetX: number; offsetY: number } }> = [];
  const engine = new GardenEngine(stdout, {
    ...baseProps,
    onCreaturePlacementChange: (next) => changes.push(...next)
  });

  try {
    const model = (engine as any).model;
    const placement = model.scene.placements[0] as Placement;
    engine.handleMouse({
      kind: "press",
      button: "left",
      row: 1 + placement.charY,
      col: 1 + placement.x
    });
    engine.handleMouse({
      kind: "drag",
      button: "left",
      row: 1 + placement.charY,
      col: 1 + placement.x + 4
    });
    // Mid-drag setProps with semantically identical scene fields but a
    // fresh callback identity (simulating a parent re-render).
    engine.setProps({
      ...baseProps,
      onCreaturePlacementChange: (next) => changes.push(...next)
    });
    // Preview must still be present after the spurious re-sync.
    assert.ok(
      (model as any).dragPreviewPlacements,
      "in-flight drag preview was wiped by a spurious setProps"
    );
    engine.handleMouse({
      kind: "release",
      button: "unknown",
      row: 1 + placement.charY,
      col: 1 + placement.x + 4
    });

    assert.equal(changes.length, 1);
    assert.equal(changes[0].creature.id, "alpha");
    assert.deepEqual(changes[0].offset, { offsetX: 4, offsetY: 0 });
  } finally {
    engine.destroy();
  }
});

test("GardenEngine drag math is independent of the creature's wander bob at press time", () => {
  // Grab offset used to be measured against the visual placement
  // (which includes wander.currentOffset). That baked the wander bob
  // into the persisted offset, so a small drag on a wandering creature
  // landed 1–2 cells off where the cursor was released.
  const writes: string[] = [];
  const stdout = { write: (chunk: string) => (writes.push(chunk), true) } as any;
  const changes: Array<{ creature: { id: string }; offset: { offsetX: number; offsetY: number } }> = [];
  const engine = new GardenEngine(stdout, {
    ...makeProps(),
    focusIndex: -1,
    originRow: 1,
    originCol: 1,
    onCreaturePlacementChange: (next) => changes.push(...next)
  });

  try {
    const model = (engine as any).model;
    const anchor = model.scene.placements[0] as Placement;
    // Force a non-zero wander bob on the creature at press time.
    const wanderState = {
      profile: { idleMin: 1000, idleMax: 2000 },
      phase: "idle",
      idleUntil: Number.POSITIVE_INFINITY,
      currentOffset: { x: 2, y: 0 },
      persistentOffset: { x: 0, y: 0 },
      manualOffset: undefined
    };
    (model.wander as Map<string, unknown>).set(anchor.tile.creature.id, wanderState);
    // Force the visual placement to reflect that bob (so the user
    // clicks where the wandering creature visibly is).
    const visualX = anchor.x + 2;
    model.visualPlacements.set(anchor.tile.creature.id, {
      ...anchor,
      x: visualX,
      charY: anchor.charY
    });

    engine.handleMouse({
      kind: "press",
      button: "left",
      row: 1 + anchor.charY,
      col: 1 + visualX
    });
    // Drag 3 cells right. User expects the persisted offset to reflect
    // a 3-cell move, not 3+bob.
    engine.handleMouse({
      kind: "drag",
      button: "left",
      row: 1 + anchor.charY,
      col: 1 + visualX + 3
    });
    engine.handleMouse({
      kind: "release",
      button: "unknown",
      row: 1 + anchor.charY,
      col: 1 + visualX + 3
    });

    assert.equal(changes.length, 1);
    assert.deepEqual(
      changes[0].offset,
      { offsetX: 3, offsetY: 0 },
      "committed offset must equal cursor delta, not cursor delta + wander bob"
    );
  } finally {
    engine.destroy();
  }
});

test("GardenEngine resize does not clear the whole old canvas", () => {
  const writes: string[] = [];
  const stdout = {
    write: (chunk: string) => {
      writes.push(chunk);
      return true;
    }
  } as any;
  const props = {
    ...makeProps(),
    focusIndex: -1,
    originRow: 1,
    originCol: 1
  };
  const engine = new GardenEngine(stdout, props);

  try {
    writes.length = 0;
    engine.setProps({
      ...props,
      canvasH: props.canvasH + 2,
      deadZone: { width: 8, height: props.canvasH + 2 }
    });

    assert.equal(writes.length, 1);
    assert.doesNotMatch(writes[0], new RegExp(`\\x1b\\[1;1H {${props.innerWidth}}`));
  } finally {
    engine.destroy();
  }
});

test("GardenEngine keeps full-repainting briefly after resize", () => {
  const writes: string[] = [];
  const stdout = {
    write: (chunk: string) => {
      writes.push(chunk);
      return true;
    }
  } as any;
  const props = {
    ...makeProps(),
    focusIndex: -1,
    originRow: 1,
    originCol: 1
  };
  const engine = new GardenEngine(stdout, props);

  try {
    engine.setProps({ ...props, canvasH: props.canvasH + 2 });
    writes.length = 0;
    (engine as any).render(performance.now() + 100);

    assert.equal(writes.length, 1);
  } finally {
    engine.destroy();
  }
});

test("syncGardenModel rejects wander positions that would overlap another creature", () => {
  const props: GardenSceneProps = {
    ...makeProps(),
    creatures: [
      {
        id: "alpha",
        scan: { id: "alpha", path: "/tmp/alpha", name: "alpha", isDirty: false } as any,
        memory: {} as any,
        vibe: { vibe: "happy", reason: "clean", activity: 1 } as any
      },
      {
        id: "beta",
        scan: { id: "beta", path: "/tmp/beta", name: "beta", isDirty: false } as any,
        memory: {} as any,
        vibe: { vibe: "happy", reason: "clean", activity: 1 } as any
      }
    ],
    focusIndex: -1,
    innerWidth: 40,
    canvasH: 14,
    placementMode: "rooms"
  };
  const model = createGardenModel(props, 0);
  const alphaAnchor = model.scene.placements.find((placement) => placement.tile.creature.id === "alpha");
  const betaAnchor = model.scene.placements.find((placement) => placement.tile.creature.id === "beta");
  assert.ok(alphaAnchor, "missing alpha anchor");
  assert.ok(betaAnchor, "missing beta anchor");

  model.wander.set("alpha", {
    kind: "relocate",
    phase: "idle",
    idleUntil: Number.POSITIVE_INFINITY,
    wanderStartedAt: 0,
    wanderDurationMs: 0,
    outpoint: { x: 0, y: 0 },
    currentOffset: { x: 0, y: 0 },
    profile: { idleMin: 1000, idleMax: 2000, wanderMin: 500, wanderMax: 1000, radiusX: 1, radiusY: 1 },
    persistentOffset: {
      x: betaAnchor.x - alphaAnchor.x,
      y: betaAnchor.charY - alphaAnchor.charY
    }
  });

  syncGardenModel(model, props, 0);
  const alphaVisual = model.visualPlacements.get("alpha");
  const betaVisual = model.visualPlacements.get("beta");
  assert.ok(alphaVisual, "missing alpha visual placement");
  assert.ok(betaVisual, "missing beta visual placement");
  assert.notDeepEqual(
    { x: alphaVisual.x, charY: alphaVisual.charY },
    { x: betaAnchor.x, charY: betaAnchor.charY },
    "expected alpha not to move directly onto beta's anchor"
  );
  assert.equal(overlaps(alphaVisual, betaVisual), false);
});

test("syncGardenModel rejects wander positions that would move into the overlay dead zone", () => {
  const props: GardenSceneProps = {
    ...makeProps(),
    deadZone: { width: 10, height: 5 },
    focusIndex: -1,
    innerWidth: 28,
    canvasH: 14,
    placementMode: "organic"
  };
  const model = createGardenModel(props, 0);
  const anchor = model.scene.placements[0];
  assert.ok(anchor, "missing creature anchor");

  model.wander.set("alpha", {
    kind: "relocate",
    phase: "idle",
    idleUntil: Number.POSITIVE_INFINITY,
    wanderStartedAt: 0,
    wanderDurationMs: 0,
    outpoint: { x: 0, y: 0 },
    currentOffset: { x: 0, y: 0 },
    profile: { idleMin: 1000, idleMax: 2000, wanderMin: 500, wanderMax: 1000, radiusX: 1, radiusY: 1 },
    persistentOffset: { x: 20, y: 8 }
  });

  syncGardenModel(model, props, 0);
  const visual = model.visualPlacements.get("alpha");
  assert.ok(visual, "missing visual placement");
  const deadLeft = props.innerWidth - props.deadZone!.width;
  const deadTop = props.canvasH - props.deadZone!.height;
  const spriteRight = visual.x + visual.tile.spriteCols;
  const spriteBottom = visual.charY + visual.tile.charRows;
  assert.equal(
    spriteRight >= deadLeft && spriteBottom >= deadTop,
    false,
    "expected creature to stay out of the overlay dead zone"
  );
  assert.deepEqual(
    { x: visual.x, charY: visual.charY },
    { x: anchor.x, charY: anchor.charY },
    "expected dead-zone collision to fall back to the anchored placement"
  );
});

test("organic garden applies persisted manual creature placement offsets", () => {
  const props: GardenSceneProps = {
    ...makeProps(),
    focusIndex: -1,
    creatures: [
      {
        id: "alpha",
        scan: { id: "alpha", path: "/tmp/alpha", name: "alpha", isDirty: false } as any,
        memory: { gardenPlacement: { offsetX: 2, offsetY: 1 } },
        vibe: { vibe: "happy", reason: "clean", activity: 1 } as any
      }
    ],
    innerWidth: 40,
    canvasH: 16,
    placementMode: "organic"
  };
  const model = createGardenModel(props, 0);
  const anchor = model.scene.placements[0];
  const visual = model.visualPlacements.get("alpha");
  assert.ok(visual, "missing visual placement");
  assert.deepEqual(
    { x: visual.x, charY: visual.charY },
    { x: anchor.x + 2, charY: anchor.charY + 1 }
  );
});

const CLOSED_EYE_GLYPH = "▂";

const activeEyesForFrame = (
  info: GardenSpriteInfo,
  now: number
): GardenSpriteInfo["eyeCells"]["frameA"] =>
  wiggleFrameAt(info.wiggle, now) === 1 ? info.eyeCells.frameB : info.eyeCells.frameA;

test("renderGardenFrame paints sleepy eyes as a thick low bar on a body-coloured face panel", () => {
  const model = createGardenModel(
    {
      ...makeProps(),
      focusIndex: -1,
      creatures: [
        {
          id: "alpha",
          scan: { id: "alpha", path: "/tmp/alpha", name: "alpha", isDirty: false } as any,
          memory: {} as any,
          vibe: { vibe: "sleepy", reason: "quiet for 30 days.", daysSinceCommit: 30, activity: 0.05 } as any
        }
      ]
    },
    0
  );
  const info = model.scene.sprites.get("alpha");
  assert.ok(info, "missing sprite info");
  assert.equal(info.eyesClosed, true);
  const placement = model.scene.placements[0];
  const frame = renderGardenFrame(model, 0);
  const cellAt = (x: number, y: number) =>
    frame.cells[y * frame.width + x];
  const eyes = activeEyesForFrame(info, 0);
  const leftCell = cellAt(placement.x + eyes.left.cx, placement.charY + eyes.left.cy);
  assert.equal(leftCell?.char, CLOSED_EYE_GLYPH, "sleepy left eye should render `_`");
  assert.equal(leftCell?.bg, info.body, "sleepy eye cell should fill bg with body colour");
  const rightCell = cellAt(placement.x + eyes.right.cx, placement.charY + eyes.right.cy);
  assert.equal(rightCell?.char, CLOSED_EYE_GLYPH, "sleepy right eye should render `_`");
  assert.equal(rightCell?.bg, info.body, "sleepy eye cell should fill bg with body colour");
});

test("renderGardenFrame paints awake eyes as `•` between blinks", () => {
  const model = createGardenModel(
    {
      ...makeProps(),
      focusIndex: -1,
      creatures: [
        {
          id: "alpha",
          scan: { id: "alpha", path: "/tmp/alpha", name: "alpha", isDirty: false } as any,
          memory: {} as any,
          vibe: { vibe: "happy", reason: "clean.", activity: 1 } as any
        }
      ]
    },
    0
  );
  const info = model.scene.sprites.get("alpha");
  assert.ok(info, "missing sprite info");
  assert.equal(info.eyesClosed, false);
  const placement = model.scene.placements[0];
  // Pick a `now` outside the blink window so the open eye paints
  // (= the body grid's natural quadrant char, not the closed-eye
  // overlay). Blink fires when (now + phaseMs) % intervalMs < durationMs.
  const now = info.blink.intervalMs / 2 - info.blink.phaseMs;
  const frame = renderGardenFrame(model, now);
  const cellAt = (x: number, y: number) =>
    frame.cells[y * frame.width + x];
  const eyes = activeEyesForFrame(info, now);
  const leftCell = cellAt(placement.x + eyes.left.cx, placement.charY + eyes.left.cy);
  // Awake eye keeps the original quadrant block char produced by the
  // sprite's body grid (no face-panel overlay). The cell should not
  // carry the closed glyph and should not have a body-coloured bg.
  assert.notEqual(leftCell?.char, CLOSED_EYE_GLYPH, "awake eye should not render the closed glyph");
  assert.equal(leftCell?.bg, undefined, "awake eye cell should not paint a body-coloured bg");
  assert.equal(leftCell?.fg, info.body, "awake eye cell should still render in body colour");
});

test("renderGardenFrame paints awake eyes closed during the blink window", () => {
  const model = createGardenModel(
    {
      ...makeProps(),
      focusIndex: -1,
      creatures: [
        {
          id: "alpha",
          scan: { id: "alpha", path: "/tmp/alpha", name: "alpha", isDirty: false } as any,
          memory: {} as any,
          vibe: { vibe: "happy", reason: "clean.", activity: 1 } as any
        }
      ]
    },
    0
  );
  const info = model.scene.sprites.get("alpha");
  assert.ok(info, "missing sprite info");
  // Pick now so the blink window is active: now + phaseMs ≡ 0 (mod interval).
  const now = info.blink.intervalMs - info.blink.phaseMs;
  const placement = model.scene.placements[0];
  const frame = renderGardenFrame(model, now);
  const eyes = activeEyesForFrame(info, now);
  const leftCell = frame.cells[
    (placement.charY + eyes.left.cy) * frame.width +
      (placement.x + eyes.left.cx)
  ];
  assert.equal(leftCell?.char, CLOSED_EYE_GLYPH, "awake creature should show closed glyph during blink");
});

test("renderGardenFrame holds sleepy creatures at frame B so the body bob doesn't drag the closed eye", () => {
  const model = createGardenModel(
    {
      ...makeProps(),
      focusIndex: -1,
      creatures: [
        {
          id: "alpha",
          scan: { id: "alpha", path: "/tmp/alpha", name: "alpha", isDirty: false } as any,
          memory: {} as any,
          vibe: { vibe: "sleepy", reason: "quiet for 30 days.", daysSinceCommit: 30, activity: 0.05 } as any
        }
      ]
    },
    0
  );
  const info = model.scene.sprites.get("alpha");
  if (!info) throw new Error("missing sprite info");
  const placement = model.scene.placements[0];
  // Sample times across two wiggle cycles. Whatever the wiggle timer
  // says, the sleepy creature should always paint its closed eye at
  // frame B's eye cell position — never frame A's.
  const expectedX: number = placement.x + info.eyeCells.frameB.left.cx;
  const expectedY: number = placement.charY + info.eyeCells.frameB.left.cy;
  for (let i = 0; i < 8; i += 1) {
    const now: number = (info.wiggle.halfCycleMs * i) / 2;
    const frame = renderGardenFrame(model, now);
    const cell = frame.cells[expectedY * frame.width + expectedX];
    assert.equal(
      cell?.char,
      CLOSED_EYE_GLYPH,
      `sleepy creature's closed-eye glyph drifted away from frame B at now=${now}`
    );
  }
});

test("renderGardenFrame keeps sleepy eyes closed regardless of blink timing", () => {
  const model = createGardenModel(
    {
      ...makeProps(),
      focusIndex: -1,
      creatures: [
        {
          id: "alpha",
          scan: { id: "alpha", path: "/tmp/alpha", name: "alpha", isDirty: false } as any,
          memory: {} as any,
          vibe: { vibe: "sleepy", reason: "quiet for 30 days.", daysSinceCommit: 30, activity: 0.05 } as any
        }
      ]
    },
    0
  );
  const info = model.scene.sprites.get("alpha");
  if (!info) throw new Error("missing sprite info");
  const placement = model.scene.placements[0];
  // Sample across the blink interval; sleepy creatures should hold `▂`
  // for every now value (potentially in different cells if the body
  // bobs, but the glyph itself never opens).
  for (let frac = 0; frac < 1; frac += 0.2) {
    const now = info.blink.intervalMs * frac;
    const frame = renderGardenFrame(model, now);
    const eyes = activeEyesForFrame(info, now);
    const eyeX: number = placement.x + eyes.left.cx;
    const eyeY: number = placement.charY + eyes.left.cy;
    const leftCell = frame.cells[eyeY * frame.width + eyeX];
    assert.equal(leftCell?.char, CLOSED_EYE_GLYPH, `sleepy eye opened at frac=${frac}`);
  }
});

test("wiggle cadence is faster for active repos than inert ones in the same vibe bucket", () => {
  const buildModel = (activity: number) =>
    createGardenModel(
      {
        ...makeProps(),
        creatures: [
          {
            id: "alpha",
            scan: { id: "alpha", path: "/tmp/alpha", name: "alpha", isDirty: false } as any,
            memory: {} as any,
            vibe: { vibe: "happy", reason: "clean", activity } as any
          }
        ]
      },
      0
    );
  const fresh = buildModel(1);
  const inert = buildModel(0);
  const freshHalf = fresh.scene.sprites.get("alpha")?.wiggle.halfCycleMs ?? 0;
  const inertHalf = inert.scene.sprites.get("alpha")?.wiggle.halfCycleMs ?? 0;
  assert.ok(
    freshHalf < inertHalf,
    `expected active wiggle (${freshHalf}ms) to be faster than inert (${inertHalf}ms)`
  );
});

test("wander idle gap is shorter for active repos than inert ones in the same vibe bucket", () => {
  const buildModel = (activity: number) => {
    const model = createGardenModel(
      {
        ...makeProps(),
        focusIndex: -1,
        creatures: [
          {
            id: "alpha",
            scan: { id: "alpha", path: "/tmp/alpha", name: "alpha", isDirty: false } as any,
            memory: {} as any,
            vibe: { vibe: "happy", reason: "clean", activity } as any
          }
        ]
      },
      0
    );
    // First step initializes the wander state and bakes its profile.
    stepGardenModel(model, 0);
    return model.wander.get("alpha")?.profile;
  };
  const fresh = buildModel(1);
  const inert = buildModel(0);
  assert.ok(fresh && inert, "missing wander profiles");
  assert.ok(
    fresh.idleMax < inert.idleMin,
    `expected active idle range (≤${fresh.idleMax}) to sit below inert range (≥${inert.idleMin})`
  );
  assert.ok(
    fresh.radiusX > inert.radiusX,
    `expected active radius (${fresh.radiusX}) to exceed inert radius (${inert.radiusX})`
  );
});

test("syncGardenModel: wanderer cannot land on a neighbour's manual-offset position", () => {
  // Regression: pre-fix, manually-offset creatures were excluded from
  // anchorFootprints and resolved in scene order. A wanderer iterated
  // before its dragged neighbour saw neither the neighbour's anchor
  // nor its visual position, so the wanderer could land directly on top.
  const props: GardenSceneProps = {
    ...makeProps(),
    focusIndex: -1,
    creatures: [
      {
        id: "alpha",
        scan: { id: "alpha", path: "/tmp/alpha", name: "alpha", isDirty: false } as any,
        memory: {} as any,
        vibe: { vibe: "happy", reason: "clean", activity: 1 } as any
      },
      {
        id: "beta",
        scan: { id: "beta", path: "/tmp/beta", name: "beta", isDirty: false } as any,
        memory: { gardenPlacement: { offsetX: 6, offsetY: 0 } },
        vibe: { vibe: "happy", reason: "clean", activity: 1 } as any
      }
    ],
    innerWidth: 40,
    canvasH: 14,
    placementMode: "organic"
  };
  const model = createGardenModel(props, 0);
  const alphaAnchor = model.scene.placements.find((p) => p.tile.creature.id === "alpha");
  const betaAnchor = model.scene.placements.find((p) => p.tile.creature.id === "beta");
  assert.ok(alphaAnchor && betaAnchor, "missing anchors");

  // Force alpha to want beta's manual-offset spot.
  const betaVisualX = betaAnchor.x + 6;
  const betaVisualY = betaAnchor.charY;
  model.wander.set("alpha", {
    kind: "relocate",
    phase: "idle",
    idleUntil: Number.POSITIVE_INFINITY,
    wanderStartedAt: 0,
    wanderDurationMs: 0,
    outpoint: { x: 0, y: 0 },
    currentOffset: { x: 0, y: 0 },
    profile: { idleMin: 1000, idleMax: 2000, wanderMin: 500, wanderMax: 1000, radiusX: 1, radiusY: 1 },
    persistentOffset: {
      x: betaVisualX - alphaAnchor.x,
      y: betaVisualY - alphaAnchor.charY
    }
  });

  syncGardenModel(model, props, 0);
  const alphaVisual = model.visualPlacements.get("alpha");
  const betaVisual = model.visualPlacements.get("beta");
  assert.ok(alphaVisual && betaVisual, "missing visual placements");
  assert.equal(
    overlaps(alphaVisual, betaVisual),
    false,
    "wanderer must not land on dragged neighbour's body"
  );
});

test("shelf mode ignores persisted manual creature placement offsets", () => {
  const props: GardenSceneProps = {
    ...makeProps(),
    focusIndex: -1,
    creatures: [
      {
        id: "alpha",
        scan: { id: "alpha", path: "/tmp/alpha", name: "alpha", isDirty: false } as any,
        memory: { gardenPlacement: { offsetX: 5, offsetY: 2 } },
        vibe: { vibe: "happy", reason: "clean", activity: 1 } as any
      }
    ],
    innerWidth: 40,
    canvasH: 16,
    placementMode: "rooms"
  };
  const model = createGardenModel(props, 0);
  const anchor = model.scene.placements[0];
  const visual = model.visualPlacements.get("alpha");
  assert.ok(visual, "missing visual placement");
  assert.deepEqual(
    { x: visual.x, charY: visual.charY },
    { x: anchor.x, charY: anchor.charY }
  );
});

test("applyManualGardenPlacement moves a creature and returns a persisted offset", () => {
  const model = createGardenModel({ ...makeProps(), focusIndex: -1, innerWidth: 40, canvasH: 16 }, 0);
  const anchor = model.scene.placements[0];
  const result = applyManualGardenPlacement(model, "alpha", anchor.x + 3, anchor.charY + 1, 10);
  const visual = model.visualPlacements.get("alpha");
  assert.deepEqual(result?.previewChanges, [{ creatureId: "alpha", offsetX: 3, offsetY: 1 }]);
  assert.deepEqual(result?.commitChanges, [{ creatureId: "alpha", offsetX: 3, offsetY: 1 }]);
  assert.ok(visual, "missing visual placement");
  assert.deepEqual(
    { x: visual.x, charY: visual.charY },
    { x: anchor.x + 3, charY: anchor.charY + 1 }
  );
});

test("applyManualGardenPlacement pushes an overlapped creature out of the way", () => {
  const alpha = makePlacement("alpha", 0, "alpha", 2, 2);
  const beta = makePlacement("beta", 1, "beta", 10, 2);
  const model = {
    props: {
      ...makeProps(),
      creatures: [alpha.tile.creature, beta.tile.creature],
      focusIndex: -1,
      innerWidth: 30,
      canvasH: 12,
      placementMode: "organic"
    },
    scene: {
      placements: [alpha, beta],
      dividers: [],
      sprites: new Map()
    },
    hoverIndex: -1,
    originX: 0,
    originY: 0,
    nextShiftAt: Number.POSITIVE_INFINITY,
    lastShiftAxis: "y",
    lastTickAt: 0,
    wander: new Map(),
    layoutTransition: null,
    visualPlacements: new Map([
      ["alpha", alpha],
      ["beta", beta]
    ])
  } as any;

  const result = applyManualGardenPlacement(model, "alpha", beta.x, beta.charY, 10);
  assert.deepEqual(result?.previewChanges, [
    { creatureId: "alpha", offsetX: 8, offsetY: 0 },
    { creatureId: "beta", offsetX: 2, offsetY: 0 }
  ]);
  assert.deepEqual(result?.commitChanges, [
    { creatureId: "alpha", offsetX: 8, offsetY: 0 },
    { creatureId: "beta", offsetX: 4, offsetY: 0 }
  ]);
  assert.deepEqual(
    { x: model.visualPlacements.get("alpha")?.x, charY: model.visualPlacements.get("alpha")?.charY },
    { x: 10, charY: 2 }
  );
  assert.deepEqual(
    { x: model.visualPlacements.get("beta")?.x, charY: model.visualPlacements.get("beta")?.charY },
    { x: 12, charY: 2 }
  );
  assert.equal(overlaps(model.visualPlacements.get("alpha")!, model.visualPlacements.get("beta")!), true);
});

test("commitManualGardenPlacement applies a clean batch after squishy preview", () => {
  const alpha = makePlacement("alpha", 0, "alpha", 2, 2);
  const beta = makePlacement("beta", 1, "beta", 10, 2);
  const model = {
    props: {
      ...makeProps(),
      creatures: [alpha.tile.creature, beta.tile.creature],
      focusIndex: -1,
      innerWidth: 30,
      canvasH: 12,
      placementMode: "organic"
    },
    scene: {
      placements: [alpha, beta],
      dividers: [],
      sprites: new Map()
    },
    hoverIndex: -1,
    originX: 0,
    originY: 0,
    nextShiftAt: Number.POSITIVE_INFINITY,
    lastShiftAxis: "y",
    lastTickAt: 0,
    wander: new Map(),
    layoutTransition: null,
    visualPlacements: new Map([
      ["alpha", alpha],
      ["beta", beta]
    ]),
    dragPreviewPlacements: null
  } as any;

  const result = applyManualGardenPlacement(model, "alpha", beta.x, beta.charY, 10);
  assert.ok(result?.commitChanges, "missing strict commit batch");
  commitManualGardenPlacement(model, result.commitChanges, 20);
  const alphaVisual = model.visualPlacements.get("alpha");
  const betaVisual = model.visualPlacements.get("beta");
  assert.deepEqual(
    { x: alphaVisual?.x, charY: alphaVisual?.charY },
    { x: 10, charY: 2 }
  );
  assert.deepEqual(
    { x: betaVisual?.x, charY: betaVisual?.charY },
    { x: 14, charY: 2 }
  );
  assert.equal(overlaps(alphaVisual!, betaVisual!), false);
});

test("applyManualGardenPlacement allows squishy preview when strict commit cannot resolve", () => {
  const alpha = makePlacement("alpha", 0, "alpha", 2, 2);
  const beta = makePlacement("beta", 1, "beta", 10, 2);
  const model = {
    props: {
      ...makeProps(),
      creatures: [alpha.tile.creature, beta.tile.creature],
      focusIndex: -1,
      innerWidth: 16,
      canvasH: 12,
      placementMode: "organic"
    },
    scene: {
      placements: [alpha, beta],
      dividers: [],
      sprites: new Map()
    },
    hoverIndex: -1,
    originX: 0,
    originY: 0,
    nextShiftAt: Number.POSITIVE_INFINITY,
    lastShiftAxis: "y",
    lastTickAt: 0,
    wander: new Map(),
    layoutTransition: null,
    visualPlacements: new Map([
      ["alpha", alpha],
      ["beta", beta]
    ]),
    dragPreviewPlacements: null
  } as any;

  const result = applyManualGardenPlacement(model, "alpha", beta.x, beta.charY, 10);
  assert.deepEqual(result?.previewChanges, [
    { creatureId: "alpha", offsetX: 8, offsetY: 0 },
    { creatureId: "beta", offsetX: 2, offsetY: 0 }
  ]);
  assert.equal(result?.commitChanges, null);
  assert.deepEqual(
    { x: model.visualPlacements.get("alpha")?.x, charY: model.visualPlacements.get("alpha")?.charY },
    { x: 10, charY: 2 }
  );
  assert.deepEqual(
    { x: model.visualPlacements.get("beta")?.x, charY: model.visualPlacements.get("beta")?.charY },
    { x: 12, charY: 2 }
  );
});

test("applyManualGardenPlacement chain-pushes multiple creatures", () => {
  const alpha = makePlacement("alpha", 0, "alpha", 2, 2);
  const beta = makePlacement("beta", 1, "beta", 10, 2);
  const gamma = makePlacement("gamma", 2, "gamma", 14, 2);
  const model = {
    props: {
      ...makeProps(),
      creatures: [alpha.tile.creature, beta.tile.creature, gamma.tile.creature],
      focusIndex: -1,
      innerWidth: 30,
      canvasH: 12,
      placementMode: "organic"
    },
    scene: {
      placements: [alpha, beta, gamma],
      dividers: [],
      sprites: new Map()
    },
    hoverIndex: -1,
    originX: 0,
    originY: 0,
    nextShiftAt: Number.POSITIVE_INFINITY,
    lastShiftAxis: "y",
    lastTickAt: 0,
    wander: new Map(),
    layoutTransition: null,
    visualPlacements: new Map([
      ["alpha", alpha],
      ["beta", beta],
      ["gamma", gamma]
    ])
  } as any;

  const result = applyManualGardenPlacement(model, "alpha", beta.x, beta.charY, 10);
  assert.deepEqual(result?.previewChanges, [
    { creatureId: "alpha", offsetX: 8, offsetY: 0 },
    { creatureId: "beta", offsetX: 2, offsetY: 0 }
  ]);
  assert.deepEqual(result?.commitChanges, [
    { creatureId: "alpha", offsetX: 8, offsetY: 0 },
    { creatureId: "beta", offsetX: 4, offsetY: 0 },
    { creatureId: "gamma", offsetX: 4, offsetY: 0 }
  ]);
  const visuals = ["alpha", "beta", "gamma"].map((id) => model.visualPlacements.get(id)!);
  assert.deepEqual(
    visuals.map((placement) => ({ id: placement.tile.creature.id, x: placement.x, charY: placement.charY })),
    [
      { id: "alpha", x: 10, charY: 2 },
      { id: "beta", x: 12, charY: 2 },
      { id: "gamma", x: 14, charY: 2 }
    ]
  );
  assert.equal(overlaps(visuals[0], visuals[1]), true);
  assert.equal(overlaps(visuals[1], visuals[2]), true);
});

test("applyManualGardenPlacement blocks push when the chain hits the canvas edge", () => {
  const alpha = makePlacement("alpha", 0, "alpha", 2, 2);
  const beta = makePlacement("beta", 1, "beta", 10, 2);
  const model = {
    props: {
      ...makeProps(),
      creatures: [alpha.tile.creature, beta.tile.creature],
      focusIndex: -1,
      innerWidth: 14,
      canvasH: 12,
      placementMode: "organic"
    },
    scene: {
      placements: [alpha, beta],
      dividers: [],
      sprites: new Map()
    },
    hoverIndex: -1,
    originX: 0,
    originY: 0,
    nextShiftAt: Number.POSITIVE_INFINITY,
    lastShiftAxis: "y",
    lastTickAt: 0,
    wander: new Map(),
    layoutTransition: null,
    visualPlacements: new Map([
      ["alpha", alpha],
      ["beta", beta]
    ])
  } as any;

  const offset = applyManualGardenPlacement(model, "alpha", beta.x, beta.charY, 10);
  assert.equal(offset, null);
  assert.deepEqual(model.visualPlacements.get("alpha"), alpha);
});

test("applyManualGardenPlacement rejects the overlay dead zone", () => {
  const props: GardenSceneProps = {
    ...makeProps(),
    deadZone: { width: 10, height: 5 },
    focusIndex: -1,
    innerWidth: 30,
    canvasH: 14,
    placementMode: "organic"
  };
  const model = createGardenModel(props, 0);
  const before = model.visualPlacements.get("alpha");
  const offset = applyManualGardenPlacement(model, "alpha", 25, 11, 10);
  assert.equal(offset, null);
  assert.deepEqual(model.visualPlacements.get("alpha"), before);
});

test("applyManualGardenPlacement blocks push when a pushed creature would enter the dead zone", () => {
  const alpha = makePlacement("alpha", 0, "alpha", 2, 2);
  const beta = makePlacement("beta", 1, "beta", 10, 2);
  const model = {
    props: {
      ...makeProps(),
      creatures: [alpha.tile.creature, beta.tile.creature],
      deadZone: { width: 16, height: 10 },
      focusIndex: -1,
      innerWidth: 30,
      canvasH: 12,
      placementMode: "organic"
    },
    scene: {
      placements: [alpha, beta],
      dividers: [],
      sprites: new Map()
    },
    hoverIndex: -1,
    originX: 0,
    originY: 0,
    nextShiftAt: Number.POSITIVE_INFINITY,
    lastShiftAxis: "y",
    lastTickAt: 0,
    wander: new Map(),
    layoutTransition: null,
    visualPlacements: new Map([
      ["alpha", alpha],
      ["beta", beta]
    ])
  } as any;

  const offset = applyManualGardenPlacement(model, "alpha", beta.x, beta.charY, 10);
  assert.equal(offset, null);
  assert.deepEqual(model.visualPlacements.get("alpha"), alpha);
  assert.deepEqual(model.visualPlacements.get("beta"), beta);
});

// =========================================================================
// Drag replay harness — exercise the same mouse-event sequences a user
// produces during a drag, in many variants, so each "the drag refused to
// move" symptom maps to one concrete failing scenario. Each scenario is
// its own test so the failures are isolated.
// =========================================================================

interface DragScenarioOpts {
  /** Creatures in the garden. */
  creatures: Array<{ id: string; name?: string }>;
  /** Which creature to drag. */
  dragId: string;
  /** Cell-space delta to drag by. */
  delta: { dx: number; dy: number };
  /**
   * Optional hook that runs after press but before any drag events. Use
   * to simulate background things that happen mid-drag (a stray
   * setProps, a tick, etc.).
   */
  betweenPressAndDrag?: (engine: GardenEngine) => void;
  /**
   * Optional hook that runs after each drag event but before release.
   * Lets a test inject a re-render in the middle of a multi-step drag.
   */
  betweenDragEvents?: (engine: GardenEngine, step: number) => void;
  /** How many drag events to emit between press and release. */
  steps?: number;
  /** Initial focus index. -1 = no focus. */
  focusIndex?: number;
  /** Force a non-zero wander bob on the dragged creature at press time. */
  wanderBob?: { x: number; y: number };
}

interface DragScenarioResult {
  /** Did any onCreaturePlacementChange fire? */
  committed: boolean;
  /** Final committed offset for the dragged creature, if any. */
  committedOffset: { offsetX: number; offsetY: number } | null;
  /** Engine's drag state at the moment of release (should be null after). */
  dragAliveAfterRelease: boolean;
  /** Whether dragPreviewPlacements was ever populated during the drag. */
  previewEverSet: boolean;
  /** Final visual placement of the dragged creature (post-release). */
  finalVisualX: number | null;
  /** The press placement returned by hit-test, or null if press missed. */
  pressHit: { x: number; charY: number } | null;
}

const runDragScenario = (opts: DragScenarioOpts): DragScenarioResult => {
  const writes: string[] = [];
  const stdout = { write: (chunk: string) => (writes.push(chunk), true) } as any;
  const props: GardenSceneProps = {
    ...makeProps(),
    creatures: opts.creatures.map((c) => ({
      id: c.id,
      scan: { id: c.id, path: `/tmp/${c.id}`, name: c.name ?? c.id, isDirty: false } as any,
      memory: {} as any,
      vibe: { vibe: "happy", reason: "", activity: 1 } as any
    })),
    focusIndex: opts.focusIndex ?? -1,
    innerWidth: 60,
    canvasH: 20,
    placementMode: "organic"
  };
  const changes: Array<{ creature: { id: string }; offset: { offsetX: number; offsetY: number } }> = [];
  const engineProps = {
    ...props,
    originRow: 1,
    originCol: 1,
    onCreaturePlacementChange: (next: typeof changes) => changes.push(...next)
  };
  const engine = new GardenEngine(stdout, engineProps);
  const result: DragScenarioResult = {
    committed: false,
    committedOffset: null,
    dragAliveAfterRelease: false,
    previewEverSet: false,
    finalVisualX: null,
    pressHit: null
  };

  try {
    const model = (engine as any).model;
    const placement = (model.scene.placements as Placement[]).find(
      (p) => p.tile.creature.id === opts.dragId
    );
    if (!placement) {
      throw new Error(`scenario setup: creature "${opts.dragId}" not placed in scene`);
    }

    if (opts.wanderBob) {
      const wanderState = {
        profile: { idleMin: 1000, idleMax: 2000 },
        phase: "idle",
        idleUntil: Number.POSITIVE_INFINITY,
        currentOffset: { x: opts.wanderBob.x, y: opts.wanderBob.y },
        persistentOffset: { x: 0, y: 0 },
        manualOffset: undefined
      };
      (model.wander as Map<string, unknown>).set(placement.tile.creature.id, wanderState);
      model.visualPlacements.set(placement.tile.creature.id, {
        ...placement,
        x: placement.x + opts.wanderBob.x,
        charY: placement.charY + opts.wanderBob.y
      });
    }

    const visual = model.visualPlacements.get(placement.tile.creature.id) ?? placement;
    const pressCol = 1 + visual.x;
    const pressRow = 1 + visual.charY;
    result.pressHit = { x: visual.x, charY: visual.charY };

    engine.handleMouse({ kind: "press", button: "left", row: pressRow, col: pressCol });

    if (opts.betweenPressAndDrag) opts.betweenPressAndDrag(engine);

    const steps = opts.steps ?? 1;
    for (let i = 1; i <= steps; i += 1) {
      const fraction = i / steps;
      const dx = Math.round(opts.delta.dx * fraction);
      const dy = Math.round(opts.delta.dy * fraction);
      engine.handleMouse({
        kind: "drag",
        button: "left",
        row: pressRow + dy,
        col: pressCol + dx
      });
      if (model.dragPreviewPlacements) result.previewEverSet = true;
      if (opts.betweenDragEvents) opts.betweenDragEvents(engine, i);
    }

    engine.handleMouse({
      kind: "release",
      button: "unknown",
      row: pressRow + opts.delta.dy,
      col: pressCol + opts.delta.dx
    });

    result.dragAliveAfterRelease = (engine as any).drag !== null;
    if (changes.length > 0) {
      result.committed = true;
      const myChange = changes.find((c) => c.creature.id === opts.dragId);
      if (myChange) result.committedOffset = myChange.offset;
    }
    const finalPlacement = (model.scene.placements as Placement[]).find(
      (p) => p.tile.creature.id === opts.dragId
    );
    if (finalPlacement) {
      const visualAfter = model.visualPlacements.get(opts.dragId);
      result.finalVisualX = visualAfter?.x ?? finalPlacement.x;
    }
  } finally {
    engine.destroy();
  }

  return result;
};

test("drag-replay: simple single-step drag commits the cursor delta", () => {
  const r = runDragScenario({
    creatures: [{ id: "alpha" }],
    dragId: "alpha",
    delta: { dx: 5, dy: 0 }
  });
  assert.ok(r.pressHit, "press should hit a creature");
  assert.ok(r.previewEverSet, "drag preview should populate during drag");
  assert.ok(r.committed, "drag should commit");
  assert.deepEqual(r.committedOffset, { offsetX: 5, offsetY: 0 });
});

test("drag-replay: multi-step drag (10 events) commits the final position", () => {
  const r = runDragScenario({
    creatures: [{ id: "alpha" }],
    dragId: "alpha",
    delta: { dx: 10, dy: 0 },
    steps: 10
  });
  assert.deepEqual(r.committedOffset, { offsetX: 10, offsetY: 0 });
});

test("drag-replay: zero-distance drag (press + release, no movement) does not commit", () => {
  const r = runDragScenario({
    creatures: [{ id: "alpha" }],
    dragId: "alpha",
    delta: { dx: 0, dy: 0 },
    steps: 0
  });
  assert.equal(r.committed, false, "click without drag should not commit");
});

test("drag-replay: drag in negative direction commits the negative offset", () => {
  const r = runDragScenario({
    creatures: [{ id: "alpha" }],
    dragId: "alpha",
    delta: { dx: -3, dy: 0 }
  });
  assert.deepEqual(r.committedOffset, { offsetX: -3, offsetY: 0 });
});

test("drag-replay: drag a wandering creature ignores the bob in the commit", () => {
  const r = runDragScenario({
    creatures: [{ id: "alpha" }],
    dragId: "alpha",
    delta: { dx: 4, dy: 0 },
    wanderBob: { x: 2, y: 1 }
  });
  assert.deepEqual(
    r.committedOffset,
    { offsetX: 4, offsetY: 0 },
    "wander bob at press should not contaminate the persisted offset"
  );
});

test("drag-replay: stray setProps mid-drag (same scene) does not break commit", () => {
  const r = runDragScenario({
    creatures: [{ id: "alpha" }],
    dragId: "alpha",
    delta: { dx: 6, dy: 0 },
    steps: 3,
    betweenDragEvents: (engine, step) => {
      if (step === 2) {
        // Simulate a parent re-render that ships fresh callback identities
        // but no scene change.
        engine.setProps({
          ...(engine as any).props,
          onCreaturePlacementChange: ((engine as any).props.onCreaturePlacementChange)
        });
      }
    }
  });
  assert.equal(r.committed, true);
  assert.deepEqual(r.committedOffset, { offsetX: 6, offsetY: 0 });
});

test("drag-replay: stepGardenModel tick mid-drag does not lose the preview", () => {
  const r = runDragScenario({
    creatures: [{ id: "alpha" }],
    dragId: "alpha",
    delta: { dx: 4, dy: 0 },
    steps: 2,
    betweenDragEvents: (engine, step) => {
      if (step === 1) {
        const model = (engine as any).model;
        stepGardenModel(model, performance.now() + 100);
      }
    }
  });
  assert.equal(r.committed, true);
  assert.ok(r.previewEverSet);
});

test("drag-replay: two consecutive drags on the same creature both commit", () => {
  const writes: string[] = [];
  const stdout = { write: (chunk: string) => (writes.push(chunk), true) } as any;
  const changes: Array<{ creature: { id: string }; offset: { offsetX: number; offsetY: number } }> = [];
  const engine = new GardenEngine(stdout, {
    ...makeProps(),
    focusIndex: -1,
    originRow: 1,
    originCol: 1,
    onCreaturePlacementChange: (next) => changes.push(...next)
  });
  try {
    const model = (engine as any).model;
    const placement = model.scene.placements[0] as Placement;
    // Drag 1: +3.
    engine.handleMouse({ kind: "press", button: "left", row: 1 + placement.charY, col: 1 + placement.x });
    engine.handleMouse({ kind: "drag", button: "left", row: 1 + placement.charY, col: 1 + placement.x + 3 });
    engine.handleMouse({ kind: "release", button: "unknown", row: 1 + placement.charY, col: 1 + placement.x + 3 });
    assert.equal(changes.length, 1);
    assert.deepEqual(changes[0].offset, { offsetX: 3, offsetY: 0 });
    // Drag 2: +2 from where it now sits. The creature now visually lives at x+3
    // because of the committed manualOffset; the next press must target that.
    const visualNow = model.visualPlacements.get("alpha");
    assert.ok(visualNow, "creature should be in visualPlacements after commit");
    engine.handleMouse({ kind: "press", button: "left", row: 1 + visualNow.charY, col: 1 + visualNow.x });
    engine.handleMouse({ kind: "drag", button: "left", row: 1 + visualNow.charY, col: 1 + visualNow.x + 2 });
    engine.handleMouse({ kind: "release", button: "unknown", row: 1 + visualNow.charY, col: 1 + visualNow.x + 2 });
    assert.equal(changes.length, 2);
    assert.deepEqual(changes[1].offset, { offsetX: 5, offsetY: 0 }, "second drag is cumulative");
  } finally {
    engine.destroy();
  }
});

test("drag-replay: drag survives a setProps that changes focusIndex mid-drag", () => {
  const r = runDragScenario({
    creatures: [{ id: "alpha" }, { id: "beta" }],
    dragId: "alpha",
    delta: { dx: 4, dy: 0 },
    steps: 2,
    betweenPressAndDrag: (engine) => {
      // Simulate the press's onCreatureSelect → setFocusIndex → re-render
      // → setProps cascade.
      engine.setProps({
        ...(engine as any).props,
        focusIndex: 0
      });
    }
  });
  assert.equal(r.committed, true, "focus-change mid-drag should not lose the drag");
  assert.deepEqual(r.committedOffset, { offsetX: 4, offsetY: 0 });
});

test("drag-replay: drag commits even when a setProps swaps the creatures array", () => {
  // Common case: a background scan refresh produces a new creatures array
  // mid-drag, with the dragged creature still in it (just different object
  // identity).
  const writes: string[] = [];
  const stdout = { write: (chunk: string) => (writes.push(chunk), true) } as any;
  const baseCreatures = [
    {
      id: "alpha",
      scan: { id: "alpha", path: "/tmp/alpha", name: "alpha", isDirty: false } as any,
      memory: {} as any,
      vibe: { vibe: "happy", reason: "", activity: 1 } as any
    },
    {
      id: "beta",
      scan: { id: "beta", path: "/tmp/beta", name: "beta", isDirty: false } as any,
      memory: {} as any,
      vibe: { vibe: "happy", reason: "", activity: 1 } as any
    }
  ];
  const changes: Array<{ creature: { id: string }; offset: { offsetX: number; offsetY: number } }> = [];
  const engine = new GardenEngine(stdout, {
    ...makeProps(),
    creatures: baseCreatures,
    focusIndex: -1,
    innerWidth: 60,
    canvasH: 20,
    originRow: 1,
    originCol: 1,
    onCreaturePlacementChange: (next) => changes.push(...next)
  });
  try {
    const model = (engine as any).model;
    const placement = (model.scene.placements as Placement[]).find((p) => p.tile.creature.id === "alpha")!;
    engine.handleMouse({ kind: "press", button: "left", row: 1 + placement.charY, col: 1 + placement.x });
    engine.handleMouse({ kind: "drag", button: "left", row: 1 + placement.charY, col: 1 + placement.x + 3 });
    // Simulate setCreatures with new object identities for both creatures.
    const reshuffled = baseCreatures.map((c) => ({ ...c }));
    engine.setProps({
      ...(engine as any).props,
      creatures: reshuffled
    });
    engine.handleMouse({ kind: "drag", button: "left", row: 1 + placement.charY, col: 1 + placement.x + 5 });
    engine.handleMouse({ kind: "release", button: "unknown", row: 1 + placement.charY, col: 1 + placement.x + 5 });
    assert.ok(changes.length > 0, "drag survived a creatures-array swap");
    const alphaChange = changes.find((c) => c.creature.id === "alpha");
    assert.ok(alphaChange, "alpha received a placement change");
    assert.deepEqual(alphaChange.offset, { offsetX: 5, offsetY: 0 });
  } finally {
    engine.destroy();
  }
});

test("drag-replay: wander tick BETWEEN press and first drag does not break the drag", () => {
  // The most realistic intermittent failure: the engine's 100ms tick
  // fires between the user pressing and the first drag event arriving.
  // stepGardenModel advances the wander state. If the engine's drag
  // math depends on anything that just moved, the user sees the drag
  // refuse to track.
  const r = runDragScenario({
    creatures: [{ id: "alpha" }],
    dragId: "alpha",
    delta: { dx: 5, dy: 0 },
    steps: 3,
    wanderBob: { x: 1, y: 0 },
    betweenPressAndDrag: (engine) => {
      const model = (engine as any).model;
      stepGardenModel(model, performance.now() + 100);
      stepGardenModel(model, performance.now() + 200);
    }
  });
  assert.ok(r.committed, "drag refused to commit after a mid-press wander tick");
  assert.deepEqual(r.committedOffset, { offsetX: 5, offsetY: 0 });
});

test("drag-replay: press hits a creature whose visualPlacements moved one tick AFTER the user saw it", () => {
  // The race: user looks at the screen at tick T (creature at x=visualX),
  // clicks, but the click arrives in Node AFTER tick T+1 has advanced
  // the wander offset by one cell. The engine's hit-test now sees a
  // creature at visualX+1, but the user clicked at visualX. Miss.
  //
  // We simulate by capturing the visual coords from the engine's
  // rendered state, then advancing the model BEFORE the press arrives.
  const writes: string[] = [];
  const stdout = { write: (chunk: string) => (writes.push(chunk), true) } as any;
  const changes: Array<{ creature: { id: string }; offset: { offsetX: number; offsetY: number } }> = [];
  const engine = new GardenEngine(stdout, {
    ...makeProps(),
    focusIndex: -1,
    originRow: 1,
    originCol: 1,
    innerWidth: 60,
    canvasH: 20,
    onCreaturePlacementChange: (next) => changes.push(...next)
  });
  try {
    const model = (engine as any).model;
    const placement = model.scene.placements[0] as Placement;
    // Force a wander state with a non-zero currentOffset (this is what
    // the user is looking at on screen).
    const wanderState = {
      profile: { idleMin: 1000, idleMax: 2000 },
      kind: "wander",
      phase: "wandering",
      idleUntil: 0,
      wanderStartedAt: 0,
      wanderDurationMs: 10000,
      outpoint: { x: 1, y: 0 },
      currentOffset: { x: 1, y: 0 },
      persistentOffset: { x: 0, y: 0 },
      manualOffset: undefined
    };
    (model.wander as Map<string, unknown>).set("alpha", wanderState);
    // Sync visuals to reflect that the user is seeing the creature at x+1.
    syncGardenModel(model, model.props, performance.now());
    const userSeesX = (model.visualPlacements.get("alpha") as Placement).x;

    // Now advance the model BEFORE the press arrives. The wander
    // currentOffset will shift, and visualPlacements will reflect that.
    wanderState.currentOffset = { x: 2, y: 0 };
    syncGardenModel(model, model.props, performance.now());
    const engineSeesX = (model.visualPlacements.get("alpha") as Placement).x;
    assert.notEqual(userSeesX, engineSeesX, "test premise: engine should have advanced");

    // User clicks where they SAW the creature.
    engine.handleMouse({
      kind: "press",
      button: "left",
      row: 1 + placement.charY,
      col: 1 + userSeesX
    });
    engine.handleMouse({
      kind: "drag",
      button: "left",
      row: 1 + placement.charY,
      col: 1 + userSeesX + 3
    });
    engine.handleMouse({
      kind: "release",
      button: "unknown",
      row: 1 + placement.charY,
      col: 1 + userSeesX + 3
    });

    assert.ok(
      changes.length > 0,
      `drag missed: user clicked at x=${userSeesX} (where they saw the creature) but engine had advanced to x=${engineSeesX}`
    );
  } finally {
    engine.destroy();
  }
});

test("drag-replay: press exactly on sprite bounding-box edge (not on rendered ink) still picks up the creature", () => {
  // findCreatureDragHandleAtCell has a fallback to bounding-box hit-test
  // when the exact sprite-ink test misses. Make sure it actually fires.
  const writes: string[] = [];
  const stdout = { write: (chunk: string) => (writes.push(chunk), true) } as any;
  const changes: Array<{ creature: { id: string }; offset: { offsetX: number; offsetY: number } }> = [];
  const engine = new GardenEngine(stdout, {
    ...makeProps(),
    focusIndex: -1,
    originRow: 1,
    originCol: 1,
    innerWidth: 60,
    canvasH: 20,
    onCreaturePlacementChange: (next) => changes.push(...next)
  });
  try {
    const model = (engine as any).model;
    const placement = model.scene.placements[0] as Placement;
    // Click on the top-left corner cell of the bounding box (may or may
    // not have ink depending on the sprite shape).
    engine.handleMouse({
      kind: "press",
      button: "left",
      row: 1 + placement.charY,
      col: 1 + placement.x
    });
    engine.handleMouse({
      kind: "drag",
      button: "left",
      row: 1 + placement.charY,
      col: 1 + placement.x + 2
    });
    engine.handleMouse({
      kind: "release",
      button: "unknown",
      row: 1 + placement.charY,
      col: 1 + placement.x + 2
    });
    assert.ok(changes.length > 0, "bounding-box press did not produce a drag");
  } finally {
    engine.destroy();
  }
});

test("drag-replay: stress — 20 successive drags with wander ticks between each all commit", () => {
  // Approximates real interactive use: many drags in a row, with a
  // wander tick firing between each one (since each drag in a real
  // session is separated by at least one 100ms tick).
  const writes: string[] = [];
  const stdout = { write: (chunk: string) => (writes.push(chunk), true) } as any;
  const changes: Array<{ creature: { id: string }; offset: { offsetX: number; offsetY: number } }> = [];
  const engine = new GardenEngine(stdout, {
    ...makeProps(),
    focusIndex: -1,
    originRow: 1,
    originCol: 1,
    innerWidth: 60,
    canvasH: 20,
    onCreaturePlacementChange: (next) => changes.push(...next)
  });
  try {
    const model = (engine as any).model;
    for (let i = 0; i < 20; i += 1) {
      // Advance the model — the wander state shifts by some amount.
      stepGardenModel(model, performance.now() + i * 100);
      const visual = model.visualPlacements.get("alpha") as Placement;
      assert.ok(visual, `iteration ${i}: visual placement missing`);
      const dx = (i % 2 === 0 ? 1 : -1);
      engine.handleMouse({ kind: "press", button: "left", row: 1 + visual.charY, col: 1 + visual.x });
      engine.handleMouse({
        kind: "drag",
        button: "left",
        row: 1 + visual.charY,
        col: 1 + visual.x + dx
      });
      engine.handleMouse({
        kind: "release",
        button: "unknown",
        row: 1 + visual.charY,
        col: 1 + visual.x + dx
      });
    }
    assert.equal(changes.length, 20, `expected 20 commits, got ${changes.length}`);
  } finally {
    engine.destroy();
  }
});

test("drag-replay: pre-existing overlap between two unrelated creatures does not veto a third creature's drag", () => {
  // The "smoking gun" from a real session: the placer left two
  // wide-aspect creatures (InkaiPlus, RepoGarden) overlapping in their
  // resting positions by more than the squishy budget. Every drag of
  // any OTHER creature failed because resolvePushPlacements's final
  // overlap check saw that pre-existing overlap and rejected the
  // entire push solution. The drag solver should only judge pairs
  // it's responsible for moving.
  const writes: string[] = [];
  const stdout = { write: (chunk: string) => (writes.push(chunk), true) } as any;
  const changes: Array<{ creature: { id: string }; offset: { offsetX: number; offsetY: number } }> = [];
  const engine = new GardenEngine(stdout, {
    ...makeProps(),
    focusIndex: -1,
    innerWidth: 80,
    canvasH: 24,
    originRow: 1,
    originCol: 1,
    creatures: [
      {
        id: "victim",
        scan: { id: "victim", path: "/tmp/victim", name: "victim", isDirty: false } as any,
        memory: {} as any,
        vibe: { vibe: "happy", reason: "", activity: 1 } as any
      },
      {
        id: "overlap-a",
        scan: { id: "overlap-a", path: "/tmp/overlap-a", name: "overlap-a", isDirty: false } as any,
        memory: {} as any,
        vibe: { vibe: "happy", reason: "", activity: 1 } as any
      },
      {
        id: "overlap-b",
        scan: { id: "overlap-b", path: "/tmp/overlap-b", name: "overlap-b", isDirty: false } as any,
        memory: {} as any,
        vibe: { vibe: "happy", reason: "", activity: 1 } as any
      }
    ],
    onCreaturePlacementChange: (next) => changes.push(...next)
  });
  try {
    const model = (engine as any).model;
    // Force overlap-a and overlap-b to overlap by mutating their
    // anchor positions. (We mutate scene.placements directly because
    // we want to simulate the placer producing overlapping anchors.)
    const placements = model.scene.placements as Placement[];
    const a = placements.find((p) => p.tile.creature.id === "overlap-a")!;
    const b = placements.find((p) => p.tile.creature.id === "overlap-b")!;
    (b as any).x = a.x + 1;
    (b as any).charY = a.charY;
    model.visualPlacements.set("overlap-a", a);
    model.visualPlacements.set("overlap-b", b);

    const victim = placements.find((p) => p.tile.creature.id === "victim")!;
    engine.handleMouse({
      kind: "press",
      button: "left",
      row: 1 + victim.charY,
      col: 1 + victim.x
    });
    engine.handleMouse({
      kind: "drag",
      button: "left",
      row: 1 + victim.charY,
      col: 1 + victim.x + 3
    });
    engine.handleMouse({
      kind: "release",
      button: "unknown",
      row: 1 + victim.charY,
      col: 1 + victim.x + 3
    });

    assert.ok(
      changes.length > 0,
      "victim drag was rejected by pre-existing overlap between two unrelated creatures"
    );
    const victimChange = changes.find((c) => c.creature.id === "victim");
    assert.ok(victimChange, "victim did not receive a placement change");
    assert.deepEqual(victimChange.offset, { offsetX: 3, offsetY: 0 });
  } finally {
    engine.destroy();
  }
});
