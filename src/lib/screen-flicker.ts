export interface ScreenSample {
  label: string;
  frame: string;
}

export interface ScreenDiffBounds {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

export interface ScreenTransition {
  fromLabel: string;
  toLabel: string;
  changedCells: number;
  bounds: ScreenDiffBounds | null;
  firstChange:
    | {
        row: number;
        col: number;
        before: string;
        after: string;
      }
    | null;
}

export interface ScreenHotspot extends ScreenDiffBounds {
  cells: number;
  hits: number;
  transitions: number;
}

export interface ScreenFlickerReport {
  width: number;
  height: number;
  sampleCount: number;
  transitionCount: number;
  changedTransitionCount: number;
  totalChangedCells: number;
  transitions: ScreenTransition[];
  hotspots: ScreenHotspot[];
}

interface AnalyzeOptions {
  width?: number;
  height?: number;
  hotspotLimit?: number;
}

interface PreparedFrame {
  label: string;
  rows: string[];
}

interface CellStats {
  hits: number;
  transitions: Set<number>;
}

const splitLines = (frame: string): string[] => {
  const normalized = frame.replace(/\r/g, "");
  const lines = normalized.split("\n");
  while (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
};

const prepareFrames = (
  samples: ScreenSample[],
  width?: number,
  height?: number
): { frames: PreparedFrame[]; width: number; height: number } => {
  const rawLines = samples.map((sample) => splitLines(sample.frame));
  const resolvedWidth =
    width ??
    rawLines.reduce(
      (max, lines) => Math.max(max, ...lines.map((line) => line.length), 0),
      0
    );
  const resolvedHeight =
    height ?? rawLines.reduce((max, lines) => Math.max(max, lines.length), 0);

  const frames = rawLines.map((lines, index) => {
    const padded = Array.from({ length: resolvedHeight }, (_, row) => {
      const line = lines[row] ?? "";
      return line.slice(0, resolvedWidth).padEnd(resolvedWidth, " ");
    });
    return { label: samples[index].label, rows: padded };
  });

  return { frames, width: resolvedWidth, height: resolvedHeight };
};

const cellKey = (row: number, col: number): string => `${row}:${col}`;

const buildHotspots = (
  cellStats: Map<string, CellStats>,
  hotspotLimit: number
): ScreenHotspot[] => {
  const visited = new Set<string>();
  const hotspots: ScreenHotspot[] = [];

  for (const key of cellStats.keys()) {
    if (visited.has(key)) continue;

    const [startRow, startCol] = key.split(":").map(Number);
    const queue = [{ row: startRow, col: startCol }];
    visited.add(key);

    let top = startRow;
    let left = startCol;
    let bottom = startRow;
    let right = startCol;
    let cells = 0;
    let hits = 0;
    const transitions = new Set<number>();

    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const { row, col } = queue[cursor];
      const stats = cellStats.get(cellKey(row, col));
      if (!stats) continue;

      cells += 1;
      hits += stats.hits;
      top = Math.min(top, row);
      left = Math.min(left, col);
      bottom = Math.max(bottom, row);
      right = Math.max(right, col);
      for (const transition of stats.transitions) {
        transitions.add(transition);
      }

      for (let rowOffset = -1; rowOffset <= 1; rowOffset += 1) {
        for (let colOffset = -1; colOffset <= 1; colOffset += 1) {
          if (rowOffset === 0 && colOffset === 0) continue;
          const nextRow = row + rowOffset;
          const nextCol = col + colOffset;
          const nextKey = cellKey(nextRow, nextCol);
          if (!cellStats.has(nextKey) || visited.has(nextKey)) continue;
          visited.add(nextKey);
          queue.push({ row: nextRow, col: nextCol });
        }
      }
    }

    hotspots.push({
      top,
      left,
      bottom,
      right,
      cells,
      hits,
      transitions: transitions.size
    });
  }

  return hotspots
    .sort((a, b) => {
      if (b.hits !== a.hits) return b.hits - a.hits;
      if (b.transitions !== a.transitions) return b.transitions - a.transitions;
      if (b.cells !== a.cells) return b.cells - a.cells;
      if (a.top !== b.top) return a.top - b.top;
      return a.left - b.left;
    })
    .slice(0, hotspotLimit);
};

export const analyzeScreenFlicker = (
  samples: ScreenSample[],
  options: AnalyzeOptions = {}
): ScreenFlickerReport => {
  if (samples.length < 2) {
    throw new Error("screen flicker analysis requires at least two samples");
  }

  const hotspotLimit = options.hotspotLimit ?? 6;
  const { frames, width, height } = prepareFrames(samples, options.width, options.height);
  const transitions: ScreenTransition[] = [];
  const cellStats = new Map<string, CellStats>();
  let totalChangedCells = 0;

  for (let index = 1; index < frames.length; index += 1) {
    const previous = frames[index - 1];
    const current = frames[index];

    let changedCells = 0;
    let top = Number.POSITIVE_INFINITY;
    let left = Number.POSITIVE_INFINITY;
    let bottom = 0;
    let right = 0;
    let firstChange: ScreenTransition["firstChange"] = null;

    for (let rowIndex = 0; rowIndex < height; rowIndex += 1) {
      const previousRow = previous.rows[rowIndex];
      const currentRow = current.rows[rowIndex];

      for (let colIndex = 0; colIndex < width; colIndex += 1) {
        const before = previousRow[colIndex] ?? " ";
        const after = currentRow[colIndex] ?? " ";
        if (before === after) continue;

        const row = rowIndex + 1;
        const col = colIndex + 1;
        changedCells += 1;
        totalChangedCells += 1;
        top = Math.min(top, row);
        left = Math.min(left, col);
        bottom = Math.max(bottom, row);
        right = Math.max(right, col);

        if (firstChange === null) {
          firstChange = { row, col, before, after };
        }

        const key = cellKey(row, col);
        const stats = cellStats.get(key) ?? { hits: 0, transitions: new Set<number>() };
        stats.hits += 1;
        stats.transitions.add(index);
        cellStats.set(key, stats);
      }
    }

    transitions.push({
      fromLabel: previous.label,
      toLabel: current.label,
      changedCells,
      bounds:
        changedCells === 0
          ? null
          : {
              top,
              left,
              bottom,
              right
            },
      firstChange
    });
  }

  return {
    width,
    height,
    sampleCount: frames.length,
    transitionCount: transitions.length,
    changedTransitionCount: transitions.filter((transition) => transition.changedCells > 0).length,
    totalChangedCells,
    transitions,
    hotspots: buildHotspots(cellStats, hotspotLimit)
  };
};

const formatRange = (single: string, plural: string, start: number, end: number): string =>
  start === end ? `${single} ${start}` : `${plural} ${start}-${end}`;

export const formatScreenFlickerReport = (report: ScreenFlickerReport): string => {
  const lines = [
    "Screen flicker report",
    `Samples: ${report.sampleCount} frames at ${report.width}x${report.height}`,
    `Transitions with changes: ${report.changedTransitionCount}/${report.transitionCount}`,
    `Total changed cells: ${report.totalChangedCells}`
  ];

  if (report.changedTransitionCount === 0) {
    lines.push("No changed cells detected across sampled frames.");
    return lines.join("\n");
  }

  lines.push("");
  lines.push("Hotspots:");
  for (const [index, hotspot] of report.hotspots.entries()) {
    lines.push(
      `${index + 1}. ${formatRange("row", "rows", hotspot.top, hotspot.bottom)}, ${formatRange(
        "col",
        "cols",
        hotspot.left,
        hotspot.right
      )} | ${hotspot.cells} cells | ${hotspot.hits} hits across ${hotspot.transitions} transitions`
    );
  }

  lines.push("");
  lines.push("Transitions:");
  for (const transition of report.transitions) {
    if (transition.changedCells === 0 || transition.bounds === null || transition.firstChange === null) {
      lines.push(`${transition.fromLabel} -> ${transition.toLabel}: stable`);
      continue;
    }

    const firstBefore = transition.firstChange.before === " " ? "<space>" : transition.firstChange.before;
    const firstAfter = transition.firstChange.after === " " ? "<space>" : transition.firstChange.after;
    lines.push(
      `${transition.fromLabel} -> ${transition.toLabel}: ${transition.changedCells} cells, ${formatRange(
        "row",
        "rows",
        transition.bounds.top,
        transition.bounds.bottom
      )}, ${formatRange("col", "cols", transition.bounds.left, transition.bounds.right)}; first change at row ${
        transition.firstChange.row
      }, col ${transition.firstChange.col} (${firstBefore} -> ${firstAfter})`
    );
  }

  return lines.join("\n");
};
