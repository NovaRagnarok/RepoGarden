import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const TUI_CONFIG_SCHEMA_VERSION = 2 as const;

const configDir = (): string => join(homedir(), ".repogarden");
const configFile = (): string => join(configDir(), "tui.json");

export interface ConfigStorageAdapter {
  configFile: () => string;
  exists: (path: string) => boolean;
  makeDir: (path: string) => void;
  read: (path: string) => string;
  write: (path: string, contents: string) => void;
  rename: (from: string, to: string) => void;
  remove: (path: string) => void;
  temporaryFile: (path: string) => string;
}

export type ConfigStorageOverrides = Partial<ConfigStorageAdapter>;

const DEFAULT_STORAGE: ConfigStorageAdapter = {
  configFile,
  exists: existsSync,
  makeDir: (path) => mkdirSync(path, { recursive: true }),
  read: (path) => readFileSync(path, "utf8"),
  write: (path, contents) => writeFileSync(path, contents, "utf8"),
  rename: renameSync,
  remove: unlinkSync,
  temporaryFile: (path) =>
    `${path}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`,
};

const resolveStorage = (overrides: ConfigStorageOverrides): ConfigStorageAdapter => ({
  ...DEFAULT_STORAGE,
  ...overrides,
});

export type ReadyView = "garden" | "rooms" | "journal" | "github";

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

export type GitHubCloneProtocol = "ssh" | "https";

export interface GitHubConfig {
  enabled: boolean;
  includePrivate: boolean;
  affiliations: string[];
  cacheTtlMinutes: number;
  cloneProtocol: GitHubCloneProtocol;
}

export interface TuiConfig {
  schemaVersion: typeof TUI_CONFIG_SCHEMA_VERSION;
  themeId: string;
  scanRoots: string[];
  view: ReadyView;
  reducedMotion: boolean;
  /** Persistently hides the Claude/Codex usage bar. Defaults to hidden so
   *  provider credential reads are opt-in on fresh installs. Env
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
  /** Optional GitHub discovery. Disabled by default; when enabled,
   *  RepoGarden reads metadata directly from api.github.com using the
   *  user's `gh` CLI authentication and caches only normalized repo
   *  metadata under ~/.repogarden. */
  github: GitHubConfig;
}

const DEFAULT_CONFIG: TuiConfig = {
  schemaVersion: TUI_CONFIG_SCHEMA_VERSION,
  themeId: "high-contrast",
  scanRoots: [],
  view: "garden",
  reducedMotion: false,
  usageBarDisabled: true,
  observer: { enabled: true },
  gardenPaginate: true,
  gardenDensity: "comfortable",
  bellOnVibeChange: false,
  github: {
    enabled: false,
    includePrivate: true,
    affiliations: ["owner", "collaborator", "organization_member"],
    cacheTtlMinutes: 30,
    cloneProtocol: "ssh"
  }
};

const isGardenDensity = (value: unknown): value is GardenDensity =>
  value === "cozy" || value === "comfortable" || value === "dense";

const isReadyView = (value: unknown): value is ReadyView =>
  value === "garden" || value === "rooms" || value === "journal" || value === "github";

const isGitHubCloneProtocol = (value: unknown): value is GitHubCloneProtocol =>
  value === "ssh" || value === "https";

const ENV_TRUE_VALUES = new Set(["1", "true"]);
const ENV_FALSE_VALUES = new Set(["0", "false"]);

const defaultConfig = (): TuiConfig => ({
  ...DEFAULT_CONFIG,
  observer: { ...DEFAULT_CONFIG.observer },
  scanRoots: [...DEFAULT_CONFIG.scanRoots]
});

const normalizeConfig = (raw: unknown): TuiConfig => {
  if (!raw || typeof raw !== "object") {
    return defaultConfig();
  }
  const parsed = raw as Partial<TuiConfig>;
  return {
    schemaVersion: TUI_CONFIG_SCHEMA_VERSION,
    themeId: typeof parsed.themeId === "string" ? parsed.themeId : DEFAULT_CONFIG.themeId,
    scanRoots: Array.isArray(parsed.scanRoots)
      ? parsed.scanRoots.filter((entry): entry is string => typeof entry === "string")
      : [...DEFAULT_CONFIG.scanRoots],
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
        : DEFAULT_CONFIG.bellOnVibeChange,
    github: parseGitHubConfig(parsed.github)
  };
};

const GITHUB_AFFILIATIONS = new Set(["owner", "collaborator", "organization_member"]);

const parseGitHubConfig = (raw: unknown): GitHubConfig => {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_CONFIG.github };
  const partial = raw as Partial<GitHubConfig>;
  const affiliations = Array.isArray(partial.affiliations)
    ? partial.affiliations.filter((entry): entry is string => GITHUB_AFFILIATIONS.has(entry))
    : DEFAULT_CONFIG.github.affiliations;
  const cacheTtl =
    typeof partial.cacheTtlMinutes === "number" && partial.cacheTtlMinutes > 0
      ? Math.floor(partial.cacheTtlMinutes)
      : DEFAULT_CONFIG.github.cacheTtlMinutes;
  return {
    enabled:
      typeof partial.enabled === "boolean"
        ? partial.enabled
        : DEFAULT_CONFIG.github.enabled,
    includePrivate:
      typeof partial.includePrivate === "boolean"
        ? partial.includePrivate
        : DEFAULT_CONFIG.github.includePrivate,
    affiliations: affiliations.length > 0 ? affiliations : [...DEFAULT_CONFIG.github.affiliations],
    cacheTtlMinutes: cacheTtl,
    cloneProtocol: isGitHubCloneProtocol(partial.cloneProtocol)
      ? partial.cloneProtocol
      : DEFAULT_CONFIG.github.cloneProtocol
  };
};

export const loadConfig = (overrides: ConfigStorageOverrides = {}): TuiConfig => {
  try {
    const storage = resolveStorage(overrides);
    const path = storage.configFile();
    if (!storage.exists(path)) {
      return normalizeConfig(null);
    }
    const raw = storage.read(path);
    return normalizeConfig(JSON.parse(raw));
  } catch {
    return normalizeConfig(null);
  }
};

const parseObserver = (raw: unknown): ObserverConfig => {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_CONFIG.observer };
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

export const githubEnabled = (config: TuiConfig): boolean => {
  if (process.env.REPOGARDEN_DISABLE_GITHUB === "1") return false;
  return config.github.enabled;
};

export const reducedMotionEnvOverride = (
  env: NodeJS.ProcessEnv = process.env
): boolean | undefined => {
  const raw = env.REPOGARDEN_REDUCED_MOTION;
  if (!raw) return undefined;
  const value = raw.trim().toLowerCase();
  if (ENV_TRUE_VALUES.has(value)) return true;
  if (ENV_FALSE_VALUES.has(value)) return false;
  return undefined;
};

/** Per-run effective reduced-motion flag: env override wins over persisted config. */
export const reducedMotionEnabled = (
  config: TuiConfig,
  env: NodeJS.ProcessEnv = process.env
): boolean => {
  const envOverride = reducedMotionEnvOverride(env);
  if (envOverride !== undefined) return envOverride;
  return config.reducedMotion || env.NO_MOTION === "1" || env.CI === "true";
};

export type ConfigPersistenceResult =
  | { persisted: true; config: TuiConfig }
  | { persisted: false; config: TuiConfig; error: string };

const persistenceErrorMessage = (error: unknown): string =>
  error instanceof Error && error.message.trim().length > 0
    ? error.message
    : "unknown config write failure";

/**
 * Atomically persists config when possible. Both result variants carry the
 * normalized config so callers can keep the intended session state instead
 * of rolling the UI back when only the disk write failed.
 */
export const saveConfig = (
  config: TuiConfig,
  overrides: ConfigStorageOverrides = {}
): ConfigPersistenceResult => {
  const normalized = normalizeConfig(config);
  let temporaryPath: string | undefined;
  let storage: ConfigStorageAdapter | undefined;
  try {
    storage = resolveStorage(overrides);
    const path = storage.configFile();
    storage.makeDir(dirname(path));
    temporaryPath = storage.temporaryFile(path);
    storage.write(temporaryPath, JSON.stringify(normalized, null, 2));
    storage.rename(temporaryPath, path);
    return { persisted: true, config: normalized };
  } catch (error) {
    if (storage && temporaryPath) {
      try {
        storage.remove(temporaryPath);
      } catch {
        // The temp file may not exist, or cleanup can fail for the same reason as the write.
      }
    }
    return { persisted: false, config: normalized, error: persistenceErrorMessage(error) };
  }
};

export type TuiConfigPatch = Partial<Omit<TuiConfig, "schemaVersion">>;

export const updateConfig = (
  patch: TuiConfigPatch,
  overrides: ConfigStorageOverrides = {}
): ConfigPersistenceResult => {
  const current = loadConfig(overrides);
  const next: TuiConfig = normalizeConfig({ ...current, ...patch });
  return saveConfig(next, overrides);
};
