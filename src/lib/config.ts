import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const configDir = join(homedir(), ".repogarden");
const configFile = join(configDir, "tui.json");

export type ReadyView = "garden" | "shelf" | "journal";

/** How tightly creatures pack into a page (garden) or shelf row.
 *  `comfortable` is the historical default — generous slot padding,
 *  fewer creatures per page. `cozy` adds more breathing room; `dense`
 *  trims pads so more creatures fit on screen before pagination kicks in. */
export type GardenDensity = "cozy" | "comfortable" | "dense";

export interface ObserverConfig {
  enabled: boolean;
  /** Cap on per-repo watch handles. Beyond this, per-repo commit
   *  watching is skipped and the safety-net poll covers updates. */
  maxWatches?: number;
}

export interface TuiConfig {
  themeId: string;
  scanRoots: string[];
  view: ReadyView;
  reducedMotion: boolean;
  /** Persistently hides the Claude/Codex usage bar. Env
   *  REPOGARDEN_DISABLE_USAGE=1 still overrides this for a single run
   *  (per-run flag wins). */
  usageBarDisabled: boolean;
  /** Background observer that backfills commits + new repos via
   *  fs.watch. Env REPOGARDEN_DISABLE_OBSERVER=1 disables it for a
   *  single run regardless of the persisted flag. */
  observer: ObserverConfig;
  /** Master pagination toggle for the garden view. When false the
   *  whole creature list lands on one page; the placer falls back to
   *  its graceful-degradation path (slot reuse, overlap-packing) when
   *  the canvas can't physically fit everyone. Shelf/journal are
   *  unaffected — they don't paginate today. */
  gardenPaginate: boolean;
  /** Per-page slot density. Smaller pads → more creatures fit before
   *  pagination kicks in. Threaded into the shelf placer too so the
   *  setting reads consistently across both views. */
  gardenDensity: GardenDensity;
  /** Emit a terminal bell (BEL, 0x07) when a live scan picks up a
   *  vibe transition on a repo that existed before. Off by default —
   *  bells are polarizing. Only fires from the ready/home views, not
   *  during boot, edit-roots, or workbench focus. */
  bellOnVibeChange: boolean;
}

const DEFAULT_CONFIG: TuiConfig = {
  themeId: "high-contrast",
  scanRoots: [],
  view: "garden",
  reducedMotion: false,
  usageBarDisabled: false,
  observer: { enabled: true },
  gardenPaginate: true,
  gardenDensity: "comfortable",
  bellOnVibeChange: false
};

const isGardenDensity = (value: unknown): value is GardenDensity =>
  value === "cozy" || value === "comfortable" || value === "dense";

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
          : DEFAULT_CONFIG.reducedMotion,
      usageBarDisabled:
        typeof parsed.usageBarDisabled === "boolean"
          ? parsed.usageBarDisabled
          : DEFAULT_CONFIG.usageBarDisabled,
      observer: parseObserver(parsed.observer),
      gardenPaginate:
        typeof parsed.gardenPaginate === "boolean"
          ? parsed.gardenPaginate
          : DEFAULT_CONFIG.gardenPaginate,
      gardenDensity: isGardenDensity(parsed.gardenDensity)
        ? parsed.gardenDensity
        : DEFAULT_CONFIG.gardenDensity,
      bellOnVibeChange:
        typeof parsed.bellOnVibeChange === "boolean"
          ? parsed.bellOnVibeChange
          : DEFAULT_CONFIG.bellOnVibeChange
    };
  } catch {
    return DEFAULT_CONFIG;
  }
};

const parseObserver = (raw: unknown): ObserverConfig => {
  if (!raw || typeof raw !== "object") return DEFAULT_CONFIG.observer;
  const partial = raw as Partial<ObserverConfig>;
  const max =
    typeof partial.maxWatches === "number" && partial.maxWatches > 0
      ? Math.floor(partial.maxWatches)
      : undefined;
  return {
    enabled:
      typeof partial.enabled === "boolean"
        ? partial.enabled
        : DEFAULT_CONFIG.observer.enabled,
    ...(max !== undefined ? { maxWatches: max } : {})
  };
};

/** Per-run effective enable: persisted flag, with env override winning. */
export const observerEnabled = (config: TuiConfig): boolean => {
  if (process.env.REPOGARDEN_DISABLE_OBSERVER === "1") return false;
  return config.observer.enabled;
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
