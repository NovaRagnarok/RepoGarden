import type { Theme } from "@/components/ui/theme-provider";

export const catppuccinMacchiatoTheme: Theme = {
  border: {
    color: "#939ab7",
    focusColor: "#c6a0f6",
    style: "round",
  },
  colors: {
    accent: "#f5bde6",
    accentForeground: "#24273a",
    background: "#24273a",
    border: "#939ab7",
    error: "#ed8796",
    errorForeground: "#24273a",
    focusRing: "#c6a0f6",
    foreground: "#cad3f5",
    info: "#8bd5ca",
    infoForeground: "#24273a",
    muted: "#1b1e2b",
    mutedForeground: "#939ab7",
    primary: "#8aadf4",
    primaryForeground: "#24273a",
    secondary: "#363a4f",
    secondaryForeground: "#cad3f5",
    selection: "#8aadf4",
    selectionForeground: "#24273a",
    success: "#a6da95",
    successForeground: "#24273a",
    warning: "#eed49f",
    warningForeground: "#24273a",
  },
  // Catppuccin Macchiato — sits between Mocha and Frappé. Pastel but with
  // slightly more body than Frappé.
  creaturePalette: {
    hues: [345, 15, 35, 55, 110, 145, 175, 200, 220, 265, 290],
    saturation: 0.52,
    lightness: 0.72,
    lightnessJitter: 0.04,
  },
  name: "catppuccin-macchiato",
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
