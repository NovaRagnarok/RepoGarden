import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCueProfile,
  buildFocusCaption,
  captionLength,
  CUE_PERIOD_MAX_MS,
  CUE_PERIOD_MIN_MS,
  CUE_VISIBLE_MAX_MS,
  CUE_VISIBLE_MIN_MS,
  cueVisibleAt,
  MAX_CUES_PER_FRAME,
  moodAccentColor,
  moodCueGlyph,
  NEVER_VISIBLE_CUE,
  planFocusCaptionPosition,
  selectCueIds,
  truncateWithEllipsis,
  type CaptionObstacle
} from "../lib/garden-captions";
import { createGardenModel, pinForExport } from "../garden/model";
import { renderGardenFrame } from "../garden/render";
import type { GardenFrame, GardenSceneProps } from "../garden/types";
import { vibeGlyph, MOOD_DISPLAY_CONFIDENCE_THRESHOLD } from "../lib/vibe";
import type { Mood, Vibe } from "../lib/vibe-types";
import type { RepoCreature } from "../lib/creature";

const ALL_MOODS: readonly Mood[] = [
  "curious",
  "excited",
  "proud",
  "anxious",
  "confused",
  "lonely",
  "content"
];

const PALETTE = {
  info: "#00ccff",
  success: "#00ff00",
  warning: "#ffcc00",
  error: "#ff0000",
  mutedForeground: "#777777"
};

// ---------------------------------------------------------------------------
// Glyph vocabulary
// ---------------------------------------------------------------------------

test("every non-content mood has a single-cell glyph distinct from existing vocabularies", () => {
  const vibeGlyphs = (["awake", "happy", "stuck", "sleepy"] as Vibe[]).map((vibe) =>
    vibeGlyph(vibe)
  );
  // Git bubbles (render chrome) + starfield glyphs incl. bloom tiers
  // (src/garden/stars.ts) — a cue must never read as a backdrop star.
  const reserved = new Set([...vibeGlyphs, "↓", "·", "*", "+", "✦", "✧", "⋆"]);
  const seen = new Set<string>();
  for (const mood of ALL_MOODS) {
    const glyph = moodCueGlyph(mood);
    if (mood === "content") {
      assert.equal(glyph, null, "content is the no-signal mood");
      continue;
    }
    assert.ok(glyph, `${mood} should have a glyph`);
    assert.equal(glyph.length, 1, `${mood} glyph must be a single cell`);
    assert.ok(!reserved.has(glyph), `${mood} glyph collides with an existing vocabulary`);
    assert.ok(!seen.has(glyph), `${mood} glyph duplicates another mood`);
    seen.add(glyph);
  }
});

test("mood accents follow the portrait chip severity mapping", () => {
  assert.equal(moodAccentColor("confused", PALETTE), PALETTE.error);
  assert.equal(moodAccentColor("anxious", PALETTE), PALETTE.warning);
  assert.equal(moodAccentColor("excited", PALETTE), PALETTE.info);
  assert.equal(moodAccentColor("curious", PALETTE), PALETTE.info);
  assert.equal(moodAccentColor("proud", PALETTE), PALETTE.success);
  assert.equal(moodAccentColor("lonely", PALETTE), PALETTE.mutedForeground);
});

// ---------------------------------------------------------------------------
// Caption text + gating
// ---------------------------------------------------------------------------

test("buildFocusCaption renders '<mood> — <reason>' for a confident mood", () => {
  const caption = buildFocusCaption(
    { mood: "excited", confidence: 0.8, moodReason: "6 unpushed commits stacked up" },
    80
  );
  assert.ok(caption);
  assert.equal(caption.glyph, "✶");
  assert.equal(caption.text, "excited — 6 unpushed commits stacked up");
  assert.equal(captionLength(caption), caption.text.length + 2);
});

test("buildFocusCaption gates on confidence and the content mood", () => {
  const below = MOOD_DISPLAY_CONFIDENCE_THRESHOLD - 0.01;
  assert.equal(
    buildFocusCaption({ mood: "excited", confidence: below, moodReason: "x" }, 80),
    null
  );
  assert.equal(
    buildFocusCaption({ mood: "content", confidence: 1, moodReason: "nothing remarkable" }, 80),
    null
  );
  // Exactly at the threshold shows (>= gate, matching the portrait chip).
  assert.ok(
    buildFocusCaption(
      { mood: "excited", confidence: MOOD_DISPLAY_CONFIDENCE_THRESHOLD, moodReason: "x" },
      80
    )
  );
});

test("buildFocusCaption truncates with an ellipsis and never exceeds the width", () => {
  const signal = {
    mood: "anxious" as Mood,
    confidence: 0.8,
    moodReason: "12 commits behind remote and the working tree is on fire"
  };
  const caption = buildFocusCaption(signal, 24);
  assert.ok(caption);
  assert.equal(captionLength(caption), 24);
  assert.ok(caption.text.endsWith("…"));
  // Way too narrow → skip entirely rather than paint a stub.
  assert.equal(buildFocusCaption(signal, 3), null);
});

test("truncateWithEllipsis edge cases", () => {
  assert.equal(truncateWithEllipsis("abc", 3), "abc");
  assert.equal(truncateWithEllipsis("abcd", 3), "ab…");
  assert.equal(truncateWithEllipsis("abcd", 1), "…");
  assert.equal(truncateWithEllipsis("abcd", 0), "");
});

// ---------------------------------------------------------------------------
// Caption positioning
// ---------------------------------------------------------------------------

const BASE = {
  frameTop: 5,
  frameLeft: 10,
  frameRight: 19,
  belowRow: 12,
  captionLen: 8,
  canvasW: 40,
  canvasH: 20,
  obstacles: [] as CaptionObstacle[]
};

test("caption prefers the row directly above the focus frame, centered", () => {
  const spot = planFocusCaptionPosition(BASE);
  assert.ok(spot);
  assert.equal(spot.y, 4);
  // Frame spans cols 10..19 (center 15); caption of 8 centers at 11.
  assert.equal(spot.x, 11);
  assert.equal(spot.maxLen, BASE.captionLen);
});

test("caption clamps horizontally to the canvas", () => {
  const left = planFocusCaptionPosition({ ...BASE, frameLeft: 0, frameRight: 3 });
  assert.ok(left);
  assert.equal(left.x, 0);
  const right = planFocusCaptionPosition({ ...BASE, frameLeft: 34, frameRight: 39 });
  assert.ok(right);
  assert.equal(right.x, BASE.canvasW - BASE.captionLen);
});

test("caption falls back below the name row when the sky row is off-canvas", () => {
  const spot = planFocusCaptionPosition({ ...BASE, frameTop: 0 });
  assert.ok(spot);
  assert.equal(spot.y, BASE.belowRow);
});

test("caption falls back below when the sky row hits another creature's footprint", () => {
  const obstacle: CaptionObstacle = { left: 0, right: 39, top: 4, bottom: 4 };
  const spot = planFocusCaptionPosition({ ...BASE, obstacles: [obstacle] });
  assert.ok(spot);
  assert.equal(spot.y, BASE.belowRow);
});

test("caption is skipped when both rows are blocked or off-canvas", () => {
  const blockedBoth: CaptionObstacle[] = [
    { left: 0, right: 39, top: 4, bottom: 4 },
    { left: 0, right: 39, top: 12, bottom: 12 }
  ];
  assert.equal(planFocusCaptionPosition({ ...BASE, obstacles: blockedBoth }), null);
  assert.equal(
    planFocusCaptionPosition({ ...BASE, frameTop: 0, belowRow: BASE.canvasH }),
    null
  );
});

test("caption ignores obstacles that don't intersect its span", () => {
  // Same rows but horizontally clear of the caption span (11..18).
  const aside: CaptionObstacle[] = [
    { left: 25, right: 39, top: 4, bottom: 4 },
    { left: 0, right: 5, top: 4, bottom: 4 }
  ];
  const spot = planFocusCaptionPosition({ ...BASE, obstacles: aside });
  assert.ok(spot);
  assert.equal(spot.y, 4);
});

test("caption wider than the canvas truncates to the canvas", () => {
  const spot = planFocusCaptionPosition({ ...BASE, captionLen: 41 });
  assert.ok(spot);
  assert.equal(spot.x, 0);
  assert.equal(spot.maxLen, BASE.canvasW);
});

test("caption squeezes into the clear gap next to a close neighbour", () => {
  // Neighbour body starting at col 21 on the sky row — caption (8 wide,
  // centered at 11) would overlap it, but the gap 0..20 still fits the
  // full caption.
  const fits = planFocusCaptionPosition({
    ...BASE,
    obstacles: [{ left: 21, right: 39, top: 0, bottom: 8 }]
  });
  assert.ok(fits);
  assert.equal(fits.y, 4);
  assert.equal(fits.maxLen, 8);
  assert.ok(fits.x + fits.maxLen - 1 <= 20, "caption must stay inside the gap");

  // Tighter neighbour (gap 0..17, width 18) with a long caption: the row
  // below is clear and fits more, so it wins over a clipped above-row.
  const below = planFocusCaptionPosition({
    ...BASE,
    captionLen: 30,
    obstacles: [{ left: 18, right: 39, top: 0, bottom: 8 }]
  });
  assert.ok(below);
  assert.equal(below.y, BASE.belowRow);
  assert.equal(below.maxLen, 30);

  // Both rows equally tight → prefer above, truncated into the gap.
  const squeezed = planFocusCaptionPosition({
    ...BASE,
    captionLen: 30,
    obstacles: [{ left: 18, right: 39, top: 0, bottom: 20 }]
  });
  assert.ok(squeezed);
  assert.equal(squeezed.y, 4);
  assert.equal(squeezed.maxLen, 18);
});

// ---------------------------------------------------------------------------
// Cue schedule
// ---------------------------------------------------------------------------

test("cue profiles are deterministic per identity+mood and stay in range", () => {
  const a = buildCueProfile("~/work/pocket-cron", "excited");
  const b = buildCueProfile("~/work/pocket-cron", "excited");
  assert.deepEqual(a, b);
  assert.ok(a.periodMs >= CUE_PERIOD_MIN_MS && a.periodMs <= CUE_PERIOD_MAX_MS);
  assert.ok(a.visibleMs >= CUE_VISIBLE_MIN_MS && a.visibleMs <= CUE_VISIBLE_MAX_MS);
  assert.ok(a.phaseMs >= 0 && a.phaseMs <= a.periodMs);
  // Same identity, different mood → different schedule seed.
  const c = buildCueProfile("~/work/pocket-cron", "anxious");
  assert.notDeepEqual(a, c);
});

test("different identities are desynchronized", () => {
  const profiles = ["alpha", "beta", "gamma", "delta"].map((id) =>
    buildCueProfile(`~/work/${id}`, "excited")
  );
  const phases = new Set(profiles.map((profile) => profile.phaseMs));
  assert.ok(phases.size > 1, "phase jitter should separate identities");
});

test("cueVisibleAt opens the same windows for the same profile", () => {
  const profile = buildCueProfile("~/work/pocket-cron", "excited");
  // Visible at the start of each period (offset by phase), hidden after
  // the visible window closes.
  const windowStart = profile.periodMs - profile.phaseMs;
  assert.equal(cueVisibleAt(profile, windowStart), true);
  assert.equal(cueVisibleAt(profile, windowStart + profile.visibleMs), false);
  assert.equal(cueVisibleAt(profile, windowStart + profile.periodMs), true);
  // Deterministic: re-evaluating the same instant agrees.
  assert.equal(cueVisibleAt(profile, windowStart), cueVisibleAt(profile, windowStart));
});

test("the pinned export profile never shows", () => {
  for (const t of [0, 1, 100, 10_000, 1e9]) {
    assert.equal(cueVisibleAt(NEVER_VISIBLE_CUE, t), false);
  }
});

// ---------------------------------------------------------------------------
// Global sparseness cap
// ---------------------------------------------------------------------------

test("selectCueIds caps at MAX_CUES_PER_FRAME with a deterministic winner set", () => {
  const ids = ["demo:kettle", "demo:minnow", "demo:briar", "demo:fernway"];
  const first = selectCueIds(ids);
  assert.equal(first.size, MAX_CUES_PER_FRAME);
  // Order-insensitive and stable across calls.
  const shuffled = selectCueIds([...ids].reverse());
  assert.deepEqual([...first].sort(), [...shuffled].sort());
});

test("selectCueIds passes small candidate sets through untouched", () => {
  assert.deepEqual([...selectCueIds(["solo"])], ["solo"]);
  assert.equal(selectCueIds([]).size, 0);
});

// ---------------------------------------------------------------------------
// Render-pass gating (real model + renderGardenFrame, no Ink)
// ---------------------------------------------------------------------------

const makeCreature = (
  id: string,
  mood: Mood,
  confidence: number,
  moodReason: string
): RepoCreature => ({
  id,
  scan: {
    id,
    path: `/tmp/${id}`,
    name: id,
    isDirty: false
  } as RepoCreature["scan"],
  memory: {},
  vibe: { vibe: "happy", reason: "clean", activity: 1, mood, confidence, moodReason }
});

const sceneProps = (
  creatures: RepoCreature[],
  overrides: Partial<GardenSceneProps> = {}
): GardenSceneProps => ({
  creatures,
  focusIndex: 0,
  innerWidth: 60,
  canvasH: 20,
  placementMode: "organic",
  theme: {
    foreground: "#ffffff",
    background: "#000000",
    muted: "#444444",
    mutedForeground: "#777777",
    primary: "#00ff00",
    accent: "#ffff00",
    success: "#00ff00",
    warning: "#ffcc00",
    error: "#ff0000",
    info: "#00ccff"
  },
  ...overrides
});

const frameText = (frame: GardenFrame): string => {
  const rows: string[] = [];
  for (let y = 0; y < frame.height; y += 1) {
    rows.push(
      frame.cells
        .slice(y * frame.width, (y + 1) * frame.width)
        .map((cell) => cell.char)
        .join("")
    );
  }
  return rows.join("\n");
};

// Sample a few minutes of renders — wide enough to cross any cue period.
const CUE_SAMPLE_TIMES = Array.from({ length: 480 }, (_, i) => i * 400);

test("renderGardenFrame paints the focus caption for a confident mood (reduced motion too)", () => {
  const props = sceneProps(
    [makeCreature("alpha", "excited", 0.8, "busy week")],
    { reducedMotion: true }
  );
  const frame = renderGardenFrame(createGardenModel(props, 0), 0);
  assert.match(frameText(frame), /✶ excited — busy week/);
});

test("renderGardenFrame paints no caption for content or low-confidence moods", () => {
  for (const creature of [
    makeCreature("alpha", "content", 0.9, "nothing remarkable"),
    makeCreature("alpha", "excited", 0.4, "busy week")
  ]) {
    const frame = renderGardenFrame(createGardenModel(sceneProps([creature]), 0), 0);
    assert.ok(!frameText(frame).includes("—"), "no caption body expected");
    assert.ok(!frameText(frame).includes("✶"), "no caption glyph expected");
  }
});

test("transient cues appear for a non-focused confident creature and respect reduced motion", () => {
  const creatures = [
    makeCreature("alpha", "content", 0.5, "nothing remarkable"),
    makeCreature("beta", "excited", 0.8, "busy week")
  ];
  const live = createGardenModel(sceneProps(creatures), 0);
  const liveShows = CUE_SAMPLE_TIMES.some((t) =>
    frameText(renderGardenFrame(live, t)).includes("✶")
  );
  assert.ok(liveShows, "cue glyph should appear at some point in the live garden");

  const reduced = createGardenModel(sceneProps(creatures, { reducedMotion: true }), 0);
  const reducedShows = CUE_SAMPLE_TIMES.some((t) =>
    frameText(renderGardenFrame(reduced, t)).includes("✶")
  );
  assert.ok(!reducedShows, "cues must stay off under reduced motion");
});

test("pinForExport disables transient cues entirely", () => {
  const creatures = [
    makeCreature("alpha", "content", 0.5, "nothing remarkable"),
    makeCreature("beta", "excited", 0.8, "busy week")
  ];
  const model = createGardenModel(sceneProps(creatures), 0);
  pinForExport(model);
  const shows = CUE_SAMPLE_TIMES.some((t) =>
    frameText(renderGardenFrame(model, t)).includes("✶")
  );
  assert.ok(!shows, "export renders must carry no transient cues");
});

test("the focused creature never shows a cue (its caption owns the mood signal)", () => {
  const props = sceneProps([makeCreature("alpha", "excited", 0.8, "busy week")]);
  const model = createGardenModel(props, 0);
  for (const t of CUE_SAMPLE_TIMES) {
    const text = frameText(renderGardenFrame(model, t));
    // Exactly one ✶ — the caption glyph — regardless of the cue schedule.
    const count = (text.match(/✶/g) ?? []).length;
    assert.equal(count, 1, `expected only the caption glyph at t=${t}`);
  }
});
