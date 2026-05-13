import type { Theme } from "@/components/ui/theme-provider";

export const onedarkproTheme: Theme = {
  border: {
    color: "#5c6370",
    focusColor: "#c678dd",
    style: "round",
  },
  colors: {
    accent: "#e06c75",
    accentForeground: "#1e222a",
    background: "#1e222a",
    border: "#5c6370",
    error: "#e06c75",
    errorForeground: "#1e222a",
    focusRing: "#c678dd",
    foreground: "#abb2bf",
    info: "#56b6c2",
    infoForeground: "#1e222a",
    muted: "#15181f",
    mutedForeground: "#5c6370",
    primary: "#61afef",
    primaryForeground: "#1e222a",
    secondary: "#2c313a",
    secondaryForeground: "#abb2bf",
    selection: "#61afef",
    selectionForeground: "#1e222a",
    success: "#98c379",
    successForeground: "#1e222a",
    warning: "#e5c07b",
    warningForeground: "#1e222a",
  },
  // One Dark Pro — same Atom-derived palette as one-dark, identical
  // creature treatment.
  creaturePalette: {
    hues: [355, 20, 50, 95, 175, 205, 250, 290],
    saturation: 0.6,
    lightness: 0.62,
    lightnessJitter: 0.05,
  },
  name: "onedarkpro",
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
