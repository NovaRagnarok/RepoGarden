import type { Theme } from "@/components/ui/theme-provider";

export const nightowlTheme: Theme = {
  border: {
    color: "#637777",
    focusColor: "#c792ea",
    style: "round",
  },
  colors: {
    accent: "#f78c6c",
    accentForeground: "#011627",
    background: "#011627",
    border: "#637777",
    error: "#ef5350",
    errorForeground: "#011627",
    focusRing: "#c792ea",
    foreground: "#d6deeb",
    info: "#82aaff",
    infoForeground: "#011627",
    muted: "#010c15",
    mutedForeground: "#637777",
    primary: "#82aaff",
    primaryForeground: "#011627",
    secondary: "#021a2b",
    secondaryForeground: "#d6deeb",
    selection: "#82aaff",
    selectionForeground: "#011627",
    success: "#c5e478",
    successForeground: "#011627",
    warning: "#ecc48d",
    warningForeground: "#011627",
  },
  // Night Owl — deep ocean blue with warm coral, peach, lemon and cool
  // mint accents. Slightly lifted lightness for the glow against navy.
  creaturePalette: {
    hues: [355, 20, 45, 65, 110, 175, 205, 230],
    saturation: 0.7,
    lightness: 0.66,
    lightnessJitter: 0.05,
  },
  name: "nightowl",
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
