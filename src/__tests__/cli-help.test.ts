import assert from "node:assert/strict";
import test from "node:test";

import { CLI_HELP_TEXT, hasHelpFlag, hasVersionFlag } from "../lib/cli-help";

test("hasHelpFlag detects both long and short help flags", () => {
  assert.equal(hasHelpFlag(["--help"]), true);
  assert.equal(hasHelpFlag(["-h"]), true);
  assert.equal(hasHelpFlag(["--version"]), false);
});

test("hasVersionFlag detects both long and short version flags", () => {
  assert.equal(hasVersionFlag(["--version"]), true);
  assert.equal(hasVersionFlag(["-v"]), true);
  assert.equal(hasVersionFlag(["--help"]), false);
});

test("CLI_HELP_TEXT includes the expected commands", () => {
  assert.match(CLI_HELP_TEXT, /^RepoGarden$/m);
  assert.match(CLI_HELP_TEXT, /repogarden --help/);
  assert.match(CLI_HELP_TEXT, /npm run dev/);
  assert.match(CLI_HELP_TEXT, /npm start/);
});
