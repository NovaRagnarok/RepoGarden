import type { Theme } from "@/components/ui/theme-provider";

export const gruvboxTheme: Theme = {
  border: {
    color: "#928374",
    focusColor: "#fb4934",
    style: "round",
  },
  colors: {
    accent: "#fb4934",
    accentForeground: "#282828",
    background: "#282828",
    border: "#928374",
    error: "#fb4934",
    errorForeground: "#282828",
    focusRing: "#fb4934",
    foreground: "#ebdbb2",
    info: "#d3869b",
    infoForeground: "#282828",
    muted: "#1d2021",
    mutedForeground: "#928374",
    primary: "#83a598",
    primaryForeground: "#282828",
    secondary: "#32302f",
    secondaryForeground: "#ebdbb2",
    selection: "#83a598",
    selectionForeground: "#282828",
    success: "#b8bb26",
    successForeground: "#282828",
    warning: "#fabd2f",
    warningForeground: "#282828",
  },
  // Warm earth — orange, mustard, olive, sage, terra, brick. Saturation
  // pulled in and lightness lifted just enough to keep creatures readable
  // against gruvbox's brown background without breaking the muted vibe.
  creaturePalette: {
    hues: [8, 22, 38, 52, 78, 110, 145, 175],
    saturation: 0.62,
    lightness: 0.58,
    lightnessJitter: 0.05,
  },
  name: "gruvbox",
  spacing: {
    0: 0,
    1: 1,
    2: 2,
    3: 3,
    4: 4,
    6: 6,
    8: 8,
  },
  typography: {
    base: "",
    bold: true,
    lg: "bold",
    sm: "dim",
    xl: "bold",
  },
};
