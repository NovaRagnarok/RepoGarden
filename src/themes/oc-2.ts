import type { Theme } from "@/components/ui/theme-provider";

export const oc2Theme: Theme = {
  border: {
    color: "#282828",
    focusColor: "#edb2f1",
    style: "round",
  },
  colors: {
    accent: "#edb2f1",
    accentForeground: "#1f1f1f",
    background: "#1f1f1f",
    border: "#282828",
    error: "#fc533a",
    errorForeground: "#1f1f1f",
    focusRing: "#edb2f1",
    foreground: "#f1ece8",
    info: "#edb2f1",
    infoForeground: "#1f1f1f",
    muted: "#141414",
    mutedForeground: "#707070",
    primary: "#fab283",
    primaryForeground: "#1f1f1f",
    secondary: "#262626",
    secondaryForeground: "#f1ece8",
    selection: "#fab283",
    selectionForeground: "#1f1f1f",
    success: "#12c905",
    successForeground: "#1f1f1f",
    warning: "#fcd53a",
    warningForeground: "#1f1f1f",
  },
  // OC-2 — punchy modern: peach, pink, amber, lime, mint, cyan, violet.
  // The 335° pink is iconic to this theme; we let it land outside our
  // default ban because oc-2 owns that color.
  creaturePalette: {
    hues: [10, 25, 45, 60, 95, 145, 195, 230, 270, 335],
    saturation: 0.78,
    lightness: 0.66,
    lightnessJitter: 0.05,
  },
  name: "oc-2",
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
