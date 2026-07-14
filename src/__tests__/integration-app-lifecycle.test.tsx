// The harness import must stay first: it redirects HOME and disables provider
// reads before the production coordinator or any persistence module loads.
import {
  createProductionInput,
  renderInk,
  waitFor,
  type InkHarness,
} from "./helpers/ink-harness";

import assert from "node:assert/strict";
import test from "node:test";

import { Root, type AppRuntimeOptions } from "../cli-main";
import {
  TUI_CONFIG_SCHEMA_VERSION,
  type TuiConfig,
} from "../lib/config";

process.env.REPOGARDEN_NO_UPDATE_CHECK = "1";

const SIZE = { columns: 120, rows: 40 };
const READY_MARKER = "⌂ home";

const FIXTURE_CONFIG: TuiConfig = {
  schemaVersion: TUI_CONFIG_SCHEMA_VERSION,
  themeId: "high-contrast",
  scanRoots: [],
  view: "garden",
  reducedMotion: true,
  usageBarDisabled: true,
  observer: { enabled: false },
  gardenPaginate: true,
  gardenDensity: "comfortable",
  bellOnVibeChange: false,
  github: {
    enabled: false,
    includePrivate: false,
    affiliations: ["owner"],
    cacheTtlMinutes: 30,
    cloneProtocol: "ssh",
  },
};

const FIXTURE_RUNTIME: AppRuntimeOptions = {
  bootScanDelayMs: 40,
  minBootPresentationMs: 0,
  scheduleStartupPrune: () => undefined,
};

const frameContext = (harness: InkHarness): (() => string) =>
  () => harness.lastFrame();

test("production coordinator replaces stale screens and handles wrapped terminal input", async () => {
  const input = createProductionInput();
  const harness = renderInk(
    <Root initialConfig={FIXTURE_CONFIG} appRuntime={FIXTURE_RUNTIME} />,
    { ...SIZE, input }
  );

  try {
    await waitFor(() => harness.lastFrame().includes("HABITAT WAKEUP"), {
      onTimeout: frameContext(harness),
    });
    await waitFor(() => harness.lastFrame().includes("FIRST RUN"), {
      onTimeout: frameContext(harness),
    });
    assert.doesNotMatch(harness.lastFrame(), /HABITAT WAKEUP|waking up local state/);

    // Use the real onboarding handler to seed the synthetic roster and enter
    // ready state without scanning any filesystem repository.
    harness.press("d");
    await waitFor(() => harness.lastFrame().includes(READY_MARKER), {
      onTimeout: frameContext(harness),
    });
    assert.doesNotMatch(harness.lastFrame(), /FIRST RUN|choose where your repos live/);

    harness.press("?");
    await waitFor(() => harness.lastFrame().includes("keyboard shortcuts"), {
      onTimeout: frameContext(harness),
    });
    assert.ok(!harness.lastFrame().includes(READY_MARKER), "ready chrome must not remain under help");

    // A mouse report split after ESC must be recombined and stripped by the
    // production wrapper. It must neither close Help nor leak printable tail
    // bytes into Ink as keyboard input.
    harness.writeInput("\x1b");
    harness.writeInput("[<0;42;7M");
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.match(harness.lastFrame(), /keyboard shortcuts/);
    assert.doesNotMatch(harness.lastFrame(), /<0;42;7M/);

    // A genuinely bare ESC takes the production wrapper's pending-prefix
    // timeout path, reaches Ink, and returns to the coordinator's ready phase.
    harness.press("escape");
    await waitFor(
      () => harness.lastFrame().includes(READY_MARKER) &&
        !harness.lastFrame().includes("keyboard shortcuts"),
      { onTimeout: frameContext(harness) }
    );

    harness.press("s");
    await waitFor(() => harness.lastFrame().includes("SETTINGS"), {
      onTimeout: frameContext(harness),
    });
    assert.ok(!harness.lastFrame().includes(READY_MARKER), "ready chrome must not remain under settings");
    harness.press("escape");
    await waitFor(
      () => harness.lastFrame().includes(READY_MARKER) &&
        !harness.lastFrame().includes("SETTINGS"),
      { onTimeout: frameContext(harness) }
    );

    harness.press("U");
    await waitFor(() => harness.lastFrame().includes("claude / codex plan windows"), {
      onTimeout: frameContext(harness),
    });
    assert.ok(!harness.lastFrame().includes(READY_MARKER), "ready chrome must not remain under usage");
    harness.press("escape");
    await waitFor(
      () => harness.lastFrame().includes(READY_MARKER) &&
        !harness.lastFrame().includes("claude / codex plan windows"),
      { onTimeout: frameContext(harness) }
    );
  } finally {
    harness.unmount();
  }
});
