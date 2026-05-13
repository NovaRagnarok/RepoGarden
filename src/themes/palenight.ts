import type { Theme } from "@/components/ui/theme-provider";

export const palenightTheme: Theme = {
  border: {
    color: "#676e95",
    focusColor: "#c792ea",
    style: "round",
  },
  colors: {
    accent: "#89ddff",
    accentForeground: "#292d3e",
    background: "#292d3e",
    border: "#676e95",
    error: "#f07178",
    errorForeground: "#292d3e",
    focusRing: "#c792ea",
    foreground: "#a6accd",
    info: "#f78c6c",
    infoForeground: "#292d3e",
    muted: "#1e2130",
    mutedForeground: "#676e95",
    primary: "#82aaff",
    primaryForeground: "#292d3e",
    secondary: "#383d4f",
    secondaryForeground: "#a6accd",
    selection: "#82aaff",
    selectionForeground: "#292d3e",
    success: "#c3e88d",
    successForeground: "#292d3e",
    warning: "#ffcb6b",
    warningForeground: "#292d3e",
  },
  // Palenight — muted purple/blue/cool. Pale and washed, like the theme's
  // name promises.
  creaturePalette: {
    hues: [350, 20, 60, 145, 175, 200, 225, 250],
    saturation: 0.55,
    lightness: 0.7,
    lightnessJitter: 0.05,
  },
  name: "palenight",
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
