import type { MouseEvent } from "@/lib/mouse";

import { clearRect, diffFrames } from "@/garden/diff";
import {
  applyManualGardenPlacement,
  clearManualGardenPlacementPreview,
  commitManualGardenPlacement,
  createGardenModel,
  findCreatureAtCell,
  findCreatureDragHandleAtCell,
  stepGardenModel,
  syncGardenModel,
  wiggleFrameAt,
  type ManualGardenPlacementOffset
} from "@/garden/model";
import { renderGardenFrame } from "@/garden/render";
import type { GardenEngineProps, GardenFrame, GardenModel } from "@/garden/types";

const sameCanvas = (left: GardenEngineProps, right: GardenEngineProps): boolean =>
  left.originRow === right.originRow &&
  left.originCol === right.originCol &&
  left.innerWidth === right.innerWidth &&
  left.canvasH === right.canvasH;

const RESIZE_FULL_REPAINT_MS = 700;

const isInBottomRightDeadZone = (
  props: GardenEngineProps,
  localX: number,
  localY: number
): boolean => {
  if (!props.deadZone) return false;
  const left = props.innerWidth - props.deadZone.width;
  const top = props.canvasH - props.deadZone.height;
  return localX >= left && localY >= top;
};

interface CreatureVisualSnapshot {
  x: number;
  charY: number;
  spriteCols: number;
  charH: number;
  nameLength: number;
  wiggleFrame: 0 | 1;
}

interface DragState {
  creatureId: string;
  grabX: number;
  grabY: number;
  moved: boolean;
  lastCommitOffsets: ManualGardenPlacementOffset[] | null;
  lastPreviewKey: string | null;
}

export class GardenEngine {
  private props: GardenEngineProps;
  private model: GardenModel;
  private previousFrame: GardenFrame | null = null;
  private previousCreatureSnapshot = new Map<string, CreatureVisualSnapshot>();
  private tickId: ReturnType<typeof setInterval> | null = null;
  private destroyed = false;
  private drag: DragState | null = null;
  private forceFullRepaintUntil = 0;

  constructor(
    private readonly stdout: NodeJS.WriteStream,
    props: GardenEngineProps
  ) {
    this.props = props;
    const now = performance.now();
    this.model = createGardenModel(this.scenePropsFromEngineProps(props), now);
    stepGardenModel(this.model, now);
    this.render(now);
    this.tickId = setInterval(() => {
      if (this.destroyed) return;
      const tickNow = performance.now();
      stepGardenModel(this.model, tickNow);
      this.render(tickNow);
    }, 100);
  }

  setProps(nextProps: GardenEngineProps): void {
    if (this.destroyed) return;
    const canvasChanged = !sameCanvas(this.props, nextProps);
    const now = performance.now();
    if (canvasChanged) {
      this.previousFrame = null;
      this.forceFullRepaintUntil = Math.max(
        this.forceFullRepaintUntil,
        now + RESIZE_FULL_REPAINT_MS
      );
    }
    this.props = nextProps;
    if (nextProps.placementMode !== "organic") {
      this.drag = null;
    }
    syncGardenModel(this.model, this.scenePropsFromEngineProps(nextProps), now);
    stepGardenModel(this.model, now);
    this.render(now);
  }

  repaintFullFor(durationMs: number): void {
    if (this.destroyed) return;
    const now = performance.now();
    this.forceFullRepaintUntil = Math.max(this.forceFullRepaintUntil, now + durationMs);
    this.repaintFull();
  }

  repaintFull(): void {
    if (this.destroyed) return;
    this.previousFrame = null;
    this.render(performance.now());
  }

  private repaintDiff(): void {
    this.render(performance.now());
  }

  handleMouse(event: MouseEvent): void {
    if (this.destroyed) return;
    const localY = event.row - this.props.originRow;
    const localX = event.col - this.props.originCol;

    if (event.kind === "release" && this.drag) {
      const drag = this.drag;
      this.drag = null;
      if (drag?.moved) {
        const finalResult = applyManualGardenPlacement(
          this.model,
          drag.creatureId,
          localX - drag.grabX,
          localY - drag.grabY
        );
        const commitOffsets = finalResult?.commitChanges ?? drag.lastCommitOffsets;
        if (!commitOffsets) {
          clearManualGardenPlacementPreview(this.model);
          this.repaintDiff();
          return;
        }
        commitManualGardenPlacement(this.model, commitOffsets);
        const changes = commitOffsets.flatMap((offset) => {
          const placement = this.model.scene.placements.find(
            (candidate) => candidate.tile.creature.id === offset.creatureId
          );
          return placement
            ? [{
                creature: placement.tile.creature,
                offset: { offsetX: offset.offsetX, offsetY: offset.offsetY }
              }]
            : [];
        });
        if (changes.length > 0 && this.props.onCreaturePlacementChange) {
          this.props.onCreaturePlacementChange(changes);
        }
        this.repaintDiff();
      } else {
        clearManualGardenPlacementPreview(this.model);
        this.repaintDiff();
      }
      return;
    }

    if (event.kind === "drag" && event.button === "left" && this.drag) {
      const targetX = localX - this.drag.grabX;
      const targetY = localY - this.drag.grabY;
      const result = applyManualGardenPlacement(
        this.model,
        this.drag.creatureId,
        targetX,
        targetY
      );
      if (result) {
        const previewKey = result.previewChanges
          .map((offset) => `${offset.creatureId}:${offset.offsetX},${offset.offsetY}`)
          .join("|");
        if (previewKey === this.drag.lastPreviewKey) return;
        this.drag.moved = true;
        this.drag.lastPreviewKey = previewKey;
        if (result.commitChanges) {
          this.drag.lastCommitOffsets = result.commitChanges;
        }
        this.repaintDiff();
      }
      return;
    }

    if (event.kind === "move") {
      const nextHover =
        localY >= 0 &&
        localX >= 0 &&
        localY < this.props.canvasH &&
        localX < this.props.innerWidth &&
        !isInBottomRightDeadZone(this.props, localX, localY)
          ? findCreatureAtCell(this.model, localX, localY)?.tile.index ?? -1
          : -1;
      if (nextHover !== this.model.hoverIndex) {
        this.model.hoverIndex = nextHover;
        this.repaintDiff();
      }
      return;
    }

    if (localY < 0 || localX < 0 || localY >= this.props.canvasH || localX >= this.props.innerWidth) {
      if (this.model.hoverIndex !== -1) {
        this.model.hoverIndex = -1;
        this.repaintDiff();
      }
      return;
    }

    if (event.kind === "wheel" && this.props.onFocusDelta) {
      if (event.button === "wheel-up") this.props.onFocusDelta(-1);
      else if (event.button === "wheel-down") this.props.onFocusDelta(1);
      return;
    }

    if (event.kind !== "press" || event.button !== "left") return;
    if (isInBottomRightDeadZone(this.props, localX, localY)) return;
    if (this.drag) {
      this.drag = null;
      clearManualGardenPlacementPreview(this.model);
      this.repaintDiff();
    }
    const placement = findCreatureDragHandleAtCell(this.model, localX, localY);
    if (placement) {
      if (this.props.placementMode === "organic") {
        this.drag = {
          creatureId: placement.tile.creature.id,
          grabX: localX - placement.x,
          grabY: localY - placement.charY,
          moved: false,
          lastCommitOffsets: null,
          lastPreviewKey: null
        };
      }
      if (this.props.onCreatureSelect) {
        this.props.onCreatureSelect(placement.tile.index);
      }
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.drag = null;
    if (this.tickId) clearInterval(this.tickId);
    this.clearCurrent();
    this.previousFrame = null;
  }

  private scenePropsFromEngineProps(props: GardenEngineProps) {
    return {
      creatures: props.creatures,
      focusIndex: props.focusIndex,
      innerWidth: props.innerWidth,
      canvasH: props.canvasH,
      deadZone: props.deadZone,
      topRightDeadZone: props.topRightDeadZone,
      placementMode: props.placementMode,
      theme: props.theme,
      reducedMotion: props.reducedMotion
    };
  }

  private render(now: number): void {
    const output = this.renderOutput(now);
    if (output) this.stdout.write(output);
  }

  private renderOutput(now: number): string {
    const nextFrame = renderGardenFrame(this.model, now);
    const currentSnapshot = this.captureCreatureSnapshot(now);
    const diff = diffFrames(
      this.shouldRepaintFull(currentSnapshot, now) ? null : this.previousFrame,
      nextFrame,
      this.props.originRow,
      this.props.originCol
    );
    this.previousFrame = nextFrame;
    this.previousCreatureSnapshot = currentSnapshot;
    return diff;
  }

  private clearCurrent(): void {
    if (!this.previousFrame) return;
    this.stdout.write(
      clearRect(
        this.previousFrame.width,
        this.previousFrame.height,
        this.props.originRow,
        this.props.originCol
      )
    );
  }

  private captureCreatureSnapshot(now: number): Map<string, CreatureVisualSnapshot> {
    const snapshot = new Map<string, CreatureVisualSnapshot>();
    for (const [id, sprite] of this.model.scene.sprites) {
      const placement =
        this.model.visualPlacements.get(id) ??
        this.model.scene.placements.find((candidate) => candidate.tile.creature.id === id);
      if (!placement) continue;
      snapshot.set(id, {
        x: placement.x,
        charY: placement.charY,
        spriteCols: sprite.spriteCols,
        charH: sprite.charH,
        nameLength: sprite.name.length,
        wiggleFrame: wiggleFrameAt(sprite.wiggle, now)
      });
    }
    return snapshot;
  }

  private shouldRepaintFull(currentSnapshot: Map<string, CreatureVisualSnapshot>, now: number): boolean {
    if (now < this.forceFullRepaintUntil) return true;
    if (!this.previousFrame) return true;
    if (this.previousCreatureSnapshot.size !== currentSnapshot.size) return true;

    for (const [id, current] of currentSnapshot) {
      const previous = this.previousCreatureSnapshot.get(id);
      if (!previous) return true;
      if (
        previous.spriteCols !== current.spriteCols ||
        previous.charH !== current.charH ||
        previous.nameLength !== current.nameLength
      ) {
        return true;
      }
    }

    return false;
  }
}
