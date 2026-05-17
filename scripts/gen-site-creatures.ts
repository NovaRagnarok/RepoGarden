// Pre-render a habitat-worth of creatures for the landing page (docs/index.html)
// using the same deterministic generator the app ships in src/lib/sprite.ts.
//
// Run with: pnpm gen:site-creatures
//
// Output is spliced into docs/index.html between
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
  quadrantChar,
  type SubMatrix
} from "../src/lib/sprite";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const TARGET = join(ROOT, "docs/index.html");
const START = "<!-- REPOGARDEN-CREATURES:START";
const END = "<!-- REPOGARDEN-CREATURES:END -->";

// Names borrowed from src/lib/demo-roster.ts vibe (botanical/objecty), so the
// habitat reads like a plausible RepoGarden scan instead of generic dev jargon.
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

// Spread the cast loosely across the habitat box. Tuples are (top%, left%) of
// each creature's centre. Kept hand-picked so dense and sparse zones balance.
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

// Pick char-cell dimensions per identity. The app's creatureCharSize() needs a
// ScannedRepo cohort; here we approximate the same shape variety (small,
// mid, tall, wide) without dragging the scanner types in.
const sizeForIdentity = (id: string): { charW: number; charH: number } => {
  const rng = mulberry32(hashString(`site-size:${id}`));
  const bucket = rng();
  if (bucket < 0.15) return { charW: 5, charH: 3 };       // small
  if (bucket < 0.55) return { charW: 7, charH: 4 };       // mid
  if (bucket < 0.85) return { charW: 9, charH: 5 };       // large
  return { charW: 12, charH: 4 };                          // wide sausage
};

const moodForIdentity = (id: string): Mood => {
  const rng = mulberry32(hashString(`site-mood:${id}`));
  const r = rng();
  if (r < 0.5) return "happy";
  if (r < 0.85) return "sleepy";
  return "noisy";
};

const renderSprite = (grid: SubMatrix): string => {
  const subH = grid.length;
  const subW = grid[0]?.length ?? 0;
  const charH = subH / 2;
  const charW = subW / 2;
  const rows: string[] = [];
  for (let cy = 0; cy < charH; cy += 1) {
    let row = "";
    for (let cx = 0; cx < charW; cx += 1) {
      const tl = grid[cy * 2][cx * 2] === 1;
      const tr = grid[cy * 2][cx * 2 + 1] === 1;
      const bl = grid[cy * 2 + 1][cx * 2] === 1;
      const br = grid[cy * 2 + 1][cx * 2 + 1] === 1;
      row += quadrantChar(tl, tr, bl, br);
    }
    rows.push(row.replace(/\s+$/, ""));
  }
  // Trim fully blank top/bottom rows so the visual bounding box hugs the
  // creature rather than carrying the sprite generator's padding cells.
  while (rows.length && rows[0].trim() === "") rows.shift();
  while (rows.length && rows[rows.length - 1].trim() === "") rows.pop();
  return rows.join("\n");
};

const buildBlock = (): string => {
  const lines: string[] = [];
  NAMES.forEach((name, i) => {
    const { charW, charH } = sizeForIdentity(name);
    const grid = generateCreature(name, charW, charH);
    const sprite = renderSprite(grid);
    const { body } = pickSpriteColors(name);
    const mood = moodForIdentity(name);
    const [top, left] = POSITIONS[i % POSITIONS.length];
    const motion = MOTION_CLASSES[i % MOTION_CLASSES.length];
    const motionClass = motion ? ` ${motion}` : "";
    lines.push(
      `        <div class="creature${motionClass}" style="top: ${top}%; left: ${left}%; color: ${body}">`,
      `          <pre>${sprite}</pre>`,
      `          <span><span class="tag ${mood}">${MOOD_GLYPH[mood]}</span>${name}</span>`,
      `        </div>`
    );
  });
  return lines.join("\n");
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
