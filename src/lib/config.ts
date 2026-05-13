import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const configDir = join(homedir(), ".repogarden");
const configFile = join(configDir, "tui.json");

export type ReadyView = "garden" | "shelf" | "journal";

export interface TuiConfig {
  themeId: string;
  scanRoots: string[];
  view: ReadyView;
  reducedMotion: boolean;
}

const DEFAULT_CONFIG: TuiConfig = {
  themeId: "high-contrast",
  scanRoots: [],
  view: "garden",
  reducedMotion: false
};

const isReadyView = (value: unknown): value is ReadyView =>
  value === "garden" || value === "shelf" || value === "journal";

export const loadConfig = (): TuiConfig => {
  try {
    if (!existsSync(configFile)) {
      return DEFAULT_CONFIG;
    }
    const raw = readFileSync(configFile, "utf8");
    const parsed = JSON.parse(raw) as Partial<TuiConfig>;
    return {
      themeId: typeof parsed.themeId === "string" ? parsed.themeId : DEFAULT_CONFIG.themeId,
      scanRoots: Array.isArray(parsed.scanRoots)
        ? parsed.scanRoots.filter((entry): entry is string => typeof entry === "string")
        : DEFAULT_CONFIG.scanRoots,
      view: isReadyView(parsed.view) ? parsed.view : DEFAULT_CONFIG.view,
      reducedMotion:
        typeof parsed.reducedMotion === "boolean"
          ? parsed.reducedMotion
          : DEFAULT_CONFIG.reducedMotion
    };
  } catch {
    return DEFAULT_CONFIG;
  }
};

export const saveConfig = (config: TuiConfig): void => {
  try {
    mkdirSync(dirname(configFile), { recursive: true });
    writeFileSync(configFile, JSON.stringify(config, null, 2), "utf8");
  } catch {
    // best-effort: settings stay session-only if disk write fails.
  }
};

export const updateConfig = (patch: Partial<TuiConfig>): TuiConfig => {
  const current = loadConfig();
  const next: TuiConfig = { ...current, ...patch };
  saveConfig(next);
  return next;
};
