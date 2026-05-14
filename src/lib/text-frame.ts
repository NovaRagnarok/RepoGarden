import type { GardenFrame } from "@/garden/types";

export interface FrameToTextOptions {
  /** Append a right-aligned project URL footer below the frame so the snippet
   *  carries its own attribution when pasted. */
  brand?: boolean;
  /** Wrap the result in triple-backtick fences so a single clipboard read
   *  pastes as a complete Markdown / Discord / Slack code block. */
  fenced?: boolean;
}

const BRAND_URL = "github.com/NovaRagnarok/RepoGarden";

// Frame → plain UTF-8 string. We deliberately do NOT emit ANSI colour escapes:
// Discord's ```ansi``` code block ignored them when we tried, the block-drawing
// silhouettes carry the shape on their own, and plain text round-trips cleanly
// through every chat surface (Slack, Discord, GitHub comments, terminals).
export const frameToText = (
  frame: GardenFrame,
  options: FrameToTextOptions = {}
): string => {
  const lines: string[] = [];

  for (let y = 0; y < frame.height; y += 1) {
    let line = "";
    for (let x = 0; x < frame.width; x += 1) {
      const cell = frame.cells[y * frame.width + x];
      if (!cell || cell.transparent) {
        line += " ";
        continue;
      }
      line += cell.char.length > 0 ? cell.char : " ";
    }
    // Trim trailing spaces so paste-into-Discord doesn't carry phantom width.
    lines.push(line.replace(/[ \t]+$/u, ""));
  }

  // Drop trailing blank rows for the same reason.
  while (lines.length > 0 && lines[lines.length - 1].length === 0) {
    lines.pop();
  }

  // Right-align the project URL on its own line below the frame. The frame's
  // visible width is `frame.width` cells; if the URL is longer we just emit
  // it unpadded so it still appears (it'll wrap visually in narrow chats).
  if (options.brand) {
    const padCount = Math.max(0, frame.width - BRAND_URL.length);
    lines.push(" ".repeat(padCount) + BRAND_URL);
  }

  const body = lines.join("\n");
  return options.fenced ? "```\n" + body + "\n```" : body;
};
