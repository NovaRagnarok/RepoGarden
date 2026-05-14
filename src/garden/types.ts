import type { RepoCreature } from "@/lib/creature";
import type { DividerPlacement, Placement } from "@/lib/garden-layout";

export interface GardenDeadZone {
  width: number;
  height: number;
}

export interface GardenTopRightDeadZone {
  width: number;
  height: number;
  starBlockRanges?: Array<{ top: number; height: number }>;
}

export interface GardenThemeColors {
  foreground: string;
  background: string;
  mutedForeground: string;
  primary: string;
  accent: string;
  success: string;
  warning: string;
  error: string;
  info: string;
  /** Carried through verbatim from Theme.creaturePalette so the engine can
   *  pick body colors without re-importing the theme provider. */
  creaturePalette?: import("@/lib/sprite").CreaturePalette;
}

export interface GardenSceneProps {
  creatures: RepoCreature[];
  focusIndex: number;
  innerWidth: number;
  canvasH: number;
  deadZone?: GardenDeadZone;
  topRightDeadZone?: GardenTopRightDeadZone;
  placementMode: "organic" | "shelf";
  theme: GardenThemeColors;
  reducedMotion?: boolean;
}

export interface GardenEngineProps extends GardenSceneProps {
  originRow: number;
  originCol: number;
  onCreatureSelect?: (index: number) => void;
  onFocusDelta?: (delta: number) => void;
  onCreaturePlacementChange?: (changes: Array<{
    creature: RepoCreature;
    offset: { offsetX: number; offsetY: number };
  }>) => void;
}

export interface GardenCell {
  char: string;
  fg?: string;
  bg?: string;
  bold?: boolean;
  transparent?: boolean;
}

export interface GardenFrame {
  width: number;
  height: number;
  cells: GardenCell[];
}

export interface WiggleProfile {
  halfCycleMs: number;
  phaseMs: number;
}

export interface GardenSpriteInfo {
  frameA: number[][];
  frameB: number[][];
  body: string;
  charW: number;
  charH: number;
  spriteCols: number;
  name: string;
  /** Single-character vibe glyph painted just before the name strip in the
   *  same colour as the sidebar's vibe dot. Carries the state signal that
   *  used to live in the body colour. */
  vibeGlyph: string;
  vibeColor: string;
  wiggle: WiggleProfile;
}

export interface GardenScene {
  placements: Placement[];
  dividers: DividerPlacement[];
  sprites: Map<string, GardenSpriteInfo>;
  sceneSeed: number;
}

/**
 * Per-creature wander timing, baked once when the wander state is
 * created so activity (a continuous 0–1 scalar) can pull idle gaps
 * within the vibe-bucket's range without re-resolving the bucket on
 * every tick. Active repos sit at the short end of the idle range,
 * sleepy ones at the long end; radius is also scaled down for inert
 * creatures so they barely drift.
 */
export interface WanderProfile {
  idleMin: number;
  idleMax: number;
  wanderMin: number;
  wanderMax: number;
  radiusX: number;
  radiusY: number;
}

export interface GardenWanderState {
  kind: "round-trip" | "relocate";
  phase: "idle" | "wandering";
  idleUntil: number;
  wanderStartedAt: number;
  wanderDurationMs: number;
  outpoint: { x: number; y: number };
  currentOffset: { x: number; y: number };
  persistentOffset: { x: number; y: number };
  manualOffset?: { x: number; y: number };
  /** Activity-baked timing. Replaces direct VIBE_WANDER reads on tick. */
  profile: WanderProfile;
}

export interface GardenLayoutTransition {
  startedAt: number;
  durationMs: number;
  fromPlacements: Map<string, { x: number; charY: number }>;
}

export interface GardenModel {
  props: GardenSceneProps;
  scene: GardenScene;
  hoverIndex: number;
  originX: number;
  originY: number;
  nextShiftAt: number;
  lastShiftAxis: "x" | "y";
  lastTickAt: number;
  wander: Map<string, GardenWanderState>;
  layoutTransition: GardenLayoutTransition | null;
  visualPlacements: Map<string, Placement>;
  dragPreviewPlacements: Map<string, Placement> | null;
}
