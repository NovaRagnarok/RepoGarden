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
  syncGardenModel
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
      vibe: { vibe: "happy", reason: "clean" } as any
    }
  ],
  focusIndex: 0,
  innerWidth: 28,
  canvasH: 14,
  placementMode: "organic",
  theme: {
    foreground: "#ffffff",
    background: "#000000",
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
      vibe: { vibe: "happy", reason: "clean" } as any
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
  wiggle: { halfCycleMs: 1000, phaseMs: 0 }
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
    vibe: { vibe: (["happy", "noisy", "blocked", "sleepy"] as const)[i % 4], reason: "" } as any
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
      placementMode: "shelf",
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
        vibe: { vibe: "happy", reason: "clean" } as any
      },
      {
        id: "beta",
        scan: { id: "beta", path: "/tmp/beta", name: "beta", isDirty: false } as any,
        memory: {} as any,
        vibe: { vibe: "noisy", reason: "dirty" } as any
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

  syncGardenModel(model, { ...props, placementMode: "shelf" }, 100);
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
        vibe: { vibe: "happy", reason: "clean" } as any
      },
      {
        id: "beta",
        scan: { id: "beta", path: "/tmp/beta", name: "beta", isDirty: false } as any,
        memory: {} as any,
        vibe: { vibe: "happy", reason: "clean" } as any
      }
    ],
    focusIndex: -1,
    innerWidth: 40,
    canvasH: 14,
    placementMode: "shelf"
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
        vibe: { vibe: "happy", reason: "clean" } as any
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

test("shelf mode ignores persisted manual creature placement offsets", () => {
  const props: GardenSceneProps = {
    ...makeProps(),
    focusIndex: -1,
    creatures: [
      {
        id: "alpha",
        scan: { id: "alpha", path: "/tmp/alpha", name: "alpha", isDirty: false } as any,
        memory: { gardenPlacement: { offsetX: 5, offsetY: 2 } },
        vibe: { vibe: "happy", reason: "clean" } as any
      }
    ],
    innerWidth: 40,
    canvasH: 16,
    placementMode: "shelf"
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
