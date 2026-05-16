import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  loadConfig,
  saveConfig,
  TUI_CONFIG_SCHEMA_VERSION,
  updateConfig,
  type TuiConfig,
} from "../lib/config";

const withFakeHome = (run: (home: string) => void): void => {
  const fake = mkdtempSync(join(tmpdir(), "repogarden-config-home-"));
  const oldHome = process.env.HOME;
  const oldUserProfile = process.env.USERPROFILE;
  process.env.HOME = fake;
  process.env.USERPROFILE = fake;
  try {
    run(fake);
  } finally {
    process.env.HOME = oldHome;
    process.env.USERPROFILE = oldUserProfile;
    rmSync(fake, { recursive: true, force: true });
  }
};

const configPath = (home: string): string => join(home, ".repogarden", "tui.json");

const writeRawConfig = (home: string, raw: unknown): void => {
  const path = configPath(home);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, typeof raw === "string" ? raw : JSON.stringify(raw, null, 2), "utf8");
};

test("loadConfig returns current schema defaults when config is missing", () => {
  withFakeHome(() => {
    const config = loadConfig();
    assert.equal(config.schemaVersion, TUI_CONFIG_SCHEMA_VERSION);
    assert.equal(config.themeId, "high-contrast");
    assert.deepEqual(config.scanRoots, []);
    assert.equal(config.view, "garden");
    assert.equal(config.observer.enabled, true);
  });
});

test("loadConfig returns current schema defaults when config is malformed", () => {
  withFakeHome((home) => {
    writeRawConfig(home, "not-json{");
    const config = loadConfig();
    assert.equal(config.schemaVersion, TUI_CONFIG_SCHEMA_VERSION);
    assert.equal(config.themeId, "high-contrast");
    assert.deepEqual(config.scanRoots, []);
  });
});

test("loadConfig migrates schema-less config and preserves valid fields", () => {
  withFakeHome((home) => {
    writeRawConfig(home, {
      themeId: "dracula",
      scanRoots: ["/tmp/repos", "/work"],
      view: "journal",
      reducedMotion: true,
      usageBarDisabled: true,
      observer: { enabled: false, maxWatches: 12 },
      gardenPaginate: false,
      gardenDensity: "dense",
      bellOnVibeChange: true,
    });

    const config = loadConfig();
    assert.equal(config.schemaVersion, TUI_CONFIG_SCHEMA_VERSION);
    assert.equal(config.themeId, "dracula");
    assert.deepEqual(config.scanRoots, ["/tmp/repos", "/work"]);
    assert.equal(config.view, "journal");
    assert.equal(config.reducedMotion, true);
    assert.equal(config.usageBarDisabled, true);
    assert.deepEqual(config.observer, { enabled: false, maxWatches: 12 });
    assert.equal(config.gardenPaginate, false);
    assert.equal(config.gardenDensity, "dense");
    assert.equal(config.bellOnVibeChange, true);
  });
});

test("loadConfig sanitizes invalid legacy fields to current defaults", () => {
  withFakeHome((home) => {
    writeRawConfig(home, {
      themeId: 12,
      scanRoots: ["/tmp/repos", 44, null],
      view: "list",
      reducedMotion: "yes",
      usageBarDisabled: false,
      observer: { enabled: "no", maxWatches: 2.8 },
      gardenPaginate: "no",
      gardenDensity: "tiny",
      bellOnVibeChange: true,
    });

    const config = loadConfig();
    assert.equal(config.schemaVersion, TUI_CONFIG_SCHEMA_VERSION);
    assert.equal(config.themeId, "high-contrast");
    assert.deepEqual(config.scanRoots, ["/tmp/repos"]);
    assert.equal(config.view, "garden");
    assert.equal(config.reducedMotion, false);
    assert.equal(config.usageBarDisabled, false);
    assert.deepEqual(config.observer, { enabled: true, maxWatches: 2 });
    assert.equal(config.gardenPaginate, true);
    assert.equal(config.gardenDensity, "comfortable");
    assert.equal(config.bellOnVibeChange, true);
  });
});

test("saveConfig writes tui.json with schemaVersion 1", () => {
  withFakeHome((home) => {
    const config: TuiConfig = {
      ...loadConfig(),
      themeId: "nord",
      scanRoots: ["/repos"],
      view: "shelf",
      observer: { enabled: false },
    };
    saveConfig(config);

    const raw = JSON.parse(readFileSync(configPath(home), "utf8")) as Partial<TuiConfig>;
    assert.equal(raw.schemaVersion, TUI_CONFIG_SCHEMA_VERSION);
    assert.equal(raw.themeId, "nord");
    assert.deepEqual(raw.scanRoots, ["/repos"]);
    assert.equal(raw.view, "shelf");
    assert.deepEqual(raw.observer, { enabled: false });
  });
});

test("updateConfig applies patches and preserves the current schema", () => {
  withFakeHome((home) => {
    writeRawConfig(home, {
      themeId: "monokai",
      scanRoots: ["/old"],
      reducedMotion: true,
    });

    const next = updateConfig({ scanRoots: ["/new"], gardenDensity: "cozy" });
    assert.equal(next.schemaVersion, TUI_CONFIG_SCHEMA_VERSION);
    assert.equal(next.themeId, "monokai");
    assert.deepEqual(next.scanRoots, ["/new"]);
    assert.equal(next.reducedMotion, true);
    assert.equal(next.gardenDensity, "cozy");

    const raw = JSON.parse(readFileSync(configPath(home), "utf8")) as Partial<TuiConfig>;
    assert.equal(raw.schemaVersion, TUI_CONFIG_SCHEMA_VERSION);
    assert.equal(raw.themeId, "monokai");
    assert.deepEqual(raw.scanRoots, ["/new"]);
  });
});
