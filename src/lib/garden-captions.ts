// Pure model logic for the garden's mood captions and transient emotion
// cues. Mirrors the garden-layout.ts split: anything that maps "mood +
// geometry" → "what paints where" lives here so unit tests don't need Ink
// or the render pass. The actual setCell painting stays in
// src/garden/render.ts.

import { hashString, mulberry32 } from "@/lib/sprite";
import { MOOD_DISPLAY_CONFIDENCE_THRESHOLD } from "@/lib/vibe";
import type { Mood } from "@/lib/vibe-types";

// ---------------------------------------------------------------------------
// Mood glyphs + accents
// ---------------------------------------------------------------------------

/**
 * Single-cell symbolic glyph per mood. Deliberately distinct from the vibe
 * glyphs (`!` `•` `✕` `z` in vibeGlyph), the git bubbles (`↓` `!`), AND the
 * starfield vocabulary (`·` `*` `+` `✦` `✧` `⋆` in stars.ts — a cue must
 * never read as a blooming backdrop star). `content` is the established
 * no-signal mood and gets no glyph.
 */
export const moodCueGlyph = (mood: Mood): string | null => {
  switch (mood) {
    case "excited":
      return "✶";
    case "proud":
      return "★";
    case "curious":
      return "◦";
    case "anxious":
      return "~";
    case "confused":
      return "¿";
    case "lonely":
      return "…";
    case "content":
      return null;
  }
};

/** Theme tokens a mood accent can resolve to — subset of GardenThemeColors. */
export interface MoodAccentPalette {
  info: string;
  success: string;
  warning: string;
  error: string;
  mutedForeground: string;
}

/** Accent colour for a mood glyph. Same severity mapping as the portrait's
 *  mood chip (`moodChipSeverity` in portrait.ts) so a mood reads with the
 *  same temperature in both surfaces. */
export const moodAccentColor = (mood: Mood, palette: MoodAccentPalette): string => {
  switch (mood) {
    case "confused":
      return palette.error;
    case "anxious":
      return palette.warning;
    case "excited":
    case "curious":
      return palette.info;
    case "proud":
      return palette.success;
    case "lonely":
    case "content":
      return palette.mutedForeground;
  }
};

// ---------------------------------------------------------------------------
// Focus caption
// ---------------------------------------------------------------------------

export interface MoodSignal {
  mood: Mood;
  confidence: number;
  moodReason: string;
}

/** Shared display gate: `content` is the no-signal convention (vibe.ts) and
 *  low-confidence moods stay private to the clipboard/portrait surfaces. */
export const moodSignalVisible = (signal: MoodSignal): boolean =>
  signal.mood !== "content" && signal.confidence >= MOOD_DISPLAY_CONFIDENCE_THRESHOLD;

export const truncateWithEllipsis = (text: string, maxLen: number): string => {
  if (maxLen <= 0) return "";
  if (text.length <= maxLen) return text;
  if (maxLen === 1) return "…";
  return `${text.slice(0, maxLen - 1)}…`;
};

export interface FocusCaption {
  /** Mood glyph cell — painted in the mood's accent colour. */
  glyph: string;
  /** `<mood> — <moodReason>` body, painted muted one cell after the glyph. */
  text: string;
}

// Below this there isn't room for "<glyph> <char>…" — skip rather than
// paint an unreadable stub.
const MIN_CAPTION_WIDTH = 4;

export const buildFocusCaption = (
  signal: MoodSignal,
  maxWidth: number
): FocusCaption | null => {
  if (!moodSignalVisible(signal)) return null;
  const glyph = moodCueGlyph(signal.mood);
  if (!glyph) return null;
  if (maxWidth < MIN_CAPTION_WIDTH) return null;
  const body = signal.moodReason
    ? `${signal.mood} — ${signal.moodReason}`
    : signal.mood;
  // Glyph + separating space take 2 cells of the budget.
  return { glyph, text: truncateWithEllipsis(body, maxWidth - 2) };
};

/** Painted cell length of a caption: glyph + space + body. */
export const captionLength = (caption: FocusCaption): number =>
  caption.text.length + 2;

/** Inclusive cell rect the caption must not touch — other creatures'
 *  full footprints, divider/separator rows, paint exclusions, dead zones. */
export interface CaptionObstacle {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface CaptionSpot {
  x: number;
  y: number;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

export interface CaptionPlacement extends CaptionSpot {
  /** How many cells of the caption fit at this spot — the painter
   *  re-truncates the body to this budget. Never below MIN_CAPTION_WIDTH. */
  maxLen: number;
}

/**
 * Pick where the focused creature's caption row goes. Preference order:
 * the row directly above the focus frame (sky side), then the row below
 * the creature's name strip, else nowhere (return null — the scene stays
 * calm rather than forcing a label into occupied space).
 *
 * Each candidate row is gap-aware: the caption squeezes (with ellipsis
 * truncation) into the clear interval around the frame's centre column
 * rather than refusing the row outright when a neighbour is close. When
 * the preferred row can only fit a stub and the fallback row fits more,
 * the fallback wins — a readable caption below beats a clipped one above.
 */
export const planFocusCaptionPosition = (args: {
  /** Top row of the painted focus frame box. */
  frameTop: number;
  /** Left/right columns of the painted focus frame box. */
  frameLeft: number;
  frameRight: number;
  /** Fallback row: one below the creature's name row. */
  belowRow: number;
  captionLen: number;
  canvasW: number;
  canvasH: number;
  obstacles: readonly CaptionObstacle[];
}): CaptionPlacement | null => {
  const { frameTop, frameLeft, frameRight, belowRow, captionLen, canvasW, canvasH, obstacles } =
    args;
  if (captionLen <= 0) return null;
  const centerCol = Math.floor((frameLeft + frameRight + 1) / 2);
  const tryRow = (y: number): CaptionPlacement | null => {
    if (y < 0 || y >= canvasH) return null;
    // Clear interval on this row containing the frame's centre column.
    let gapLeft = 0;
    let gapRight = canvasW - 1;
    for (const rect of obstacles) {
      if (y < rect.top || y > rect.bottom) continue;
      if (centerCol >= rect.left && centerCol <= rect.right) return null;
      if (rect.right < centerCol) gapLeft = Math.max(gapLeft, rect.right + 1);
      else gapRight = Math.min(gapRight, rect.left - 1);
    }
    const width = gapRight - gapLeft + 1;
    if (width < MIN_CAPTION_WIDTH) return null;
    const maxLen = Math.min(captionLen, width);
    const x = clamp(centerCol - Math.floor(maxLen / 2), gapLeft, gapRight - maxLen + 1);
    return { x, y, maxLen };
  };
  const above = tryRow(frameTop - 1);
  if (above && above.maxLen >= captionLen) return above;
  const below = tryRow(belowRow);
  if (below && (!above || below.maxLen > above.maxLen)) return below;
  return above;
};

// ---------------------------------------------------------------------------
// Transient emotion cues
// ---------------------------------------------------------------------------

/**
 * Per-creature deterministic cue schedule — same shape as BlinkProfile
 * (`buildBlinkProfile`/`blinkClosedAt` in src/garden/model.ts): the glyph is
 * visible for the first `visibleMs` of every `periodMs` window, offset by a
 * seeded `phaseMs` so the swarm doesn't pulse in unison.
 */
export interface CueProfile {
  periodMs: number;
  visibleMs: number;
  phaseMs: number;
}

export const CUE_PERIOD_MIN_MS = 9_000;
export const CUE_PERIOD_MAX_MS = 15_000;
export const CUE_VISIBLE_MIN_MS = 1_200;
export const CUE_VISIBLE_MAX_MS = 1_800;

/** Cue schedule that never shows — used by `pinForExport` so captured
 *  GIF/text frames carry no transient chrome (mirrors the pinned blink). */
export const NEVER_VISIBLE_CUE: CueProfile = {
  periodMs: Number.POSITIVE_INFINITY,
  visibleMs: 0,
  phaseMs: 0
};

export const buildCueProfile = (identity: string, mood: Mood): CueProfile => {
  const rng = mulberry32(hashString(`cue:${identity}:${mood}`));
  const periodMs = Math.round(
    CUE_PERIOD_MIN_MS + rng() * (CUE_PERIOD_MAX_MS - CUE_PERIOD_MIN_MS)
  );
  const visibleMs = Math.round(
    CUE_VISIBLE_MIN_MS + rng() * (CUE_VISIBLE_MAX_MS - CUE_VISIBLE_MIN_MS)
  );
  return {
    periodMs,
    visibleMs,
    phaseMs: Math.round(rng() * periodMs)
  };
};

/** True while the cue glyph should paint. */
export const cueVisibleAt = (profile: CueProfile, now: number): boolean => {
  // Guard the pinned profile: `now % Infinity === now`, which would leave a
  // window open near t=0 without this check.
  if (!Number.isFinite(profile.periodMs)) return false;
  const t = (now + profile.phaseMs) % profile.periodMs;
  return t < profile.visibleMs;
};

/** Global sparseness cap: at most this many cues paint in any one frame. */
export const MAX_CUES_PER_FRAME = 2;

/**
 * Deterministic pick of which candidates keep their cue when more than
 * `max` are visible at once — lowest identity hash wins, id string breaks
 * hash ties. Computed fresh per render pass; no extra state.
 */
export const selectCueIds = (
  ids: readonly string[],
  max: number = MAX_CUES_PER_FRAME
): Set<string> => {
  const ranked = [...ids].sort((a, b) => {
    const ha = hashString(a);
    const hb = hashString(b);
    if (ha !== hb) return ha - hb;
    return a < b ? -1 : a > b ? 1 : 0;
  });
  return new Set(ranked.slice(0, Math.max(0, max)));
};
