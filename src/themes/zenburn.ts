import type { Theme } from "@/components/ui/theme-provider";

export const zenburnTheme: Theme = {
  border: {
    color: "#9f9f9f",
    focusColor: "#f0dfaf",
    style: "round",
  },
  colors: {
    accent: "#93e0e3",
    accentForeground: "#3f3f3f",
    background: "#3f3f3f",
    border: "#9f9f9f",
    error: "#cc9393",
    errorForeground: "#3f3f3f",
    focusRing: "#f0dfaf",
    foreground: "#dcdccc",
    info: "#dfaf8f",
    infoForeground: "#3f3f3f",
    muted: "#2f2f2f",
    mutedForeground: "#9f9f9f",
    primary: "#8cd0d3",
    primaryForeground: "#3f3f3f",
    secondary: "#4f4f4f",
    secondaryForeground: "#dcdccc",
    selection: "#8cd0d3",
    selectionForeground: "#3f3f3f",
    success: "#7f9f7f",
    successForeground: "#3f3f3f",
    warning: "#f0dfaf",
    warningForeground: "#3f3f3f",
  },
  // Zenburn — peaceful muted brown-green. Low saturation, soft lightness;
  // the herd should feel as restful as the theme.
  creaturePalette: {
    hues: [10, 30, 50, 80, 110, 145, 175, 200],
    saturation: 0.4,
    lightness: 0.65,
    lightnessJitter: 0.05,
  },
  name: "zenburn",
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
