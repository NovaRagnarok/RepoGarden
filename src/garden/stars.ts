import { hashString, mulberry32 } from "@/lib/sprite";

interface BloomCycle {
  cyclePeriod: number;
  bloomDuration: number;
  phaseOffset: number;
  tier: 0 | 1;
}

export interface RawStar {
  glyph: string;
  phase: number;
  speed: number;
  bloom?: BloomCycle;
}

const BLOOM_TIERS: readonly (readonly string[])[] = [
  ["·", "⋆", "+"],
  ["✧", "✦"]
];

const STAR_DENSITY = 0.048;
const STAR_GLYPHS: readonly { glyph: string; weight: number }[] = [
  { glyph: "·", weight: 22 },
  { glyph: "*", weight: 6 },
  { glyph: "+", weight: 2 },
  { glyph: "✦", weight: 1 },
  { glyph: "✧", weight: 1 },
  { glyph: "⋆", weight: 1 }
];
const TOTAL_STAR_WEIGHT = STAR_GLYPHS.reduce((sum, glyph) => sum + glyph.weight, 0);

const cellHash = (sceneSeed: number, wx: number, wy: number, salt: number): number => {
  let h = sceneSeed >>> 0;
  h = Math.imul(h ^ (wx | 0), 0x85ebca6b);
  h = Math.imul(h ^ (wy | 0), 0xc2b2ae35);
  h = Math.imul(h ^ (salt | 0), 0x27d4eb2f);
  h ^= h >>> 16;
  return h >>> 0;
};

const rawStarAtCell = (sceneSeed: number, wx: number, wy: number): RawStar | null => {
  const rng = mulberry32(cellHash(sceneSeed, wx, wy, 0xa5a5));
  if (rng() >= STAR_DENSITY) return null;
  let pick = rng() * TOTAL_STAR_WEIGHT;
  let chosen = STAR_GLYPHS[0];
  for (const glyph of STAR_GLYPHS) {
    pick -= glyph.weight;
    if (pick <= 0) {
      chosen = glyph;
      break;
    }
  }
  const phase = rng() * Math.PI * 2;
  const speed = 0.0006 + rng() * 0.0016;
  let bloom: BloomCycle | undefined;
  if (rng() < 0.2) {
    const cyclePeriod = 8000 + rng() * 10000;
    const tier = (rng() < 0.7 ? 0 : 1) as 0 | 1;
    bloom = {
      cyclePeriod,
      bloomDuration: 1600 + rng() * 1000,
      phaseOffset: rng() * cyclePeriod,
      tier
    };
  }
  return { glyph: chosen.glyph, phase, speed, bloom };
};

export const starAtCell = (sceneSeed: number, wx: number, wy: number): RawStar | null => {
  const me = rawStarAtCell(sceneSeed, wx, wy);
  if (!me) return null;
  const myPriority = cellHash(sceneSeed, wx, wy, 0x55aa);
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dy === 0) continue;
      if (!rawStarAtCell(sceneSeed, wx + dx, wy + dy)) continue;
      const neighborPriority = cellHash(sceneSeed, wx + dx, wy + dy, 0x55aa);
      if (neighborPriority > myPriority) return null;
    }
  }
  return me;
};

export const computeStarVisual = (
  star: RawStar,
  now: number,
  reducedMotion = false
): { grey: number; glyph: string } => {
  if (reducedMotion) {
    const glyph = star.bloom ? BLOOM_TIERS[star.bloom.tier][0] : star.glyph;
    return { grey: 120, glyph };
  }
  const brightness = (Math.sin(now * star.speed + star.phase) + 1) / 2;
  let grey = 64 + Math.round(brightness * 112);
  let glyph = star.glyph;
  if (star.bloom) {
    const tierGlyphs = BLOOM_TIERS[star.bloom.tier];
    const restGlyph = tierGlyphs[0];
    const cycleT = (now + star.bloom.phaseOffset) % star.bloom.cyclePeriod;
    if (cycleT < star.bloom.bloomDuration) {
      const bloomFrac = cycleT / star.bloom.bloomDuration;
      const triangle = bloomFrac < 0.5 ? bloomFrac * 2 : (1 - bloomFrac) * 2;
      const stage = Math.min(
        tierGlyphs.length - 1,
        Math.floor(triangle * tierGlyphs.length)
      );
      glyph = tierGlyphs[stage];
      grey = Math.min(0xc8, grey + Math.round(triangle * 60));
    } else {
      glyph = restGlyph;
    }
  }
  return { grey, glyph };
};

export const greyHex = (grey: number): string =>
  `#${Math.max(0, Math.min(255, grey)).toString(16).padStart(2, "0").repeat(3)}`;

export const sceneSeedForCreatures = (stableIdsKey: string): number =>
  hashString(`sky:${stableIdsKey}`);
