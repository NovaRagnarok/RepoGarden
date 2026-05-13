import type { Theme } from "@/components/ui/theme-provider";

import { amoledTheme } from "./amoled";
import { auraTheme } from "./aura";
import { ayuTheme } from "./ayu";
import { carbonfoxTheme } from "./carbonfox";
import { catppuccinFrappeTheme } from "./catppuccin-frappe";
import { catppuccinMacchiatoTheme } from "./catppuccin-macchiato";
import { catppuccinTheme } from "./catppuccin";
import { cobalt2Theme } from "./cobalt2";
import { cursorTheme } from "./cursor";
import { defaultTheme } from "./default";
import { draculaTheme } from "./dracula";
import { everforestTheme } from "./everforest";
import { flexokiTheme } from "./flexoki";
import { githubTheme } from "./github";
import { gruvboxTheme } from "./gruvbox";
import { highContrastTheme } from "./high-contrast";
import { kanagawaTheme } from "./kanagawa";
import { lucentOrngTheme } from "./lucent-orng";
import { materialTheme } from "./material";
import { matrixTheme } from "./matrix";
import { mercuryTheme } from "./mercury";
import { monokaiTheme } from "./monokai";
import { nightowlTheme } from "./nightowl";
import { nordTheme } from "./nord";
import { oc2Theme } from "./oc-2";
import { oneDarkTheme } from "./one-dark";
import { onedarkproTheme } from "./onedarkpro";
import { opencodeTheme } from "./opencode";
import { orngTheme } from "./orng";
import { osakaJadeTheme } from "./osaka-jade";
import { palenightTheme } from "./palenight";
import { rosepineTheme } from "./rosepine";
import { shadesofpurpleTheme } from "./shadesofpurple";
import { solarizedTheme } from "./solarized";
import { synthwave84Theme } from "./synthwave84";
import { tokyoNightTheme } from "./tokyo-night";
import { vercelTheme } from "./vercel";
import { vesperTheme } from "./vesper";
import { zenburnTheme } from "./zenburn";

export interface ThemeChoice {
  id: string;
  label: string;
  theme: Theme;
}

// All themes here are dark-bg only. Terminals don't repaint their background
// for us (Ink writes per-character fg/bg, not a full canvas), so a light theme
// renders its black foreground over whatever the user's terminal background
// actually is — usually dark — which is illegible. If we ever support light
// themes again, it'd need to come with a per-cell bg paint pass.
export const themeCatalogue: ThemeChoice[] = [
  { id: "high-contrast", label: "High Contrast", theme: highContrastTheme },
  { id: "default", label: "termcn Default", theme: defaultTheme },
  { id: "amoled", label: "AMOLED", theme: amoledTheme },
  { id: "aura", label: "Aura", theme: auraTheme },
  { id: "ayu", label: "Ayu", theme: ayuTheme },
  { id: "carbonfox", label: "Carbonfox", theme: carbonfoxTheme },
  { id: "catppuccin", label: "Catppuccin", theme: catppuccinTheme },
  { id: "catppuccin-frappe", label: "Catppuccin Frappé", theme: catppuccinFrappeTheme },
  { id: "catppuccin-macchiato", label: "Catppuccin Macchiato", theme: catppuccinMacchiatoTheme },
  { id: "cobalt2", label: "Cobalt2", theme: cobalt2Theme },
  { id: "cursor", label: "Cursor", theme: cursorTheme },
  { id: "dracula", label: "Dracula", theme: draculaTheme },
  { id: "everforest", label: "Everforest", theme: everforestTheme },
  { id: "flexoki", label: "Flexoki", theme: flexokiTheme },
  { id: "github", label: "GitHub", theme: githubTheme },
  { id: "gruvbox", label: "Gruvbox", theme: gruvboxTheme },
  { id: "kanagawa", label: "Kanagawa", theme: kanagawaTheme },
  { id: "lucent-orng", label: "Lucent Orange", theme: lucentOrngTheme },
  { id: "material", label: "Material", theme: materialTheme },
  { id: "matrix", label: "Matrix", theme: matrixTheme },
  { id: "mercury", label: "Mercury", theme: mercuryTheme },
  { id: "monokai", label: "Monokai", theme: monokaiTheme },
  { id: "nightowl", label: "Night Owl", theme: nightowlTheme },
  { id: "nord", label: "Nord", theme: nordTheme },
  { id: "oc-2", label: "OC-2", theme: oc2Theme },
  { id: "one-dark", label: "One Dark", theme: oneDarkTheme },
  { id: "onedarkpro", label: "One Dark Pro", theme: onedarkproTheme },
  { id: "opencode", label: "OpenCode", theme: opencodeTheme },
  { id: "orng", label: "Orange", theme: orngTheme },
  { id: "osaka-jade", label: "Osaka Jade", theme: osakaJadeTheme },
  { id: "palenight", label: "Palenight", theme: palenightTheme },
  { id: "rosepine", label: "Rosé Pine", theme: rosepineTheme },
  { id: "shadesofpurple", label: "Shades of Purple", theme: shadesofpurpleTheme },
  { id: "solarized", label: "Solarized", theme: solarizedTheme },
  { id: "synthwave84", label: "Synthwave '84", theme: synthwave84Theme },
  { id: "tokyo-night", label: "Tokyo Night", theme: tokyoNightTheme },
  { id: "vercel", label: "Vercel", theme: vercelTheme },
  { id: "vesper", label: "Vesper", theme: vesperTheme },
  { id: "zenburn", label: "Zenburn", theme: zenburnTheme }
];

export const themeById = (id: string): ThemeChoice | undefined =>
  themeCatalogue.find((choice) => choice.id === id);

export const defaultThemeId = "high-contrast";
