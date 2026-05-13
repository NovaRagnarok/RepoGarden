import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import { detectFileBrowserOpener, openInFileBrowser } from "../lib/system";

class FakeChild extends EventEmitter {
  unrefCalls = 0;

  unref() {
    this.unrefCalls += 1;
  }
}

test("detectFileBrowserOpener prefers wslview before explorer.exe on WSL", () => {
  const opener = detectFileBrowserOpener({
    platform: "linux",
    env: { PATH: "/usr/bin", WSL_DISTRO_NAME: "Ubuntu" },
    hasCommand: (cmd) => cmd === "wslview" || cmd === "explorer.exe",
  });

  assert.deepEqual(opener, { cmd: "wslview", args: [] });
});

test("detectFileBrowserOpener falls back to explorer.exe on WSL when xdg-open is missing", () => {
  const opener = detectFileBrowserOpener({
    platform: "linux",
    env: { PATH: "/usr/bin", WSL_INTEROP: "/run/WSL/1_interop" },
    hasCommand: (cmd) => cmd === "explorer.exe",
  });

  assert.deepEqual(opener, { cmd: "explorer.exe", args: [] });
});

test("openInFileBrowser returns false when spawn errors after returning", async () => {
  const child = new FakeChild();
  const opened = await openInFileBrowser("/tmp/repo", {
    platform: "darwin",
    spawnCommand: () => {
      setImmediate(() => child.emit("error", new Error("ENOENT")));
      return child;
    },
    successTimeoutMs: 50,
  });

  assert.equal(opened, false);
  assert.equal(child.unrefCalls, 0);
});

test("openInFileBrowser returns true after a successful child close", async () => {
  const child = new FakeChild();
  const opened = await openInFileBrowser("/tmp/repo", {
    platform: "darwin",
    spawnCommand: () => {
      setImmediate(() => child.emit("close", 0));
      return child;
    },
    successTimeoutMs: 50,
  });

  assert.equal(opened, true);
  assert.equal(child.unrefCalls, 1);
});
