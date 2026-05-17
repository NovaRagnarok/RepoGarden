// Pre-render a habitat-worth of creatures for the landing page (docs/index.html)
// using the same deterministic generator the app ships in src/lib/sprite.ts.
//
// Run with: pnpm gen:site-creatures
//
// The TUI renders creatures with quadrant Unicode characters; on the web that
// path picks up font-specific hinting / bearing artefacts that read as faint
// asymmetry. We render the same sub-pixel grid as crisp-edged SVG rects so
// the result is pixel-perfect symmetric in any browser. Output is spliced
// into docs/index.html between
//   <!-- REPOGARDEN-CREATURES:START -->
//   <!-- REPOGARDEN-CREATURES:END -->
// so re-running this script is the supported way to refresh the cast.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  generateCreature,
  hashString,
  mulberry32,
  pickSpriteColors,
  type CreaturePalette,
  type SubMatrix
} from "../src/lib/sprite";

// Mirrors the high-contrast theme's palette (src/themes/high-contrast.ts):
// same arcade hue list as the default, but pushed to near-max saturation and
// slightly higher lightness so creatures pop on pure black.
const HIGH_CONTRAST_PALETTE: CreaturePalette = {
  hues: [355, 10, 25, 45, 60, 90, 120, 155, 180, 205, 235, 265],
  saturation: 0.95,
  lightness: 0.62,
  lightnessJitter: 0.05
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const TARGET = join(ROOT, "docs/index.html");
const FAVICON_TARGET = join(ROOT, "docs/favicon.svg");
const START = "<!-- REPOGARDEN-CREATURES:START";
const END = "<!-- REPOGARDEN-CREATURES:END -->";

// The favicon is the project's own deterministic creature — same generator,
// rendered into a square viewBox sized to align cleanly with the 16/32/48-px
// favicon slots browsers ask for. Color is overridden (not pickSpriteColors)
// so the icon reads as a brand mark rather than an instance of the cohort.
const FAVICON_SEED = "dewdrop";
const FAVICON_CHAR_W = 6;
const FAVICON_CHAR_H = 4;
const FAVICON_COLOR = "#66ddff"; // sky
const FAVICON_BG = "#001133";    // deep navy

const NAMES = [
  "glassmark",
  "habit-fossil",
  "pocket-cron",
  "salt-and-paper",
  "thornbush",
  "minnow",
  "lantern-rs",
  "dewdrop",
  "briar",
  "kettle",
  "moss-cms",
  "rivertown",
  "pinecone-press",
  "amberline"
];

type Mood = "happy" | "sleepy" | "noisy";
const MOOD_GLYPH: Record<Mood, string> = { happy: "●", sleepy: "z", noisy: "!" };

const POSITIONS: ReadonlyArray<readonly [number, number]> = [
  [28, 11],
  [22, 30],
  [62, 18],
  [34, 46],
  [58, 52],
  [18, 64],
  [70, 74],
  [40, 84],
  [78, 38],
  [14, 84],
  [82, 86],
  [80, 10],
  [48, 26],
  [50, 68]
];

const MOTION_CLASSES = ["", "m-b", "m-c", "m-d", "m-e"];

const sizeForIdentity = (id: string): { charW: number; charH: number } => {
  const rng = mulberry32(hashString(`site-size:${id}`));
  const bucket = rng();
  if (bucket < 0.15) return { charW: 5, charH: 3 };
  if (bucket < 0.55) return { charW: 7, charH: 4 };
  if (bucket < 0.85) return { charW: 9, charH: 5 };
  return { charW: 12, charH: 4 };
};

const moodForIdentity = (id: string): Mood => {
  const rng = mulberry32(hashString(`site-mood:${id}`));
  const r = rng();
  if (r < 0.5) return "happy";
  if (r < 0.85) return "sleepy";
  return "noisy";
};

// Each filled sub-pixel becomes one <rect>; integer coordinates + crispEdges
// disables anti-aliasing so mirrored pixels render identically.
const renderSpriteSvg = (grid: SubMatrix, color: string): { svg: string; w: number; h: number } => {
  const subH = grid.length;
  const subW = grid[0]?.length ?? 0;

  // Trim empty rows/cols so the SVG hugs the silhouette.
  let top = 0;
  while (top < subH && grid[top].every((v) => v === 0)) top += 1;
  let bottom = subH - 1;
  while (bottom > top && grid[bottom].every((v) => v === 0)) bottom -= 1;
  let left = 0;
  while (left < subW && grid.every((row) => row[left] === 0)) left += 1;
  let right = subW - 1;
  while (right > left && grid.every((row) => row[right] === 0)) right -= 1;

  // Always trim symmetrically: if we lop N columns from one side, lop the
  // same N from the other side so the centre line stays where setMirrored
  // placed it. Without this, an off-centre column of empty cells on one
  // side would shift the whole silhouette and break visual symmetry.
  const leftMargin = left;
  const rightMargin = subW - 1 - right;
  const margin = Math.min(leftMargin, rightMargin);
  left = margin;
  right = subW - 1 - margin;

  const w = right - left + 1;
  const h = bottom - top + 1;
  const rects: string[] = [];
  for (let y = top; y <= bottom; y += 1) {
    // Coalesce horizontal runs into a single rect for a smaller payload.
    let runStart = -1;
    for (let x = left; x <= right + 1; x += 1) {
      const filled = x <= right && grid[y][x] === 1;
      if (filled && runStart < 0) runStart = x;
      if (!filled && runStart >= 0) {
        rects.push(
          `<rect x="${runStart - left}" y="${y - top}" width="${x - runStart}" height="1"/>`
        );
        runStart = -1;
      }
    }
  }

  // Terminal cells are ~2:1 tall, so each sub-pixel reads as 1 wide × 2 tall
  // in the app. Mirror that aspect here so the website creatures match the
  // TUI silhouette instead of looking squashed.
  const svg =
    `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" ` +
    `preserveAspectRatio="none" ` +
    `shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg" ` +
    `style="fill: ${color}; width: ${w * 5}px; height: ${h * 10}px;">${rects.join("")}</svg>`;
  return { svg, w, h };
};

const buildBlock = (): string => {
  const lines: string[] = [];
  NAMES.forEach((name, i) => {
    const { charW, charH } = sizeForIdentity(name);
    const grid = generateCreature(name, charW, charH);
    const { body } = pickSpriteColors(name, HIGH_CONTRAST_PALETTE);
    const { svg } = renderSpriteSvg(grid, body);
    const mood = moodForIdentity(name);
    const [top, left] = POSITIONS[i % POSITIONS.length];
    const motion = MOTION_CLASSES[i % MOTION_CLASSES.length];
    const motionClass = motion ? ` ${motion}` : "";
    lines.push(
      `        <div class="creature${motionClass}" style="top: ${top}%; left: ${left}%;">`,
      `          <span class="sprite">${svg}</span>`,
      `          <span class="label"><span class="tag ${mood}">${MOOD_GLYPH[mood]}</span>${name}</span>`,
      `        </div>`
    );
  });
  return lines.join("\n");
};

const buildFavicon = (): string => {
  const grid = generateCreature(FAVICON_SEED, FAVICON_CHAR_W, FAVICON_CHAR_H);
  const body = FAVICON_COLOR;
  const subH = grid.length;
  const subW = grid[0]?.length ?? 0;

  // Trim empty rows top/bottom so creatures without antennae (or without
  // feet on a foot-reserve row) don't drift to one half of the icon. The
  // generator already centres horizontally via setMirrored, so the trim
  // here is vertical-only — preserving the silhouette's symmetry.
  let top = 0;
  while (top < subH && grid[top].every((v) => v === 0)) top += 1;
  let bottom = subH - 1;
  while (bottom > top && grid[bottom].every((v) => v === 0)) bottom -= 1;
  const trimmedH = bottom - top + 1;

  // Centre the (potentially narrower) creature in a 16×16 box and stretch
  // each sub-pixel 1 wide × 2 tall so the silhouette matches the site's
  // creature proportions.
  const stretched = { w: subW, h: trimmedH * 2 };
  const box = Math.max(16, stretched.w, stretched.h);
  const offsetX = Math.floor((box - stretched.w) / 2);
  const offsetY = Math.floor((box - stretched.h) / 2);

  const rects: string[] = [];
  for (let y = top; y <= bottom; y += 1) {
    let runStart = -1;
    for (let x = 0; x <= subW; x += 1) {
      const filled = x < subW && grid[y][x] === 1;
      if (filled && runStart < 0) runStart = x;
      if (!filled && runStart >= 0) {
        rects.push(
          `<rect x="${runStart + offsetX}" y="${(y - top) * 2 + offsetY}" ` +
            `width="${x - runStart}" height="2"/>`
        );
        runStart = -1;
      }
    }
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${box} ${box}" ` +
    `shape-rendering="crispEdges">` +
    `<rect width="${box}" height="${box}" fill="${FAVICON_BG}"/>` +
    `<g fill="${body}">${rects.join("")}</g>` +
    `</svg>\n`
  );
};

const splice = (): void => {
  const src = readFileSync(TARGET, "utf8");
  const startIdx = src.indexOf(START);
  const endIdx = src.indexOf(END);
  if (startIdx < 0 || endIdx < 0 || endIdx < startIdx) {
    throw new Error(`markers not found in ${TARGET}`);
  }
  const endOfStartLine = src.indexOf("\n", startIdx);
  const head = src.slice(0, endOfStartLine + 1);
  const tail = src.slice(endIdx);
  const next = `${head}${buildBlock()}\n        ${tail}`;
  writeFileSync(TARGET, next);
  console.log(`updated ${TARGET} (${NAMES.length} creatures)`);
};

splice();
writeFileSync(FAVICON_TARGET, buildFavicon());
console.log(`updated ${FAVICON_TARGET}`);
