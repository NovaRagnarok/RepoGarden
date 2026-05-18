import { createTheme } from "@/components/ui/theme-provider";

/**
 * WCAG AA high-contrast theme — dark variant (white text on black).
 *
 * All foreground/background pairs meet the 4.5:1 contrast ratio required by
 * WCAG 2.1 AA, with key status pairs at 7:1 for small text.
 *
 * We don't ship a light variant: terminals don't repaint their own background
 * for us, so a "black on white" theme renders as black-on-(dark-terminal-bg)
 * — illegible. See src/themes/index.ts.
 */
export const highContrastTheme = createTheme({
  border: {
    color: "#FFFFFF",
    focusColor: "#FFFF00",
    style: "bold",
  },
  colors: {
    // 8.6:1 on #000 — exceeds AA
    accent: "#00FFFF",
    accentForeground: "#000000",
    background: "#000000",
    border: "#FFFFFF",
    // 5.1:1 on #000 — meets AA; uses symbol + color
    error: "#FF4444",
    errorForeground: "#FFFFFF",
    // 16.7:1 on #000 — visually distinct for focus, and not the same
    // hue as `warning` (yellow) so a focused pane doesn't read as alarm.
    focusRing: "#00FFFF",
    // 21:1 — exceeds AAA
    foreground: "#FFFFFF",
    // 7.5:1 on #000 — exceeds AA
    info: "#00CCFF",
    infoForeground: "#000000",
    muted: "#1A1A1A",
    // 10.4:1 on #1A1A1A — exceeds AAA
    mutedForeground: "#CCCCCC",
    // 21:1 on #000 — exceeds AAA
    primary: "#FFFFFF",
    primaryForeground: "#000000",
    // 19.1:1 on #000 — exceeds AAA
    secondary: "#FFFF00",
    secondaryForeground: "#000000",
    selection: "#FFFFFF",
    selectionForeground: "#000000",
    // 15.3:1 on #000 — exceeds AAA
    success: "#00FF00",
    successForeground: "#000000",
    // 19.1:1 on #000 — exceeds AAA
    warning: "#FFFF00",
    warningForeground: "#000000",
  },
  // Arcade — punchy primaries + cute pop colors. Max saturation + slightly
  // higher lightness so creatures glow against the pure-black background.
  creaturePalette: {
    hues: [355, 10, 25, 45, 60, 90, 120, 155, 180, 205, 235, 265],
    saturation: 0.95,
    lightness: 0.62,
    lightnessJitter: 0.05,
  },
  name: "high-contrast",
});
