import type { Theme } from "@/components/ui/theme-provider";

export const mercuryTheme: Theme = {
  border: {
    color: "#9d9da8",
    focusColor: "#8da4f5",
    style: "round",
  },
  colors: {
    accent: "#8da4f5",
    accentForeground: "#171721",
    background: "#171721",
    border: "#9d9da8",
    error: "#fc92b4",
    errorForeground: "#171721",
    focusRing: "#8da4f5",
    foreground: "#dddde5",
    info: "#77becf",
    infoForeground: "#171721",
    muted: "#101018",
    mutedForeground: "#9d9da8",
    primary: "#8da4f5",
    primaryForeground: "#171721",
    secondary: "#1e1e28",
    secondaryForeground: "#dddde5",
    selection: "#8da4f5",
    selectionForeground: "#171721",
    success: "#77c599",
    successForeground: "#171721",
    warning: "#fc9b6f",
    warningForeground: "#171721",
  },
  // Mercury — cool clean pastels: sky, teal, periwinkle, soft coral.
  // Light/soft for the minimal-cool feel.
  creaturePalette: {
    hues: [350, 25, 60, 145, 175, 200, 220, 250],
    saturation: 0.5,
    lightness: 0.7,
    lightnessJitter: 0.05,
  },
  name: "mercury",
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
