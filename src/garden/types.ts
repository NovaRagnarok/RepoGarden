import type { RepoCreature } from "@/lib/creature";
import type { Vibe } from "@/lib/vibe";
import type {
  DividerPlacement,
  GardenDensity,
  Placement,
  RoomSeparator,
  ShelfOverflow,
} from "@/lib/garden-layout";

export interface GardenDeadZone {
  width: number;
  height: number;
}

export interface GardenTopRightDeadZone {
  width: number;
  height: number;
  starBlockRanges?: Array<{ top: number; height: number }>;
}

/**
 * Paint-only exclusion rectangle in canvas-local coordinates. Cells inside
 * the rect are skipped by the star/sprite painter (rendered as transparent
 * so the diff writer emits no escape sequences for them), letting whatever
 * Ink draws at the same screen position survive between frames. Unlike
 * `deadZone` and `topRightDeadZone`, the placement/wander/drag math does
 * not consult these — they're a layer-mask, not a layout constraint. Used
 * for transient overlays like the bottom-right toast, which lives inside
 * the garden panel but is owned by Ink rather than the engine.
 */
export interface GardenPaintExclusion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GardenThemeColors {
  foreground: string;
  background: string;
  muted: string;
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
  paintExclusions?: GardenPaintExclusion[];
  placementMode: "organic" | "rooms";
  theme: GardenThemeColors;
  reducedMotion?: boolean;
  /** Pagination capacity knob for the garden view. Rooms mode ignores it
   *  (rooms defer to the organic placer per quadrant, which has no
   *  density concept); the field is kept on this shared props bag so
   *  ReadyShell can pass the same setting through regardless of mode. */
  density?: GardenDensity;
  /** Per-vibe page index for rooms mode. Each cohort paginates
   *  independently against its own room's capacity, so a small terminal
   *  where the awake room only fits 4 creatures can still show all 7 by
   *  flipping pages without affecting the happy / stuck / sleepy rooms.
   *  Garden mode ignores this. */
  roomsPageIndex?: Partial<Record<Vibe, number>>;
  /** Freeze per-creature wander animation regardless of the user's
   *  `reducedMotion` setting. Used by rooms view, where creatures sit
   *  in a uniform grid — wander would re-introduce the "messy" feel
   *  the grid is meant to remove. */
  disableWander?: boolean;
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
  /** Character-cell coordinates of the sprite's two eyes per animation
   *  frame. `frameA` and `frameB` differ when the creature is body-
   *  bobbing — the eye overlay tracks the bob so the closed-eye glyph
   *  moves with the face instead of staying glued to a fixed cell. */
  eyeCells: {
    frameA: { left: { cx: number; cy: number }; right: { cx: number; cy: number } };
    frameB: { left: { cx: number; cy: number }; right: { cx: number; cy: number } };
  };
  /** When true, the eye glyph is locked to the closed form regardless
   *  of blink timing. */
  eyesClosed: boolean;
  blink: BlinkProfile;
}

export interface GardenScene {
  placements: Placement[];
  dividers: DividerPlacement[];
  overflows: ShelfOverflow[];
  /** Vertical lines between adjacent rooms — only populated when
   *  placementMode is "rooms". Garden mode leaves this empty. */
  separators: RoomSeparator[];
  sprites: Map<string, GardenSpriteInfo>;
  sceneSeed: number;
}

/**
 * Per-creature blink timing for the composited face-panel eyes. Active
 * (non-sleepy) creatures blink briefly every few seconds; sleepy
 * creatures hold the closed glyph regardless. Active repos blink
 * slightly more often than inert ones (interval shrinks with activity).
 *
 * `phaseMs` is randomised per identity so the swarm doesn't blink in
 * unison. `durationMs` is the (short) window where the closed glyph
 * paints; otherwise the open glyph paints.
 */
export interface BlinkProfile {
  intervalMs: number;
  durationMs: number;
  phaseMs: number;
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
