import type { Placement, PlacementFootprint, SizedTile } from "@/lib/garden-layout";
import {
  creatureNameStartCol,
  GROUND_ROWS,
  lineUpCreatures,
  NAME_GAP_ROWS,
  NAME_H,
  placeCreatures,
  SKY_ROWS,
  SLOT_PAD_X,
  SLOT_PAD_Y,
  spriteBodyFootprint,
  spriteBodyFootprintsOverlap,
  stableCreatureIdsKey
} from "@/lib/garden-layout";
import {
  buildCreatureSizeCohort,
  creatureCharSize,
  generateCreatureFrames,
  hashString,
  mulberry32,
  pickSpriteColors
} from "@/lib/sprite";
import { vibeGlyph, type Vibe } from "@/lib/vibe";

import { sceneSeedForCreatures } from "@/garden/stars";
import type {
  BlinkProfile,
  GardenLayoutTransition,
  GardenDeadZone,
  GardenModel,
  GardenScene,
  GardenSceneProps,
  GardenSpriteInfo,
  GardenWanderState,
  WanderProfile,
  WiggleProfile
} from "@/garden/types";

const SUB_PER_CELL = 2;

const VIBE_WANDER: Record<
  Vibe,
  { idleMin: number; idleMax: number; wanderMin: number; wanderMax: number; radiusX: number; radiusY: number }
> = {
  happy: { idleMin: 10000, idleMax: 20000, wanderMin: 4400, wanderMax: 8400, radiusX: 2, radiusY: 1 },
  awake: { idleMin: 5600, idleMax: 11200, wanderMin: 3200, wanderMax: 6000, radiusX: 2, radiusY: 1 },
  sleepy: { idleMin: 32000, idleMax: 64000, wanderMin: 5600, wanderMax: 9200, radiusX: 1, radiusY: 1 },
  stuck: { idleMin: 56000, idleMax: 104000, wanderMin: 4400, wanderMax: 7200, radiusX: 1, radiusY: 1 }
};

const VIBE_WIGGLE: Record<Vibe, { min: number; max: number }> = {
  happy: { min: 1800, max: 2500 },
  awake: { min: 2100, max: 2900 },
  stuck: { min: 3100, max: 4500 },
  sleepy: { min: 3800, max: 5700 }
};

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

const pickInRange = (min: number, max: number): number =>
  min + Math.random() * (max - min);

const pickWanderKind = (vibe: Vibe): "round-trip" | "relocate" => {
  const relocateChance = vibe === "sleepy" || vibe === "stuck" ? 0.08 : 0.22;
  return Math.random() < relocateChance ? "relocate" : "round-trip";
};

const scheduleNextShiftAt = (now: number): number =>
  now + 22000 + Math.random() * 12000;

const LAYOUT_TRANSITION_MS = 1400;

const easeInOutCubic = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

const buildWiggleProfile = (
  identity: string,
  vibe: Vibe,
  activity: number
): WiggleProfile => {
  const { min, max } = VIBE_WIGGLE[vibe];
  const rng = mulberry32(hashString(`wiggle:${identity}:${vibe}`));
  // Activity drives where on the vibe-bucket's cadence range this repo
  // sits: a fresh-commit repo wiggles at the fast end of its bucket, a
  // long-quiet one at the slow end. ±10% jitter keeps adjacent
  // identical-activity creatures slightly out of phase visually.
  const a = clamp(activity, 0, 1);
  const center = max - (max - min) * a;
  const jitter = (rng() * 2 - 1) * (max - min) * 0.1;
  const halfCycleMs = Math.round(clamp(center + jitter, min, max));
  return {
    halfCycleMs,
    phaseMs: Math.round(rng() * halfCycleMs * 2)
  };
};

export const wiggleFrameAt = (profile: WiggleProfile, now: number): 0 | 1 =>
  Math.floor((now + profile.phaseMs) / profile.halfCycleMs) % 2 === 0 ? 0 : 1;

const BLINK_DURATION_MS = 140;

const buildBlinkProfile = (
  identity: string,
  activity: number
): BlinkProfile => {
  const rng = mulberry32(hashString(`blink:${identity}`));
  const a = clamp(activity, 0, 1);
  // Active repos blink every ~3.5s; inert ones every ~7s. Smoothly
  // interpolated by activity so the cadence tracks the rest of the
  // animation system rather than living in its own bucket.
  const interval = Math.round(7000 - 3500 * a);
  return {
    intervalMs: interval,
    durationMs: BLINK_DURATION_MS,
    phaseMs: Math.round(rng() * interval)
  };
};

/** True when the eye glyph should display the *closed* form (the brief
 *  blink window). Otherwise the open glyph paints. */
export const blinkClosedAt = (profile: BlinkProfile, now: number): boolean => {
  const t = (now + profile.phaseMs) % profile.intervalMs;
  return t < profile.durationMs;
};

const visualPlacementAtOffset = (
  placement: Placement,
  offsetX: number,
  offsetY: number,
  canvasW: number,
  canvasH: number
): Placement => {
  const maxX = Math.max(0, canvasW - placement.tile.spriteCols);
  const maxY = Math.max(0, canvasH - placement.tile.charRows - 1);
  return {
    tile: placement.tile,
    x: clamp(placement.x + offsetX, 0, maxX),
    charY: clamp(placement.charY + offsetY, 0, maxY)
  };
};

const footprintIntersectsDeadZone = (
  footprint: PlacementFootprint,
  deadZone: GardenDeadZone | undefined,
  canvasW: number,
  canvasH: number
): boolean => {
  if (!deadZone) return false;
  const deadLeft = canvasW - deadZone.width;
  const deadTop = canvasH - deadZone.height;
  return footprint.right >= deadLeft && footprint.bottom >= deadTop;
};

const canUsePlacement = (
  creatureId: string,
  candidate: Placement,
  acceptedFootprints: PlacementFootprint[],
  anchorFootprints: Map<string, PlacementFootprint>,
  deadZone: GardenDeadZone | undefined,
  canvasW: number,
  canvasH: number
): boolean => {
  // Body-only checks here — the drag/push solver already enforces no
  // sprite-body overlap and the user controls manual positions. Treating
  // label-row collisions as a hard reject here would make wanderers
  // refuse positions the push solver had already validated, falling
  // back to the anchor (which is worse than a touching label).
  const footprint = spriteBodyFootprint(candidate);
  if (footprintIntersectsDeadZone(footprint, deadZone, canvasW, canvasH)) return false;
  for (const accepted of acceptedFootprints) {
    if (spriteBodyFootprintsOverlap(footprint, accepted)) return false;
  }
  for (const [otherId, anchor] of anchorFootprints) {
    if (otherId === creatureId) continue;
    if (spriteBodyFootprintsOverlap(footprint, anchor)) return false;
  }
  return true;
};

const pushCandidate = (candidates: Placement[], candidate: Placement): void => {
  if (candidates.some((existing) => existing.x === candidate.x && existing.charY === candidate.charY)) return;
  candidates.push(candidate);
};

// Spiral outward from `base` looking for the closest cell whose footprint
// clears every accepted/anchor obstacle. Used as a safety net when none of
// the normal candidates fit — without it, the resolver silently lands the
// creature on top of an obstacle by falling back to its bare anchor.
const findNearestClearPlacement = (
  base: Placement,
  creatureId: string,
  acceptedFootprints: PlacementFootprint[],
  anchorFootprints: Map<string, PlacementFootprint>,
  deadZone: GardenDeadZone | undefined,
  canvasW: number,
  canvasH: number
): Placement | null => {
  const maxRadius = Math.max(canvasW, canvasH);
  for (let radius = 1; radius <= maxRadius; radius += 1) {
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        // Only walk the ring at this Chebyshev distance — inner rings were
        // already scanned, so revisiting them just wastes work.
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        const candidate: Placement = {
          tile: base.tile,
          x: base.x + dx,
          charY: base.charY + dy
        };
        if (candidate.x < 0 || candidate.charY < 0) continue;
        if (candidate.x + base.tile.spriteCols > canvasW) continue;
        if (candidate.charY + base.tile.charRows > canvasH) continue;
        if (
          canUsePlacement(
            creatureId,
            candidate,
            acceptedFootprints,
            anchorFootprints,
            deadZone,
            canvasW,
            canvasH
          )
        ) {
          return candidate;
        }
      }
    }
  }
  return null;
};

const buildTiles = (props: GardenSceneProps): SizedTile[] => {
  const { creatures, innerWidth, canvasH } = props;
  if (creatures.length === 0) return [];
  const aspect = innerWidth / Math.max(1, canvasH - SKY_ROWS - GROUND_ROWS);
  const targetRowsRaw = Math.max(1, Math.sqrt(creatures.length / Math.max(0.5, aspect)));
  const targetRows = Math.max(1, Math.round(targetRowsRaw));
  const targetCols = Math.max(1, Math.ceil(creatures.length / targetRows));
  const slotInnerW = Math.max(5, Math.floor(innerWidth / targetCols) - SLOT_PAD_X);
  const slotInnerH = Math.max(
    3,
    Math.floor((canvasH - SKY_ROWS - GROUND_ROWS) / targetRows) - SLOT_PAD_Y
  );
  const maxCharW = Math.max(2, slotInnerW);
  const maxCharH = Math.max(2, slotInnerH - NAME_H);
  const sizeCohort = buildCreatureSizeCohort(creatures.map((creature) => creature.scan));
  return creatures.map((creature, index) => {
    const { charW, charH } = creatureCharSize(creature.scan, undefined, sizeCohort);
    const width = Math.max(2, Math.min(charW, maxCharW));
    const height = Math.max(2, Math.min(charH, maxCharH));
    return {
      creature,
      index,
      charW: width,
      charH: height,
      spriteCols: width,
      charRows: height
    };
  });
};

const buildScene = (props: GardenSceneProps): GardenScene => {
  const tiles = buildTiles(props);
  const placerZone = props.topRightDeadZone
    ? { width: props.topRightDeadZone.width, height: props.topRightDeadZone.height }
    : undefined;
  const layout =
    props.placementMode === "shelf"
      ? lineUpCreatures(tiles, props.innerWidth, props.canvasH, props.deadZone, placerZone)
      : {
          placements: placeCreatures(
            tiles,
            props.innerWidth,
            props.canvasH,
            stableCreatureIdsKey(props.creatures),
            props.deadZone,
            placerZone
          ),
          dividers: [],
          overflows: []
        };
  const sprites = new Map<string, GardenSpriteInfo>();
  for (const placement of layout.placements) {
    const creature = placement.tile.creature;
    // Sleepy-vibe creatures render with a `_` overlay at the eye cells
    // instead of the quadrant glyph the body grid would otherwise paint
    // there. The body grid itself is unchanged — same sub-pixel shape
    // open or closed — so a vibe flip never disturbs silhouette or size.
    // Gated on the bucket, not the continuous activity scalar, so eyes
    // only change when a creature's vibe flips.
    const eyesClosed = creature.vibe.vibe === "sleepy";
    const { frameA, frameB, eyeCells } = generateCreatureFrames(
      creature.scan.path || creature.id,
      placement.tile.charW,
      placement.tile.charH
    );
    const { body } = pickSpriteColors(
      creature.scan.path || creature.id,
      props.theme.creaturePalette
    );
    const vibeColor =
      creature.vibe.vibe === "stuck"
        ? props.theme.error
        : creature.vibe.vibe === "awake"
          ? props.theme.warning
          : creature.vibe.vibe === "sleepy"
            ? props.theme.info
            : props.theme.success;
    sprites.set(creature.id, {
      frameA,
      frameB,
      body,
      charW: placement.tile.charW,
      charH: placement.tile.charH,
      spriteCols: placement.tile.spriteCols,
      name: creature.scan.name,
      vibeGlyph: vibeGlyph(creature.vibe.vibe),
      vibeColor,
      wiggle: buildWiggleProfile(
        creature.scan.path || creature.id,
        creature.vibe.vibe,
        creature.vibe.activity
      ),
      eyeCells,
      eyesClosed,
      blink: buildBlinkProfile(
        creature.scan.path || creature.id,
        creature.vibe.activity
      )
    });
  }
  return {
    placements: layout.placements,
    dividers: layout.dividers,
    overflows: layout.overflows,
    sprites,
    sceneSeed: sceneSeedForCreatures(stableCreatureIdsKey(props.creatures))
  };
};

const buildWanderProfile = (vibe: Vibe, activity: number): WanderProfile => {
  const cfg = VIBE_WANDER[vibe];
  const a = clamp(activity, 0, 1);
  // Pull the *centre* of each range toward min when active, toward max
  // when inert. Keep a small ±25% spread either side of that centre so
  // pickInRange still varies tick-to-tick (otherwise every idle gap
  // would be identical and the swarm would breathe in lockstep).
  const skew = (min: number, max: number, lowEndWhenActive: boolean): { min: number; max: number } => {
    const span = max - min;
    const bias = lowEndWhenActive ? a : 1 - a;
    const centre = min + span * (1 - bias);
    const half = span * 0.25;
    return {
      min: Math.max(min, Math.round(centre - half)),
      max: Math.min(max, Math.round(centre + half))
    };
  };
  const idle = skew(cfg.idleMin, cfg.idleMax, true);
  const wander = skew(cfg.wanderMin, cfg.wanderMax, true);
  // Drift radius scales with activity too — sleepy/blocked repos barely
  // wander even within their own short range. Floor at 25% so a stale
  // creature still nudges occasionally instead of going stone-still.
  const radiusScale = 0.25 + 0.75 * a;
  return {
    idleMin: idle.min,
    idleMax: idle.max,
    wanderMin: wander.min,
    wanderMax: wander.max,
    radiusX: cfg.radiusX * radiusScale,
    radiusY: cfg.radiusY * radiusScale
  };
};

const createWanderState = (vibe: Vibe, activity: number, now: number): GardenWanderState => {
  const profile = buildWanderProfile(vibe, activity);
  return {
    kind: "round-trip",
    phase: "idle",
    idleUntil: now + pickInRange(profile.idleMin, profile.idleMax),
    wanderStartedAt: 0,
    wanderDurationMs: 0,
    outpoint: { x: 0, y: 0 },
    currentOffset: { x: 0, y: 0 },
    persistentOffset: { x: 0, y: 0 },
    profile
  };
};

const memoryManualOffset = (
  placement: Placement,
  placementMode: GardenSceneProps["placementMode"]
): { x: number; y: number } | undefined => {
  if (placementMode !== "organic") return undefined;
  const offset = placement.tile.creature.memory.gardenPlacement;
  return offset
    ? {
        x: Math.round(offset.offsetX),
        y: Math.round(offset.offsetY)
      }
    : undefined;
};

const ensureWanderState = (
  model: GardenModel,
  placement: Placement,
  now: number
): GardenWanderState => {
  const creature = placement.tile.creature;
  let state = model.wander.get(creature.id);
  if (!state) {
    state = createWanderState(creature.vibe.vibe, creature.vibe.activity, now);
    state.manualOffset = memoryManualOffset(placement, model.props.placementMode);
    model.wander.set(creature.id, state);
  }
  return state;
};

const effectivePersistentOffset = (
  state: GardenWanderState | undefined,
  placementMode: GardenSceneProps["placementMode"]
): { x: number; y: number } => {
  if (placementMode === "organic" && state?.manualOffset) return state.manualOffset;
  return state?.persistentOffset ?? { x: 0, y: 0 };
};

const hasNonZeroManualOffset = (
  model: GardenModel,
  placement: Placement
): boolean => {
  if (model.props.placementMode !== "organic") return false;
  const offset =
    model.wander.get(placement.tile.creature.id)?.manualOffset ??
    memoryManualOffset(placement, model.props.placementMode);
  return offset !== undefined && (offset.x !== 0 || offset.y !== 0);
};

const pickOutpoint = (profile: WanderProfile): { x: number; y: number } => {
  const angle = Math.random() * Math.PI * 2;
  const radius = 0.6 + Math.random() * 0.4;
  return {
    x: Math.cos(angle) * profile.radiusX * radius,
    y: Math.sin(angle) * profile.radiusY * radius
  };
};

const buildLayoutTransition = (
  scene: GardenScene,
  previousVisualPlacements: Map<string, Placement>,
  now: number
): GardenLayoutTransition | null => {
  const fromPlacements = new Map<string, { x: number; charY: number }>();
  for (const placement of scene.placements) {
    const previous = previousVisualPlacements.get(placement.tile.creature.id);
    if (!previous) continue;
    fromPlacements.set(placement.tile.creature.id, {
      x: previous.x,
      charY: previous.charY
    });
  }
  return fromPlacements.size > 0
    ? {
        startedAt: now,
        durationMs: LAYOUT_TRANSITION_MS,
        fromPlacements
      }
    : null;
};

const syncVisualPlacements = (
  model: GardenModel,
  now: number = performance.now()
): void => {
  const visualPlacements = new Map<string, Placement>();
  const acceptedFootprints: PlacementFootprint[] = [];
  const anchorFootprints = new Map(
    model.scene.placements
      .filter((placement) => !hasNonZeroManualOffset(model, placement))
      .map((placement) => [placement.tile.creature.id, spriteBodyFootprint(placement)])
  );
  const transition = model.layoutTransition;
  const progress = transition
    ? clamp((now - transition.startedAt) / Math.max(1, transition.durationMs), 0, 1)
    : 1;
  const eased = transition ? easeInOutCubic(progress) : 1;
  // Two-pass resolution: creatures with manual offsets occupy fixed spots
  // (the user dragged them there), so resolve them first and let
  // wandering / anchored neighbors check against their actual visual
  // positions. Without this, a wanderer iterated before a dragged
  // neighbor doesn't see the neighbor in `acceptedFootprints` and the
  // neighbor isn't in `anchorFootprints` (excluded by `filter` above),
  // so the wanderer can land on top of the dragged creature.
  const orderedPlacements = [
    ...model.scene.placements.filter((p) => hasNonZeroManualOffset(model, p)),
    ...model.scene.placements.filter((p) => !hasNonZeroManualOffset(model, p))
  ];
  for (const placement of orderedPlacements) {
    const creature = placement.tile.creature;
    const candidates: Placement[] = [];
    if (transition) {
      const from = transition.fromPlacements.get(creature.id);
      if (from) {
        pushCandidate(candidates, {
          tile: placement.tile,
          x: Math.round(from.x + (placement.x - from.x) * eased),
          charY: Math.round(from.charY + (placement.charY - from.charY) * eased)
        });
      }
    } else {
      const isFocused = placement.tile.index === model.props.focusIndex;
      const state = model.wander.get(creature.id);
      const baseOffset =
        state !== undefined
          ? effectivePersistentOffset(state, model.props.placementMode)
          : memoryManualOffset(placement, model.props.placementMode) ?? { x: 0, y: 0 };
      const baseOffsetX = Math.round(baseOffset.x);
      const baseOffsetY = Math.round(baseOffset.y);
      const transientOffsetX = isFocused ? 0 : Math.round(state?.currentOffset.x ?? 0);
      const transientOffsetY = isFocused ? 0 : Math.round(state?.currentOffset.y ?? 0);
      pushCandidate(
        candidates,
        visualPlacementAtOffset(
          placement,
          baseOffsetX + transientOffsetX,
          baseOffsetY + transientOffsetY,
          model.props.innerWidth,
          model.props.canvasH
        )
      );
      pushCandidate(
        candidates,
        visualPlacementAtOffset(
          placement,
          baseOffsetX,
          baseOffsetY,
          model.props.innerWidth,
          model.props.canvasH
        )
      );
    }
    pushCandidate(candidates, placement);

    const resolved =
      candidates.find((candidate) =>
        canUsePlacement(
          creature.id,
          candidate,
          acceptedFootprints,
          anchorFootprints,
          model.props.deadZone,
          model.props.innerWidth,
          model.props.canvasH
        )
      ) ??
      findNearestClearPlacement(
        placement,
        creature.id,
        acceptedFootprints,
        anchorFootprints,
        model.props.deadZone,
        model.props.innerWidth,
        model.props.canvasH
      ) ??
      placement;
    visualPlacements.set(creature.id, resolved);
    acceptedFootprints.push(spriteBodyFootprint(resolved));
  }
  if (transition && progress >= 1) {
    model.layoutTransition = null;
  }
  if (!transition && model.props.placementMode === "organic" && model.dragPreviewPlacements) {
    for (const [id, placement] of model.dragPreviewPlacements) {
      visualPlacements.set(id, placement);
    }
  }
  model.visualPlacements = visualPlacements;
};

export const createGardenModel = (
  props: GardenSceneProps,
  now: number = performance.now()
): GardenModel => {
  const model: GardenModel = {
    props,
    scene: buildScene(props),
    hoverIndex: -1,
    originX: 0,
    originY: 0,
    nextShiftAt: scheduleNextShiftAt(now),
    lastShiftAxis: "y",
    lastTickAt: now,
    wander: new Map(),
    layoutTransition: null,
    visualPlacements: new Map(),
    dragPreviewPlacements: null
  };
  syncVisualPlacements(model, now);
  return model;
};

export const syncGardenModel = (
  model: GardenModel,
  props: GardenSceneProps,
  now: number = performance.now()
): void => {
  const previousProps = model.props;
  const previousVisualPlacements = model.visualPlacements;
  const nextScene = buildScene(props);
  const shouldTweenLayout =
    !props.reducedMotion &&
    previousProps.placementMode !== props.placementMode &&
    previousProps.innerWidth === props.innerWidth &&
    previousProps.canvasH === props.canvasH &&
    stableCreatureIdsKey(previousProps.creatures) === stableCreatureIdsKey(props.creatures);
  model.props = props;
  model.scene = nextScene;
  model.dragPreviewPlacements = null;
  model.layoutTransition = shouldTweenLayout
    ? buildLayoutTransition(nextScene, previousVisualPlacements, now)
    : null;

  const validIds = new Set(model.scene.placements.map((placement) => placement.tile.creature.id));
  for (const id of Array.from(model.wander.keys())) {
    if (!validIds.has(id)) model.wander.delete(id);
  }
  for (const placement of model.scene.placements) {
    const state = model.wander.get(placement.tile.creature.id);
    if (state) {
      state.manualOffset = memoryManualOffset(placement, props.placementMode);
    }
  }
  if (model.hoverIndex >= props.creatures.length) {
    model.hoverIndex = -1;
  }
  model.lastTickAt = now;
  syncVisualPlacements(model, now);
};

export interface ManualGardenPlacementOffset {
  creatureId: string;
  offsetX: number;
  offsetY: number;
}

export interface ManualGardenPlacementResult {
  previewChanges: ManualGardenPlacementOffset[];
  commitChanges: ManualGardenPlacementOffset[] | null;
}

type PushAxis = "x" | "y";

type CollisionPolicy = "strict" | "squishy";

const placementByCreatureId = (
  placements: Placement[],
  creatureId: string
): Placement | undefined =>
  placements.find((placement) => placement.tile.creature.id === creatureId);

const movePlacementBy = (
  placement: Placement,
  dx: number,
  dy: number,
  canvasW: number,
  canvasH: number
): Placement =>
  visualPlacementAtOffset(placement, dx, dy, canvasW, canvasH);

const placementIsUsable = (
  placement: Placement,
  deadZone: GardenDeadZone | undefined,
  canvasW: number,
  canvasH: number
): boolean =>
  !footprintIntersectsDeadZone(spriteBodyFootprint(placement), deadZone, canvasW, canvasH);

const pushDeltaToClear = (
  pusher: Placement,
  pushed: Placement,
  axis: PushAxis,
  sign: 1 | -1,
  allowedOverlap: number
): { dx: number; dy: number } => {
  const pusherFootprint = spriteBodyFootprint(pusher);
  const pushedFootprint = spriteBodyFootprint(pushed);
  if (axis === "x") {
    return sign > 0
      ? { dx: pusherFootprint.right - pushedFootprint.left + 1 - allowedOverlap, dy: 0 }
      : { dx: pusherFootprint.left - pushedFootprint.right - 1 + allowedOverlap, dy: 0 };
  }
  return sign > 0
    ? { dx: 0, dy: pusherFootprint.bottom - pushedFootprint.top + 1 - allowedOverlap }
    : { dx: 0, dy: pusherFootprint.top - pushedFootprint.bottom - 1 + allowedOverlap };
};

const overlapDepth = (
  left: PlacementFootprint,
  right: PlacementFootprint,
  axis: PushAxis
): number => {
  if (axis === "x") {
    return Math.min(left.right, right.right) - Math.max(left.left, right.left) + 1;
  }
  return Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top) + 1;
};

const squishTolerance = (
  left: Placement,
  right: Placement,
  axis: PushAxis
): number => {
  const size =
    axis === "x"
      ? Math.min(left.tile.spriteCols, right.tile.spriteCols)
      : Math.min(left.tile.charRows, right.tile.charRows);
  return Math.max(1, Math.ceil(size / 2));
};

const allowedOverlapForPolicy = (
  policy: CollisionPolicy,
  left: Placement,
  right: Placement,
  axis: PushAxis
): number =>
  policy === "squishy" ? squishTolerance(left, right, axis) : 0;

const dragPushDirection = (
  current: Placement,
  candidate: Placement,
  targetX: number,
  targetY: number
): { axis: PushAxis; sign: 1 | -1 } => {
  const dx = candidate.x - current.x;
  const dy = candidate.charY - current.charY;
  const fallbackDx = Math.round(targetX) - current.x;
  const fallbackDy = Math.round(targetY) - current.charY;
  const resolvedDx = dx !== 0 ? dx : fallbackDx;
  const resolvedDy = dy !== 0 ? dy : fallbackDy;
  if (Math.abs(resolvedDx) >= Math.abs(resolvedDy) && resolvedDx !== 0) {
    return { axis: "x", sign: resolvedDx > 0 ? 1 : -1 };
  }
  if (resolvedDy !== 0) {
    return { axis: "y", sign: resolvedDy > 0 ? 1 : -1 };
  }
  return { axis: "x", sign: 1 };
};

const restPlacementFor = (
  model: GardenModel,
  anchor: Placement
): Placement => {
  // Steady-state position for a creature: anchor + manualOffset (if dragged)
  // or anchor + persistentOffset (if a relocate-wander completed). The
  // transient `currentOffset` wander bob is deliberately excluded so the
  // push solver reasons about where neighbours actually live, not where
  // they happen to be bobbing this frame. Without this, a drag near a
  // wanderer mid-cycle gets certified as clear and then collides once the
  // wander envelope returns to zero.
  const state = model.wander.get(anchor.tile.creature.id);
  const offset = effectivePersistentOffset(state, model.props.placementMode);
  return visualPlacementAtOffset(
    anchor,
    Math.round(offset.x),
    Math.round(offset.y),
    model.props.innerWidth,
    model.props.canvasH
  );
};

const resolvePushPlacements = (
  model: GardenModel,
  creatureId: string,
  candidate: Placement,
  direction: { axis: PushAxis; sign: 1 | -1 },
  policy: CollisionPolicy
): Map<string, Placement> | null => {
  const placements = new Map<string, Placement>();
  for (const anchor of model.scene.placements) {
    placements.set(anchor.tile.creature.id, restPlacementFor(model, anchor));
  }
  placements.set(creatureId, candidate);

  const moved = new Set<string>([creatureId]);
  const queue = [creatureId];
  const maxIterations = Math.max(8, model.scene.placements.length * model.scene.placements.length * 2);
  let iterations = 0;

  while (queue.length > 0) {
    const pusherId = queue.shift();
    if (!pusherId) continue;
    const pusher = placements.get(pusherId);
    if (!pusher) return null;
    if (!placementIsUsable(pusher, model.props.deadZone, model.props.innerWidth, model.props.canvasH)) {
      return null;
    }

    for (const anchor of model.scene.placements) {
      const pushedId = anchor.tile.creature.id;
      if (pushedId === pusherId) continue;
      const pushed = placements.get(pushedId);
      if (!pushed) return null;
      if (!spriteBodyFootprintsOverlap(spriteBodyFootprint(pusher), spriteBodyFootprint(pushed))) {
        continue;
      }

      const allowedOverlap = allowedOverlapForPolicy(policy, pusher, pushed, direction.axis);
      if (
        policy === "squishy" &&
        overlapDepth(spriteBodyFootprint(pusher), spriteBodyFootprint(pushed), direction.axis) <= allowedOverlap
      ) {
        continue;
      }

      iterations += 1;
      if (iterations > maxIterations) return null;
      const delta = pushDeltaToClear(pusher, pushed, direction.axis, direction.sign, allowedOverlap);
      const next = movePlacementBy(
        pushed,
        delta.dx,
        delta.dy,
        model.props.innerWidth,
        model.props.canvasH
      );
      if (next.x === pushed.x && next.charY === pushed.charY) return null;
      if (!placementIsUsable(next, model.props.deadZone, model.props.innerWidth, model.props.canvasH)) {
        return null;
      }
      placements.set(pushedId, next);
      moved.add(pushedId);
      queue.push(pushedId);
    }
  }

  const final = Array.from(placements.values());
  for (let i = 0; i < final.length; i += 1) {
    if (!placementIsUsable(final[i], model.props.deadZone, model.props.innerWidth, model.props.canvasH)) {
      return null;
    }
    for (let j = i + 1; j < final.length; j += 1) {
      if (!spriteBodyFootprintsOverlap(spriteBodyFootprint(final[i]), spriteBodyFootprint(final[j]))) {
        continue;
      }
      const allowedOverlap = allowedOverlapForPolicy(policy, final[i], final[j], direction.axis);
      if (overlapDepth(spriteBodyFootprint(final[i]), spriteBodyFootprint(final[j]), direction.axis) > allowedOverlap) {
        return null;
      }
    }
  }

  return new Map(Array.from(moved, (id) => [id, placements.get(id) as Placement]));
};

export const applyManualGardenPlacement = (
  model: GardenModel,
  creatureId: string,
  targetX: number,
  targetY: number,
  now: number = performance.now()
): ManualGardenPlacementResult | null => {
  if (model.props.placementMode !== "organic") return null;
  const anchor = placementByCreatureId(model.scene.placements, creatureId);
  if (!anchor) return null;
  const current = model.visualPlacements.get(creatureId) ?? anchor;

  const candidate = visualPlacementAtOffset(
    anchor,
    Math.round(targetX) - anchor.x,
    Math.round(targetY) - anchor.charY,
    model.props.innerWidth,
    model.props.canvasH
  );
  const direction = dragPushDirection(current, candidate, targetX, targetY);
  const preview = resolvePushPlacements(
    model,
    creatureId,
    candidate,
    direction,
    "squishy"
  );
  if (!preview) return null;
  const commit = resolvePushPlacements(
    model,
    creatureId,
    candidate,
    direction,
    "strict"
  );

  const toChanges = (placements: Map<string, Placement>): ManualGardenPlacementOffset[] | null => {
    const changes: ManualGardenPlacementOffset[] = [];
    for (const [id, placement] of placements) {
      const anchorPlacement = placementByCreatureId(model.scene.placements, id);
      if (!anchorPlacement) return null;
      changes.push({
        creatureId: id,
        offsetX: placement.x - anchorPlacement.x,
        offsetY: placement.charY - anchorPlacement.charY
      });
    }
    return changes;
  };

  model.dragPreviewPlacements = preview;
  const previewChanges = toChanges(preview);
  if (!previewChanges) return null;
  let commitChanges: ManualGardenPlacementOffset[] | null = null;
  if (commit) {
    commitChanges = toChanges(commit);
  }
  syncVisualPlacements(model, now);

  return { previewChanges, commitChanges };
};

export const commitManualGardenPlacement = (
  model: GardenModel,
  changes: ManualGardenPlacementOffset[],
  now: number = performance.now()
): void => {
  model.dragPreviewPlacements = null;
  for (const change of changes) {
    const id = change.creatureId;
    const anchorPlacement = placementByCreatureId(model.scene.placements, id);
    if (!anchorPlacement) continue;
    const state = ensureWanderState(model, anchorPlacement, now);
    state.phase = "idle";
    state.idleUntil = now + pickInRange(state.profile.idleMin, state.profile.idleMax);
    state.currentOffset = { x: 0, y: 0 };
    state.manualOffset = {
      x: change.offsetX,
      y: change.offsetY
    };
  }
  syncVisualPlacements(model, now);
};

export const clearManualGardenPlacementPreview = (
  model: GardenModel,
  now: number = performance.now()
): void => {
  model.dragPreviewPlacements = null;
  syncVisualPlacements(model, now);
};

export const stepGardenModel = (
  model: GardenModel,
  now: number = performance.now()
): void => {
  if (model.props.reducedMotion) {
    // Freeze decorative motion (origin drift + per-creature wander). Manual
    // drag offsets persist through wander state's manualOffset and still
    // apply via syncVisualPlacements; nudge nextShiftAt forward so toggling
    // motion back on doesn't fire a burst of catch-up shifts.
    for (const placement of model.scene.placements) {
      const state = ensureWanderState(model, placement, now);
      state.currentOffset = { x: 0, y: 0 };
      if (state.phase === "wandering") {
        state.phase = "idle";
        state.idleUntil = now + pickInRange(state.profile.idleMin, state.profile.idleMax);
      }
    }
    model.nextShiftAt = scheduleNextShiftAt(now);
    model.lastTickAt = now;
    syncVisualPlacements(model, now);
    return;
  }

  while (now >= model.nextShiftAt) {
    const useX =
      model.lastShiftAxis === "y" ? Math.random() < 0.75 : Math.random() < 0.4;
    if (useX) {
      model.originX += 1;
      model.lastShiftAxis = "x";
    } else {
      model.originY += 1;
      model.lastShiftAxis = "y";
    }
    model.nextShiftAt = scheduleNextShiftAt(model.nextShiftAt);
  }

  for (const placement of model.scene.placements) {
    const creature = placement.tile.creature;
    const isFocused = placement.tile.index === model.props.focusIndex;
    if (isFocused) {
      const state = ensureWanderState(model, placement, now);
      state.phase = "idle";
      state.idleUntil = now + pickInRange(state.profile.idleMin, state.profile.idleMax);
      state.currentOffset = { x: 0, y: 0 };
      continue;
    }

    const state = ensureWanderState(model, placement, now);

    if (state.phase === "idle" && now >= state.idleUntil) {
      state.kind = pickWanderKind(creature.vibe.vibe);
      state.phase = "wandering";
      state.wanderStartedAt = now;
      state.wanderDurationMs =
        pickInRange(state.profile.wanderMin, state.profile.wanderMax) *
        (state.kind === "relocate" ? 1.4 : 1);
      state.outpoint = pickOutpoint(state.profile);
    }

    if (state.phase === "wandering") {
      const t = (now - state.wanderStartedAt) / Math.max(1, state.wanderDurationMs);
      if (t >= 1) {
        state.phase = "idle";
        state.idleUntil = now + pickInRange(state.profile.idleMin, state.profile.idleMax);
        if (state.kind === "relocate" && !state.manualOffset) {
          const visual = visualPlacementAtOffset(
            placement,
            state.persistentOffset.x + state.outpoint.x,
            state.persistentOffset.y + state.outpoint.y,
            model.props.innerWidth,
            model.props.canvasH
          );
          state.persistentOffset = {
            x: visual.x - placement.x,
            y: visual.charY - placement.charY
          };
        }
        state.currentOffset = { x: 0, y: 0 };
      } else {
        const envelope =
          state.kind === "relocate"
            ? t < 0.5
              ? 2 * t * t
              : 1 - Math.pow(-2 * t + 2, 2) / 2
            : Math.sin(t * Math.PI);
        state.currentOffset = {
          x: Math.round(state.outpoint.x * envelope),
          y: Math.round(state.outpoint.y * envelope)
        };
      }
    } else {
      state.currentOffset = { x: 0, y: 0 };
    }
  }

  model.lastTickAt = now;
  syncVisualPlacements(model, now);
};

const spriteCellHasInk = (
  sprite: GardenSpriteInfo,
  cellX: number,
  cellY: number
): boolean => {
  if (cellX < 0 || cellY < 0 || cellX >= sprite.charW || cellY >= sprite.charH) return false;
  const sy = cellY * SUB_PER_CELL;
  const sx = cellX * SUB_PER_CELL;
  const frames = [sprite.frameA, sprite.frameB];
  return frames.some((frame) => {
    const tl = frame[sy]?.[sx] === 1;
    const tr = frame[sy]?.[sx + 1] === 1;
    const bl = frame[sy + 1]?.[sx] === 1;
    const br = frame[sy + 1]?.[sx + 1] === 1;
    return tl || tr || bl || br;
  });
};

const placementContainsSpriteCell = (
  placement: Placement,
  sprite: GardenSpriteInfo | undefined,
  localX: number,
  localY: number
): boolean => {
  const cellX = localX - placement.x;
  const cellY = localY - placement.charY;
  if (cellX < 0 || cellY < 0 || cellX >= placement.tile.spriteCols || cellY >= placement.tile.charRows) {
    return false;
  }
  return sprite ? spriteCellHasInk(sprite, cellX, cellY) : true;
};

const placementContainsNameCell = (
  placement: Placement,
  localX: number,
  localY: number
): boolean => {
  const nameStart = creatureNameStartCol(placement);
  const nameEnd = nameStart + placement.tile.creature.scan.name.length - 1;
  const nameRow = placement.charY + placement.tile.charRows + NAME_GAP_ROWS;
  return localY === nameRow && localX >= nameStart && localX <= nameEnd;
};

export const findCreatureAtCell = (
  model: GardenModel,
  localX: number,
  localY: number
): Placement | undefined => {
  for (const placement of model.scene.placements) {
    const visual = model.visualPlacements.get(placement.tile.creature.id) ?? placement;
    const sprite = model.scene.sprites.get(placement.tile.creature.id);
    if (placementContainsSpriteCell(visual, sprite, localX, localY)) return visual;
  }
  for (const placement of model.scene.placements) {
    const visual = model.visualPlacements.get(placement.tile.creature.id) ?? placement;
    if (placementContainsNameCell(visual, localX, localY)) return visual;
  }
  return undefined;
};

const placementContainsSpriteBox = (
  placement: Placement,
  localX: number,
  localY: number
): boolean => {
  return (
    localX >= placement.x &&
    localX < placement.x + placement.tile.spriteCols &&
    localY >= placement.charY &&
    localY < placement.charY + placement.tile.charRows
  );
};

export const findCreatureDragHandleAtCell = (
  model: GardenModel,
  localX: number,
  localY: number
): Placement | undefined => {
  const exact = findCreatureAtCell(model, localX, localY);
  if (exact) return exact;
  for (const placement of model.scene.placements) {
    const visual = model.visualPlacements.get(placement.tile.creature.id) ?? placement;
    if (placementContainsSpriteBox(visual, localX, localY)) return visual;
  }
  return undefined;
};
