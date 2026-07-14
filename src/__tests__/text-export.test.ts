import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { GardenThemeColors } from "../garden/types";
import { buildDemoCreatures } from "../lib/demo-roster";
import { runExportTextCli } from "../lib/gif/cli";
import {
  fitShareableTextFrame,
  MIN_SHAREABLE_TEXT_WIDTH,
  renderTextFrame
} from "../lib/gif/text-export";
import { highContrastTheme } from "../themes/high-contrast";
import {
  loadScanSnapshot,
  readEvents,
  saveEventsMeta,
  saveScanSnapshot,
} from "../lib/events";

const withFakeHome = async (run: () => Promise<void>): Promise<void> => {
  const fake = mkdtempSync(join(tmpdir(), "repogarden-text-export-home-"));
  const oldHome = process.env.HOME;
  const oldUserProfile = process.env.USERPROFILE;
  process.env.HOME = fake;
  process.env.USERPROFILE = fake;
  try {
    await run();
  } finally {
    process.env.HOME = oldHome;
    process.env.USERPROFILE = oldUserProfile;
    rmSync(fake, { recursive: true, force: true });
  }
};

const exportTheme: GardenThemeColors = {
  foreground: highContrastTheme.colors.foreground,
  background: highContrastTheme.colors.background,
  muted: highContrastTheme.colors.muted,
  mutedForeground: highContrastTheme.colors.mutedForeground,
  primary: highContrastTheme.colors.primary,
  accent: highContrastTheme.colors.accent,
  success: highContrastTheme.colors.success,
  warning: highContrastTheme.colors.warning,
  error: highContrastTheme.colors.error,
  info: highContrastTheme.colors.info,
  creaturePalette: highContrastTheme.creaturePalette
};

test("shareable text chooses the widest fit across a pagination discontinuity", () => {
  const creatures = buildDemoCreatures();
  const startWidth = 180;
  const startHeight = 12;
  const budget = 1201;
  const ratio = startHeight / startWidth;
  const candidates = Array.from(
    { length: startWidth - MIN_SHAREABLE_TEXT_WIDTH + 1 },
    (_, index) => {
      const width = MIN_SHAREABLE_TEXT_WIDTH + index;
      const height = Math.max(8, Math.round(width * ratio));
      const text = renderTextFrame(creatures, {
        innerWidth: width,
        canvasH: height,
        theme: exportTheme,
        shareFormat: true,
        nameMaxChars: 16
      });
      return { width, height, text };
    }
  );
  const at132 = candidates.find((candidate) => candidate.width === 132);
  const at133 = candidates.find((candidate) => candidate.width === 133);
  assert.equal(at132?.text.length, 1301);
  assert.equal(at133?.text.length, 1201);
  assert.ok(
    (at133?.text.length ?? Number.POSITIVE_INFINITY) <
      (at132?.text.length ?? Number.NEGATIVE_INFINITY),
    "fixture must retain the non-monotonic layout boundary"
  );

  const oracle = candidates
    .filter((candidate) => candidate.text.length <= budget)
    .at(-1);
  assert.ok(oracle, "expected at least one supported panorama to fit");

  const result = fitShareableTextFrame(creatures, {
    theme: exportTheme,
    maxChars: budget,
    shareFormat: true,
    nameMaxChars: 16,
    startWidth,
    startHeight
  });
  assert.ok(result.ok, "expected the budget to fit a supported panorama");
  assert.equal(result.width, oracle.width);
  assert.equal(result.height, oracle.height);
  assert.equal(result.text, oracle.text);
  assert.equal(result.width, 133);
});

test("budgeted text CLI scans and enriches once across multiple width probes", async () => {
  const creatures = buildDemoCreatures();
  let scanCalls = 0;
  let enrichCalls = 0;
  let stdout = "";
  let stderr = "";

  const exitCode = await runExportTextCli(
    ["--root", "/synthetic/repos", "--max-chars", "1201"],
    {
      scanRoots: (roots, maxDepth) => {
        scanCalls += 1;
        assert.deepEqual(roots, ["/synthetic/repos"]);
        assert.equal(maxDepth, 4);
        return {
          repos: creatures.map((creature) => creature.scan),
          rootsUsed: roots,
          errors: []
        };
      },
      enrichScans: (scans, options) => {
        enrichCalls += 1;
        assert.equal(scans.length, creatures.length);
        assert.deepEqual(options, { reconcile: false });
        return creatures;
      },
      writeStdout: (text) => {
        stdout += text;
      },
      writeStderr: (text) => {
        stderr += text;
      }
    }
  );

  assert.equal(exitCode, 0);
  assert.equal(scanCalls, 1);
  assert.equal(enrichCalls, 1);
  assert.equal(stderr, "");
  assert.ok(stdout.endsWith("\n"));
  assert.equal(stdout.slice(0, -1).length, 1201);
});

test("scoped text export leaves the global scan snapshot and journal untouched", async () => {
  await withFakeHome(async () => {
    const [alpha, beta] = buildDemoCreatures();
    saveEventsMeta({ seeded: true, seededAt: new Date().toISOString() });
    const baselineSnapshot = {
      [alpha.id]: {
        vibe: alpha.vibe.vibe,
        branch: "saved-alpha",
        latestCommitSha: "a".repeat(40),
      },
      [beta.id]: {
        vibe: beta.vibe.vibe,
        branch: "saved-beta",
        latestCommitSha: "b".repeat(40),
      },
    };
    saveScanSnapshot(baselineSnapshot);
    const persistedBaseline = loadScanSnapshot();

    let stdout = "";
    const exitCode = await runExportTextCli(
      ["--root", "/scoped/alpha", "--width", "40", "--height", "12"],
      {
        scanRoots: (roots, maxDepth) => {
          assert.deepEqual(roots, ["/scoped/alpha"]);
          assert.equal(maxDepth, 4);
          return { repos: [alpha.scan], rootsUsed: roots, errors: [] };
        },
        writeStdout: (text) => {
          stdout += text;
        },
        writeStderr: (text) => {
          assert.fail(`unexpected export failure: ${text}`);
        },
      }
    );

    assert.equal(exitCode, 0);
    assert.ok(stdout.length > 0);
    assert.deepEqual(loadScanSnapshot(), persistedBaseline);
    assert.deepEqual(readEvents(), []);
  });
});

test("budgeted text CLI preserves the requested export page", async () => {
  const creatures = buildDemoCreatures();
  const renderPage = async (page: number): Promise<string> => {
    let stdout = "";
    const exitCode = await runExportTextCli(
      [
        "--root",
        "/synthetic/repos",
        "--max-chars",
        "10000",
        "--width",
        "40",
        "--height",
        "12",
        "--page",
        String(page)
      ],
      {
        scanRoots: (roots) => ({
          repos: creatures.map((creature) => creature.scan),
          rootsUsed: roots,
          errors: []
        }),
        enrichScans: () => creatures,
        writeStdout: (text) => {
          stdout += text;
        },
        writeStderr: (text) => {
          assert.fail(`unexpected export failure: ${text}`);
        }
      }
    );
    assert.equal(exitCode, 0);
    return stdout;
  };

  const firstPage = await renderPage(1);
  const secondPage = await renderPage(2);
  assert.notEqual(secondPage, firstPage);
});

test("impossible text budget writes no output and returns an actionable failure", async () => {
  const creatures = buildDemoCreatures();
  const directory = mkdtempSync(join(tmpdir(), "repogarden-text-export-"));
  const outputPath = join(directory, "garden.txt");
  let stdout = "";
  let stderr = "";
  try {
    const exitCode = await runExportTextCli(
      [
        "--root",
        "/synthetic/repos",
        "--max-chars",
        "1",
        "--width",
        "40",
        "--out",
        outputPath
      ],
      {
        scanRoots: (roots) => ({
          repos: creatures.map((creature) => creature.scan),
          rootsUsed: roots,
          errors: []
        }),
        enrichScans: () => creatures,
        writeStdout: (text) => {
          stdout += text;
        },
        writeStderr: (text) => {
          stderr += text;
        }
      }
    );

    assert.equal(exitCode, 1);
    assert.equal(stdout, "");
    assert.equal(existsSync(outputPath), false);
    assert.match(stderr, /^export-text: --max-chars 1 is too small;/);
    assert.match(stderr, /Increase --max-chars to at least \d+\./);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
