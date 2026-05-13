import { readFileSync } from "node:fs";
import { basename } from "node:path";

import { analyzeScreenFlicker, formatScreenFlickerReport, type ScreenSample } from "@/lib/screen-flicker";

const usage = (): never => {
  console.error("Usage: tsx src/tools/tui-flicker.ts [--width N] [--height N] <capture-file...>");
  process.exit(1);
};

const args = process.argv.slice(2);
const files: string[] = [];
let width: number | undefined;
let height: number | undefined;

for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (arg === "--width") {
    const value = Number(args[index + 1]);
    if (!Number.isInteger(value) || value <= 0) usage();
    width = value;
    index += 1;
    continue;
  }
  if (arg === "--height") {
    const value = Number(args[index + 1]);
    if (!Number.isInteger(value) || value <= 0) usage();
    height = value;
    index += 1;
    continue;
  }
  if (arg === "-h" || arg === "--help") {
    usage();
  }
  files.push(arg);
}

if (files.length < 2) {
  usage();
}

const samples: ScreenSample[] = files.map((file) => ({
  label: basename(file),
  frame: readFileSync(file, "utf8")
}));

const report = analyzeScreenFlicker(samples, { width, height });
console.log(formatScreenFlickerReport(report));
