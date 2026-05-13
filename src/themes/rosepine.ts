import type { Theme } from "@/components/ui/theme-provider";

export const rosepineTheme: Theme = {
  border: {
    color: "#6e6a86",
    focusColor: "#31748f",
    style: "round",
  },
  colors: {
    accent: "#ebbcba",
    accentForeground: "#191724",
    background: "#191724",
    border: "#6e6a86",
    error: "#eb6f92",
    errorForeground: "#191724",
    focusRing: "#31748f",
    foreground: "#e0def4",
    info: "#9ccfd8",
    infoForeground: "#191724",
    muted: "#100f18",
    mutedForeground: "#6e6a86",
    primary: "#9ccfd8",
    primaryForeground: "#191724",
    secondary: "#262330",
    secondaryForeground: "#e0def4",
    selection: "#9ccfd8",
    selectionForeground: "#191724",
    success: "#31748f",
    successForeground: "#191724",
    warning: "#f6c177",
    warningForeground: "#191724",
  },
  // Dusty romance — soft roses, gold, pine, foam, iris. Rose Pine's whole
  // identity is muted/dusty, so the creature palette leans into it: low
  // saturation, lifted lightness for that soft-watercolour read.
  creaturePalette: {
    hues: [345, 2, 22, 38, 165, 195, 220, 260],
    saturation: 0.52,
    lightness: 0.7,
    lightnessJitter: 0.05,
  },
  name: "rosepine",
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
