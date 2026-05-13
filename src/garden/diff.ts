import chalk from "chalk";

import type { GardenCell, GardenFrame } from "@/garden/types";

const SAVE_CURSOR = "\x1b[s";
const RESTORE_CURSOR = "\x1b[u";

const styleCell = (cell: GardenCell): string => {
  let chain: typeof chalk = chalk;
  if (cell.fg) chain = chain.hex(cell.fg);
  if (cell.bg) chain = chain.bgHex(cell.bg);
  if (cell.bold) chain = chain.bold;
  return cell.fg || cell.bg || cell.bold ? chain(cell.char) : cell.char;
};

const cellAt = (frame: GardenFrame, x: number, y: number): GardenCell =>
  frame.cells[y * frame.width + x];

const cellsEqual = (left: GardenCell, right: GardenCell): boolean =>
  left.char === right.char &&
  left.fg === right.fg &&
  left.bg === right.bg &&
  left.bold === right.bold &&
  left.transparent === right.transparent;

export const diffFrames = (
  previous: GardenFrame | null,
  next: GardenFrame,
  originRow: number,
  originCol: number
): string => {
  let out = SAVE_CURSOR;
  let wrote = false;
  for (let y = 0; y < next.height; y += 1) {
    let x = 0;
    while (x < next.width) {
      const nextCell = cellAt(next, x, y);
      if (nextCell.transparent) {
        x += 1;
        continue;
      }
      const previousCell = previous && x < previous.width && y < previous.height
        ? cellAt(previous, x, y)
        : undefined;
      if (previousCell && cellsEqual(previousCell, nextCell)) {
        x += 1;
        continue;
      }
      const startX = x;
      let text = styleCell(nextCell);
      x += 1;
      while (x < next.width) {
        const runNext = cellAt(next, x, y);
        if (runNext.transparent) break;
        const runPrevious = previous && x < previous.width && y < previous.height
          ? cellAt(previous, x, y)
          : undefined;
        if (runPrevious && cellsEqual(runPrevious, runNext)) break;
        text += styleCell(runNext);
        x += 1;
      }
      out += `\x1b[${originRow + y};${originCol + startX}H${text}`;
      wrote = true;
    }
  }
  if (!wrote) return "";
  out += RESTORE_CURSOR;
  return out;
};

export const clearRect = (
  width: number,
  height: number,
  originRow: number,
  originCol: number
): string => {
  let out = SAVE_CURSOR;
  const blank = " ".repeat(width);
  for (let y = 0; y < height; y += 1) {
    out += `\x1b[${originRow + y};${originCol}H${blank}`;
  }
  out += RESTORE_CURSOR;
  return out;
};
