import test from "node:test";
import assert from "node:assert/strict";

import { buildDemoCreatures } from "../lib/demo-roster";
import {
  ExportCliArgumentError,
  parseExportArgs,
  runExportGifCli,
  runExportTextCli,
  type ExportCommand
} from "../lib/gif/cli";

interface InvalidCase {
  command: ExportCommand;
  args: string[];
  message: RegExp;
}

const expectInvalid = ({ command, args, message }: InvalidCase): void => {
  assert.throws(
    () => parseExportArgs(command, args),
    (error: unknown) =>
      error instanceof ExportCliArgumentError && message.test(error.message),
    `${command} ${args.join(" ")}`
  );
};

test("export parser rejects missing, unknown, duplicate, and command-specific options", () => {
  const cases: InvalidCase[] = [
    { command: "gif", args: ["--root"], message: /--root requires a value/ },
    { command: "gif", args: ["--out"], message: /--out requires a value/ },
    { command: "gif", args: ["-o"], message: /-o requires a value/ },
    { command: "gif", args: ["--scale"], message: /--scale requires a value/ },
    { command: "gif", args: ["--seconds"], message: /--seconds requires a value/ },
    { command: "gif", args: ["--theme"], message: /--theme requires a value/ },
    { command: "gif", args: ["--width"], message: /--width requires a value/ },
    { command: "gif", args: ["--height"], message: /--height requires a value/ },
    { command: "gif", args: ["--page"], message: /--page requires a value/ },
    { command: "text", args: ["--max-chars"], message: /--max-chars requires a value/ },
    { command: "gif", args: ["--wat"], message: /unknown export option: --wat/ },
    { command: "text", args: ["-x"], message: /unknown export option: -x/ },
    {
      command: "gif",
      args: ["one", "two"],
      message: /unexpected positional argument: two/
    },
    {
      command: "gif",
      args: ["--width", "40", "--width", "41"],
      message: /--width may only be specified once/
    },
    {
      command: "text",
      args: ["--scale", "1"],
      message: /--scale is only valid with export-gif/
    },
    {
      command: "gif",
      args: ["--discord"],
      message: /--discord is only valid with export-text/
    },
    {
      command: "gif",
      args: ["--theme", "not-a-theme"],
      message: /--theme has unknown id "not-a-theme"/
    }
  ];
  for (const entry of cases) expectInvalid(entry);
});

test("export parser rejects non-finite, fractional, unsafe, and out-of-range numerics", () => {
  const cases: InvalidCase[] = [
    { command: "gif", args: ["--width", "NaN"], message: /finite number/ },
    { command: "gif", args: ["--height", "Infinity"], message: /finite number/ },
    { command: "gif", args: ["--scale", "-Infinity"], message: /finite number/ },
    { command: "gif", args: ["--seconds", "NaN"], message: /finite number/ },
    { command: "gif", args: ["--page", "Infinity"], message: /finite number/ },
    { command: "text", args: ["--max-chars", "NaN"], message: /finite number/ },
    { command: "gif", args: ["--width", "40.5"], message: /safe integer/ },
    { command: "gif", args: ["--height", "12.5"], message: /safe integer/ },
    { command: "gif", args: ["--scale", "1.5"], message: /safe integer/ },
    { command: "gif", args: ["--page", "1.5"], message: /safe integer/ },
    { command: "text", args: ["--max-chars", "1.5"], message: /safe integer/ },
    {
      command: "gif",
      args: ["--page", "9007199254740992"],
      message: /safe integer/
    },
    { command: "gif", args: ["--width", "39"], message: /between 40 and 320/ },
    { command: "gif", args: ["--width", "321"], message: /between 40 and 320/ },
    { command: "gif", args: ["--height", "11"], message: /between 12 and 90/ },
    { command: "gif", args: ["--height", "91"], message: /between 12 and 90/ },
    { command: "gif", args: ["--scale", "0"], message: /between 1 and 5/ },
    { command: "gif", args: ["--scale", "6"], message: /between 1 and 5/ },
    { command: "gif", args: ["--seconds", "0.24"], message: /between 0.25 and 10/ },
    { command: "gif", args: ["--seconds", "10.01"], message: /between 0.25 and 10/ },
    { command: "gif", args: ["--page", "0"], message: /between 1 and 1000/ },
    { command: "gif", args: ["--page", "1001"], message: /between 1 and 1000/ },
    { command: "text", args: ["--max-chars", "0"], message: /between 1 and 100000/ },
    {
      command: "text",
      args: ["--max-chars", "100001"],
      message: /between 1 and 100000/
    },
    {
      command: "gif",
      args: ["--width", "320", "--height", "90", "--scale", "5"],
      message: /pixels per frame; the limit is 20,000,000/
    },
    {
      command: "gif",
      args: ["--width", "320", "--height", "90", "--scale", "2", "--seconds", "10"],
      message: /loop limit is 250,000,000/
    }
  ];
  for (const entry of cases) expectInvalid(entry);
});

test("export parser accepts documented boundaries", () => {
  assert.equal(parseExportArgs("gif", ["--width", "40"]).width, 40);
  assert.equal(parseExportArgs("gif", ["--width", "320"]).width, 320);
  assert.equal(parseExportArgs("gif", ["--height", "12"]).height, 12);
  assert.equal(parseExportArgs("gif", ["--height", "90"]).height, 90);
  assert.equal(
    parseExportArgs("gif", [
      "--width",
      "40",
      "--height",
      "12",
      "--scale",
      "5"
    ]).scale,
    5
  );
  assert.equal(parseExportArgs("gif", ["--seconds", "0.25"]).seconds, 0.25);
  assert.equal(parseExportArgs("gif", ["--seconds", "10"]).seconds, 10);
  assert.equal(parseExportArgs("gif", ["--page", "1000"]).page, 1000);
  assert.equal(
    parseExportArgs("text", ["--max-chars", "100000"]).maxChars,
    100_000
  );
  assert.equal(parseExportArgs("text", ["--discord"]).maxChars, 1999);
  assert.equal(parseExportArgs("text", ["/fixture/repos"]).root, "/fixture/repos");
});

test("invalid export options fail before scan, enrichment, or GIF allocation", async () => {
  let scanCalls = 0;
  let enrichCalls = 0;
  let allocationCalls = 0;
  const dependencies = {
    scanRoots: () => {
      scanCalls += 1;
      return { repos: [], rootsUsed: [], errors: [] };
    },
    enrichScans: () => {
      enrichCalls += 1;
      return [];
    },
    exportGardenGif: async () => {
      allocationCalls += 1;
      throw new Error("export allocation should not run");
    },
    writeStdout: () => {
      assert.fail("invalid export must not write stdout");
    }
  };

  await assert.rejects(
    runExportGifCli(
      ["--width", "320", "--height", "90", "--scale", "5"],
      dependencies
    ),
    /pixels per frame/
  );
  await assert.rejects(
    runExportTextCli(["--max-chars", "0"], {
      scanRoots: dependencies.scanRoots,
      enrichScans: dependencies.enrichScans,
      writeStdout: dependencies.writeStdout,
      writeStderr: () => {
        assert.fail("parse errors are raised before runtime output");
      }
    }),
    /--max-chars must be between 1 and 100000/
  );
  assert.equal(scanCalls, 0);
  assert.equal(enrichCalls, 0);
  assert.equal(allocationCalls, 0);
});

test("GIF CLI passes one coherent timing plan to the exporter", async () => {
  const creatures = buildDemoCreatures();
  let receivedDelays: readonly number[] | undefined;
  const exitCode = await runExportGifCli(
    ["--root", "/synthetic/repos", "--width", "40", "--height", "12", "--seconds", "3"],
    {
      scanRoots: (roots) => ({
        repos: creatures.map((creature) => creature.scan),
        rootsUsed: roots,
        errors: []
      }),
      enrichScans: () => creatures,
      exportGardenGif: async (_scene, options) => {
        assert.ok(options, "CLI should pass explicit GIF export options");
        receivedDelays = options.frameDelaysMs;
        const frameDelaysMs = [...(receivedDelays ?? [])];
        return {
          path: "/synthetic/garden.gif",
          bytes: new Uint8Array(),
          width: 1,
          height: 1,
          frameCount: frameDelaysMs.length,
          frameDelaysMs,
          durationMs: frameDelaysMs.reduce((sum, delay) => sum + delay, 0)
        };
      },
      writeStdout: () => undefined
    }
  );

  assert.equal(exitCode, 0);
  assert.ok(receivedDelays);
  assert.equal(receivedDelays.length, 24);
  assert.equal(receivedDelays.reduce((sum, delay) => sum + delay, 0), 3000);
  assert.ok(Math.max(...receivedDelays) - Math.min(...receivedDelays) <= 10);
});
