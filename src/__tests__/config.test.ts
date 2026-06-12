import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  loadConfig,
  githubEnabled,
  observerEnabled,
  reducedMotionEnabled,
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
    assert.equal(config.usageBarDisabled, true);
    assert.equal(config.observer.enabled, true);
    assert.deepEqual(config.github, {
      enabled: false,
      includePrivate: true,
      affiliations: ["owner", "collaborator", "organization_member"],
      cacheTtlMinutes: 30,
      cloneProtocol: "ssh"
    });
  });
});

test("loadConfig returns isolated default object instances", () => {
  withFakeHome(() => {
    const first = loadConfig();
    first.scanRoots.push("/mutated");
    first.observer.enabled = false;

    const second = loadConfig();
    assert.deepEqual(second.scanRoots, []);
    assert.deepEqual(second.observer, { enabled: true });
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
      github: {
        enabled: true,
        includePrivate: false,
        affiliations: ["owner"],
        cacheTtlMinutes: 5,
        cloneProtocol: "https",
      },
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
    assert.deepEqual(config.github, {
      enabled: true,
      includePrivate: false,
      affiliations: ["owner"],
      cacheTtlMinutes: 5,
      cloneProtocol: "https"
    });
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
      github: {
        enabled: "yes",
        includePrivate: "sure",
        affiliations: ["owner", "bad", 7],
        cacheTtlMinutes: -4,
        cloneProtocol: "git",
      },
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
    assert.deepEqual(config.github, {
      enabled: false,
      includePrivate: true,
      affiliations: ["owner"],
      cacheTtlMinutes: 30,
      cloneProtocol: "ssh"
    });
  });
});

test("saveConfig writes tui.json with current schemaVersion", () => {
  withFakeHome((home) => {
    const config: TuiConfig = {
      ...loadConfig(),
      themeId: "nord",
      scanRoots: ["/repos"],
      view: "rooms",
      observer: { enabled: false },
    };
    saveConfig(config);

    const raw = JSON.parse(readFileSync(configPath(home), "utf8")) as Partial<TuiConfig>;
    assert.equal(raw.schemaVersion, TUI_CONFIG_SCHEMA_VERSION);
    assert.equal(raw.themeId, "nord");
    assert.deepEqual(raw.scanRoots, ["/repos"]);
    assert.equal(raw.view, "rooms");
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

test("observerEnabled lets per-run env override persisted config", () => {
  const old = process.env.REPOGARDEN_DISABLE_OBSERVER;
  try {
    withFakeHome(() => {
      delete process.env.REPOGARDEN_DISABLE_OBSERVER;
      assert.equal(observerEnabled({ ...loadConfig(), observer: { enabled: true } }), true);
      process.env.REPOGARDEN_DISABLE_OBSERVER = "1";
      assert.equal(observerEnabled({ ...loadConfig(), observer: { enabled: true } }), false);
    });
  } finally {
    if (old === undefined) {
      delete process.env.REPOGARDEN_DISABLE_OBSERVER;
    } else {
      process.env.REPOGARDEN_DISABLE_OBSERVER = old;
    }
  }
});

test("githubEnabled lets per-run env override persisted config", () => {
  const old = process.env.REPOGARDEN_DISABLE_GITHUB;
  try {
    withFakeHome(() => {
      delete process.env.REPOGARDEN_DISABLE_GITHUB;
      assert.equal(githubEnabled({ ...loadConfig(), github: { ...loadConfig().github, enabled: true } }), true);
      process.env.REPOGARDEN_DISABLE_GITHUB = "1";
      assert.equal(githubEnabled({ ...loadConfig(), github: { ...loadConfig().github, enabled: true } }), false);
    });
  } finally {
    if (old === undefined) {
      delete process.env.REPOGARDEN_DISABLE_GITHUB;
    } else {
      process.env.REPOGARDEN_DISABLE_GITHUB = old;
    }
  }
});

test("reducedMotionEnabled lets per-run env force reduced motion without mutating config", () => {
  const old = process.env.REPOGARDEN_REDUCED_MOTION;
  try {
    withFakeHome((home) => {
      writeRawConfig(home, { ...loadConfig(), reducedMotion: false });

      process.env.REPOGARDEN_REDUCED_MOTION = "1";
      assert.equal(reducedMotionEnabled(loadConfig()), true);

      const raw = JSON.parse(readFileSync(configPath(home), "utf8")) as Partial<TuiConfig>;
      assert.equal(raw.reducedMotion, false, "env override must not rewrite saved config");
    });
  } finally {
    if (old === undefined) {
      delete process.env.REPOGARDEN_REDUCED_MOTION;
    } else {
      process.env.REPOGARDEN_REDUCED_MOTION = old;
    }
  }
});

test("reducedMotionEnabled lets per-run env disable a saved reduced-motion preference", () => {
  const old = process.env.REPOGARDEN_REDUCED_MOTION;
  try {
    withFakeHome(() => {
      process.env.REPOGARDEN_REDUCED_MOTION = "false";
      assert.equal(reducedMotionEnabled({ ...loadConfig(), reducedMotion: true }), false);
    });
  } finally {
    if (old === undefined) {
      delete process.env.REPOGARDEN_REDUCED_MOTION;
    } else {
      process.env.REPOGARDEN_REDUCED_MOTION = old;
    }
  }
});

test("reducedMotionEnabled preserves saved reduced-motion preference when env is absent", () => {
  const old = process.env.REPOGARDEN_REDUCED_MOTION;
  try {
    delete process.env.REPOGARDEN_REDUCED_MOTION;
    withFakeHome(() => {
      assert.equal(reducedMotionEnabled({ ...loadConfig(), reducedMotion: true }), true);
    });
  } finally {
    if (old === undefined) {
      delete process.env.REPOGARDEN_REDUCED_MOTION;
    } else {
      process.env.REPOGARDEN_REDUCED_MOTION = old;
    }
  }
});
