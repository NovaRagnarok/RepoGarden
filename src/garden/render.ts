import { computeFocusFrameCells, formatShelfDividerLabel, NAME_GAP_ROWS } from "@/lib/garden-layout";
import { quadrantChar } from "@/lib/sprite";

import { computeStarVisual, greyHex, starAtCell } from "@/garden/stars";
import { blinkClosedAt, wiggleFrameAt } from "@/garden/model";
import type { GardenCell, GardenFrame, GardenModel, GardenSpriteInfo } from "@/garden/types";
import type { Vibe } from "@/lib/vibe";

// Tightest cell rect that contains any lit sub-pixel across both animation
// frames. Sprite bitmaps frequently leave empty cells at the top/sides of
// their charW × charH bounding box (the body window in sprite.ts picks
// ~54-74% of the available height), and feeding the bounding box straight
// into the focus frame inflates the box well past the visible creature.
// OR-ing both frames keeps the frame stable through the body-bob — it
// reflects the creature's range of motion, not its instantaneous extent.
const visibleCellBounds = (
  info: GardenSpriteInfo
): { minCx: number; maxCx: number; minCy: number; maxCy: number } => {
  let minCx = info.charW;
  let maxCx = -1;
  let minCy = info.charH;
  let maxCy = -1;
  for (let cy = 0; cy < info.charH; cy += 1) {
    for (let cx = 0; cx < info.charW; cx += 1) {
      const sy = cy * SUB_PER_CELL;
      const sx = cx * SUB_PER_CELL;
      const on =
        info.frameA[sy]?.[sx] === 1 ||
        info.frameA[sy]?.[sx + 1] === 1 ||
        info.frameA[sy + 1]?.[sx] === 1 ||
        info.frameA[sy + 1]?.[sx + 1] === 1 ||
        info.frameB[sy]?.[sx] === 1 ||
        info.frameB[sy]?.[sx + 1] === 1 ||
        info.frameB[sy + 1]?.[sx] === 1 ||
        info.frameB[sy + 1]?.[sx + 1] === 1;
      if (!on) continue;
      if (cx < minCx) minCx = cx;
      if (cx > maxCx) maxCx = cx;
      if (cy < minCy) minCy = cy;
      if (cy > maxCy) maxCy = cy;
    }
  }
  if (maxCx < 0) {
    return { minCx: 0, maxCx: info.charW - 1, minCy: 0, maxCy: info.charH - 1 };
  }
  return { minCx, maxCx, minCy, maxCy };
};

// Lower one-quarter block — sits at the bottom of the cell like `_`
// but with a thicker bar that reads clearly as a closed eyelid.
const EYE_GLYPH_CLOSED = "▂";

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

const isInPaintExclusion = (model: GardenModel, x: number, y: number): boolean => {
  const exclusions = model.props.paintExclusions;
  if (!exclusions || exclusions.length === 0) return false;
  for (const rect of exclusions) {
    if (
      x >= rect.x &&
      y >= rect.y &&
      x < rect.x + rect.width &&
      y < rect.y + rect.height
    ) {
      return true;
    }
  }
  return false;
};

// Blend two `#rrggbb` hex colors at the given mix ratio (0 = pure `a`,
// 1 = pure `b`). Used to dial a room-separator color sitting halfway
// between the theme's dark `muted` and brighter `mutedForeground` —
// `muted` alone reads too dim for the boundary to register, but
// `mutedForeground` competes with sprite art.
const blendHex = (a: string, b: string, mix: number): string => {
  const parse = (hex: string): [number, number, number] => {
    const h = hex.replace("#", "");
    if (h.length !== 6) return [0, 0, 0];
    return [
      parseInt(h.slice(0, 2), 16),
      parseInt(h.slice(2, 4), 16),
      parseInt(h.slice(4, 6), 16),
    ];
  };
  const [ar, ag, ab] = parse(a);
  const [br, bg, bb] = parse(b);
  const t = Math.max(0, Math.min(1, mix));
  const lerp = (x: number, y: number): number => Math.round(x + (y - x) * t);
  const toHex = (n: number): string => n.toString(16).padStart(2, "0");
  return `#${toHex(lerp(ar, br))}${toHex(lerp(ag, bg))}${toHex(lerp(ab, bb))}`;
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
  const { deadZone, topRightDeadZone, paintExclusions, innerWidth, canvasH } = model.props;
  if (deadZone) {
    const left = innerWidth - deadZone.width;
    const top = canvasH - deadZone.height;
    if (x >= left && y >= top) return true;
  }
  if (paintExclusions) {
    for (const rect of paintExclusions) {
      if (x >= rect.x && y >= rect.y && x < rect.x + rect.width && y < rect.y + rect.height) {
        return true;
      }
    }
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
    case "stuck":
      return model.props.theme.error;
    case "awake":
      return model.props.theme.warning;
    case "sleepy":
      return model.props.theme.info;
    default:
      return model.props.theme.success;
  }
};

// Mid-tone separator color: 40% of the way from the theme's dark `muted`
// toward the brighter `mutedForeground`. Sits clearly below the sprite
// art but is still visible — pure `muted` reads too dim for the
// boundary to register, `mutedForeground` competes with the creatures.
const separatorColor = (model: GardenModel): string =>
  blendHex(model.props.theme.muted, model.props.theme.mutedForeground, 0.4);

const drawDivider = (
  frame: GardenFrame,
  model: GardenModel,
  row: number,
  vibe: Vibe,
  count: number,
  colStart: number,
  width: number
): void => {
  if (row < 0 || row >= frame.height) return;
  // Pull the dashes in aggressively from each end so the divider is
  // a short solid stroke flanking the label rather than a full-width
  // line. The label itself stays centred over the full span — only
  // the dash *segments* shrink. Solid `─` in `muted` colour rather
  // than the bright `mutedForeground` so the line sits quietly.
  const DIVIDER_INSET = Math.max(1, Math.floor(width / 4));
  const left = Math.max(0, colStart + DIVIDER_INSET);
  const right = Math.min(frame.width, colStart + width - DIVIDER_INSET);
  const span = right - left;
  if (span <= 0) return;
  const labelText = ` ${formatShelfDividerLabel(vibe, count, Math.max(0, span - 4))} `;
  const labelLen = Math.min(labelText.length, Math.max(0, span - 2));
  const labelStart = left + Math.max(1, Math.floor((span - labelLen) / 2));
  const labelEnd = labelStart + labelLen;
  for (let x = left; x < labelStart; x += 1) {
    setCell(frame, x, row, { char: "─", fg: separatorColor(model) });
  }
  for (let x = labelStart; x < labelEnd; x += 1) {
    setCell(frame, x, row, {
      char: labelText[x - labelStart],
      fg: dividerLabelColor(model, vibe),
      bold: true
    });
  }
  for (let x = labelEnd; x < right; x += 1) {
    setCell(frame, x, row, { char: "─", fg: separatorColor(model) });
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
      // Both branches mark the cell transparent so the diff writer skips
      // it — Ink owns those screen positions while the exclusion is live
      // (e.g. a transient toast). When the rect clears, the next frame
      // paints normally and any stars/sprites in those cells re-emerge.
      if (isInDeadZone(model, x, y) || isInPaintExclusion(model, x, y)) {
        return transparentCell();
      }
      return emptyCell();
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

  // Vertical separators between adjacent rooms. Drawn before dividers
  // so the divider's dashes paint over the separator at the
  // intersection. Solid `│` in the theme's dim `muted` colour rather
  // than the brighter `mutedForeground`, and pulled in by ~25% from
  // both ends so the line is a short stroke in the middle of the
  // boundary rather than a full floor-to-ceiling beam — softer
  // visually without losing the boundary cue.
  for (const separator of model.scene.separators ?? []) {
    const inset = Math.max(1, Math.floor(separator.length / 4));
    for (let dy = inset; dy < separator.length - inset; dy += 1) {
      const row = separator.canvasRow + dy;
      if (row < 0 || row >= frame.height) continue;
      if (separator.canvasCol < 0 || separator.canvasCol >= frame.width) continue;
      setCell(frame, separator.canvasCol, row, {
        char: "│",
        fg: separatorColor(model)
      });
    }
  }

  for (const divider of model.scene.dividers) {
    drawDivider(
      frame,
      model,
      divider.canvasRow,
      divider.vibe,
      divider.count,
      divider.canvasCol,
      divider.width
    );
  }

  for (const overflow of model.scene.overflows ?? []) {
    const label = `+${overflow.hidden} more`;
    const fg = dividerLabelColor(model, overflow.vibe);
    const labelLen = Math.min(label.length, overflow.slotW);
    const startCol = overflow.canvasCol + Math.floor((overflow.slotW - labelLen) / 2);
    for (let i = 0; i < labelLen; i += 1) {
      setCell(frame, startCol + i, overflow.canvasRow, {
        char: label[i],
        fg,
        bold: true
      });
    }
  }

  for (const placement of model.scene.placements) {
    const creature = placement.tile.creature;
    const visual = model.visualPlacements.get(creature.id) ?? placement;
    const info = model.scene.sprites.get(creature.id);
    if (!info) continue;
    // Sleepy creatures hold the body at rest (frame B = unshifted) so
    // the closed-eye overlay doesn't get dragged along by the body bob.
    // The bob shifts the body by half a cell, but a character glyph can
    // only sit in whole cells — there's no way to track half-cell
    // motion, so the cleanest fix is to skip the bob while asleep.
    // Awake creatures (including during the 140ms blink window) keep
    // their normal bob, and the per-frame eye cells track it.
    const useFrameB =
      info.eyesClosed || (!reducedMotion && wiggleFrameAt(info.wiggle, now) === 1);
    const spriteFrame = useFrameB ? info.frameB : info.frameA;
    const activeEyeCells = useFrameB ? info.eyeCells.frameB : info.eyeCells.frameA;
    // Closed eyes only override the body-grid paint — open eyes keep
    // the original sub-pixel-derived quadrant char so the awake look
    // matches the pre-face-panel rendering. The face panel (bg=body
    // + glyph cut into it) appears whenever the creature is sleepy,
    // or briefly during the blink window for awake creatures.
    const eyesShut =
      info.eyesClosed || (!reducedMotion && blinkClosedAt(info.blink, now));
    const eyeCellKeys = eyesShut
      ? new Set([
          `${activeEyeCells.left.cx}:${activeEyeCells.left.cy}`,
          `${activeEyeCells.right.cx}:${activeEyeCells.right.cy}`
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
        if (eyeCellKeys && eyeCellKeys.has(`${cx}:${cy}`)) {
          setCell(frame, visual.x + cx, visual.charY + cy, {
            char: EYE_GLYPH_CLOSED,
            fg: model.props.theme.background,
            bg: info.body
          });
          continue;
        }
        if (!(tl || tr || bl || br)) continue;
        setCell(frame, visual.x + cx, visual.charY + cy, {
          char: quadrantChar(tl, tr, bl, br),
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
    const focusInfo = model.scene.sprites.get(focusPlacement.tile.creature.id);
    // Shrink the frame anchor to the sprite's lit cells so the box hugs
    // the visible creature instead of the bitmap's bounding box.
    const tightVisual = focusInfo
      ? (() => {
          const bounds = visibleCellBounds(focusInfo);
          return {
            tile: {
              ...visual.tile,
              spriteCols: bounds.maxCx - bounds.minCx + 1,
              charRows: bounds.maxCy - bounds.minCy + 1
            },
            x: visual.x + bounds.minCx,
            charY: visual.charY + bounds.minCy
          };
        })()
      : visual;
    const focusCells = computeFocusFrameCells(tightVisual, {
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
