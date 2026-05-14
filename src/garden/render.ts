import { computeFocusFrameCells, NAME_GAP_ROWS } from "@/lib/garden-layout";
import { quadrantChar } from "@/lib/sprite";

import { computeStarVisual, greyHex, starAtCell } from "@/garden/stars";
import { wiggleFrameAt } from "@/garden/model";
import type { GardenCell, GardenFrame, GardenModel } from "@/garden/types";

const SUB_PER_CELL = 2;

const emptyCell = (): GardenCell => ({ char: " " });

const transparentCell = (): GardenCell => ({ char: " ", transparent: true });

const isInDeadZone = (model: GardenModel, x: number, y: number): boolean => {
  const { deadZone, innerWidth, canvasH } = model.props;
  if (!deadZone) return false;
  const left = innerWidth - deadZone.width;
  const top = canvasH - deadZone.height;
  return x >= left && y >= top;
};

const setCell = (
  frame: GardenFrame,
  x: number,
  y: number,
  next: GardenCell
): void => {
  if (x < 0 || y < 0 || x >= frame.width || y >= frame.height) return;
  const index = y * frame.width + x;
  if (frame.cells[index]?.transparent) return;
  frame.cells[index] = next;
};

const blockStarsForOverlays = (
  model: GardenModel,
  x: number,
  y: number
): boolean => {
  const { deadZone, topRightDeadZone, innerWidth, canvasH } = model.props;
  if (deadZone) {
    const left = innerWidth - deadZone.width;
    const top = canvasH - deadZone.height;
    if (x >= left && y >= top) return true;
  }
  if (topRightDeadZone) {
    const left = innerWidth - topRightDeadZone.width;
    const ranges = topRightDeadZone.starBlockRanges ?? [
      { top: 0, height: topRightDeadZone.height }
    ];
    if (x >= left) {
      for (const range of ranges) {
        if (y >= range.top && y < range.top + range.height) return true;
      }
    }
  }
  return false;
};

const dividerLabelColor = (model: GardenModel, vibe: string): string => {
  switch (vibe) {
    case "blocked":
      return model.props.theme.error;
    case "noisy":
      return model.props.theme.warning;
    case "sleepy":
      return model.props.theme.info;
    default:
      return model.props.theme.success;
  }
};

const drawDivider = (
  frame: GardenFrame,
  model: GardenModel,
  row: number,
  vibe: string,
  count: number
): void => {
  if (row < 0 || row >= frame.height) return;
  const tail = count === 0 && vibe === "blocked" ? "all clear" : String(count);
  const labelText = ` ${vibe} · ${tail} `;
  const labelLen = Math.min(labelText.length, frame.width - 2);
  const labelStart = Math.max(1, Math.floor((frame.width - labelLen) / 2));
  const labelEnd = labelStart + labelLen;
  const sideLen = Math.max(2, Math.floor(frame.width / 4));
  const leftDashStart = Math.max(0, labelStart - sideLen);
  const rightDashEnd = Math.min(frame.width, labelEnd + sideLen);
  for (let x = leftDashStart; x < labelStart; x += 1) {
    setCell(frame, x, row, { char: "─", fg: model.props.theme.mutedForeground });
  }
  for (let x = labelStart; x < labelEnd; x += 1) {
    setCell(frame, x, row, {
      char: labelText[x - labelStart],
      fg: dividerLabelColor(model, vibe),
      bold: true
    });
  }
  for (let x = labelEnd; x < rightDashEnd; x += 1) {
    setCell(frame, x, row, { char: "─", fg: model.props.theme.mutedForeground });
  }
};

export const renderGardenFrame = (
  model: GardenModel,
  now: number = performance.now()
): GardenFrame => {
  const frame: GardenFrame = {
    width: model.props.innerWidth,
    height: model.props.canvasH,
    cells: Array.from({ length: model.props.innerWidth * model.props.canvasH }, (_, index) => {
      const x = index % model.props.innerWidth;
      const y = Math.floor(index / model.props.innerWidth);
      return isInDeadZone(model, x, y) ? transparentCell() : emptyCell();
    })
  };

  const reducedMotion = model.props.reducedMotion === true;
  for (let y = 0; y < frame.height; y += 1) {
    for (let x = 0; x < frame.width; x += 1) {
      if (blockStarsForOverlays(model, x, y)) continue;
      const star = starAtCell(model.scene.sceneSeed, x + model.originX, y + model.originY);
      if (!star) continue;
      const { grey, glyph } = computeStarVisual(star, now, reducedMotion);
      setCell(frame, x, y, { char: glyph, fg: greyHex(grey) });
    }
  }

  for (const divider of model.scene.dividers) {
    drawDivider(frame, model, divider.canvasRow, divider.vibe, divider.count);
  }

  for (const placement of model.scene.placements) {
    const creature = placement.tile.creature;
    const visual = model.visualPlacements.get(creature.id) ?? placement;
    const info = model.scene.sprites.get(creature.id);
    if (!info) continue;
    const spriteFrame =
      !reducedMotion && wiggleFrameAt(info.wiggle, now) === 1
        ? info.frameB
        : info.frameA;
    const closedEye = info.eyesClosed
      ? new Set([
          `${info.eyeCells.left.cx}:${info.eyeCells.left.cy}`,
          `${info.eyeCells.right.cx}:${info.eyeCells.right.cy}`
        ])
      : null;
    for (let cy = 0; cy < info.charH; cy += 1) {
      for (let cx = 0; cx < info.charW; cx += 1) {
        const sy = cy * SUB_PER_CELL;
        const sx = cx * SUB_PER_CELL;
        const tl = spriteFrame[sy]?.[sx] === 1;
        const tr = spriteFrame[sy]?.[sx + 1] === 1;
        const bl = spriteFrame[sy + 1]?.[sx] === 1;
        const br = spriteFrame[sy + 1]?.[sx + 1] === 1;
        if (!(tl || tr || bl || br)) continue;
        // Closed-eye overlay: replace the quadrant char at each eye cell
        // with `_`. Body grid stays untouched so silhouette is stable.
        const char =
          closedEye && closedEye.has(`${cx}:${cy}`)
            ? "_"
            : quadrantChar(tl, tr, bl, br);
        setCell(frame, visual.x + cx, visual.charY + cy, {
          char,
          fg: info.body
        });
      }
    }
  }

  for (const placement of model.scene.placements) {
    const creature = placement.tile.creature;
    const visual = model.visualPlacements.get(creature.id) ?? placement;
    const info = model.scene.sprites.get(creature.id);
    if (!info) continue;
    const nameRow = visual.charY + info.charH + NAME_GAP_ROWS;
    // Label is "<glyph> <space> <name>" — 2 cells of prefix carry the vibe
    // signal that body color used to. Center the WHOLE label under the
    // sprite so a single-char glyph doesn't pull the name off-center.
    const labelLen = info.name.length + 2;
    const labelStart = visual.x + Math.floor((info.spriteCols - labelLen) / 2);
    const isFocused = placement.tile.index === model.props.focusIndex;
    const isHovered =
      placement.tile.index === model.hoverIndex && !isFocused;
    const nameColor = isFocused
      ? model.props.theme.primary
      : isHovered
        ? model.props.theme.accent
        : model.props.theme.foreground;
    // Glyph keeps its vibe colour even when focused/hovered — it's a
    // status signal, not a focus signal.
    setCell(frame, labelStart, nameRow, {
      char: info.vibeGlyph,
      fg: info.vibeColor,
      bold: true
    });
    for (let i = 0; i < info.name.length; i += 1) {
      setCell(frame, labelStart + 2 + i, nameRow, {
        char: info.name[i],
        fg: nameColor,
        bold: isFocused
      });
    }
  }

  const focusPlacement = model.scene.placements.find(
    (placement) => placement.tile.index === model.props.focusIndex
  );
  if (focusPlacement) {
    const visual = model.visualPlacements.get(focusPlacement.tile.creature.id) ?? focusPlacement;
    const focusCells = computeFocusFrameCells(visual, {
      canvasW: frame.width,
      canvasH: frame.height,
      deadZone: model.props.deadZone
    });
    for (const cell of focusCells) {
      setCell(frame, cell.col, cell.row, {
        char: cell.char,
        fg: model.props.theme.primary,
        bold: cell.alwaysBold
      });
    }
  }

  return frame;
};
