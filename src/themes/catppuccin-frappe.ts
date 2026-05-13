import type { Theme } from "@/components/ui/theme-provider";

export const catppuccinFrappeTheme: Theme = {
  border: {
    color: "#949cb8",
    focusColor: "#ca9ee6",
    style: "round",
  },
  colors: {
    accent: "#f4b8e4",
    accentForeground: "#303446",
    background: "#303446",
    border: "#949cb8",
    error: "#e78284",
    errorForeground: "#303446",
    focusRing: "#ca9ee6",
    foreground: "#c6d0f5",
    info: "#81c8be",
    infoForeground: "#303446",
    muted: "#232330",
    mutedForeground: "#949cb8",
    primary: "#8da4e2",
    primaryForeground: "#303446",
    secondary: "#414559",
    secondaryForeground: "#c6d0f5",
    selection: "#8da4e2",
    selectionForeground: "#303446",
    success: "#a6d189",
    successForeground: "#303446",
    warning: "#e5c890",
    warningForeground: "#303446",
  },
  // Catppuccin Frappé — cooler take on the same pastel palette. Slightly
  // lower saturation and lightness than Mocha for the chillier feel.
  creaturePalette: {
    hues: [345, 15, 35, 55, 110, 145, 175, 200, 220, 265, 290],
    saturation: 0.5,
    lightness: 0.7,
    lightnessJitter: 0.04,
  },
  name: "catppuccin-frappe",
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
