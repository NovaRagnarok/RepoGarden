import test from "node:test";
import assert from "node:assert/strict";

import { writeToSystemClipboard } from "../lib/clipboard";

const captureStdout = <T>(run: () => T): { result: T; written: string } => {
  const original = process.stdout.write.bind(process.stdout);
  const chunks: string[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (process.stdout as any).write = (chunk: unknown) => {
    chunks.push(typeof chunk === "string" ? chunk : String(chunk));
    return true;
  };
  try {
    const result = run();
    return { result, written: chunks.join("") };
  } finally {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (process.stdout as any).write = original;
  }
};

test("writeToSystemClipboard returns false on empty input", () => {
  const { result, written } = captureStdout(() => writeToSystemClipboard(""));
  assert.equal(result, false);
  assert.equal(written, "");
});

test("writeToSystemClipboard emits OSC 52 sequence when native tools unavailable", () => {
  // Force the fallback path by pretending we're on an unknown platform.
  const originalPlatform = process.platform;
  const originalWSL = process.env.WSL_DISTRO_NAME;
  const originalInterop = process.env.WSL_INTEROP;
  Object.defineProperty(process, "platform", { value: "openbsd", configurable: true });
  delete process.env.WSL_DISTRO_NAME;
  delete process.env.WSL_INTEROP;
  try {
    const { result, written } = captureStdout(() =>
      writeToSystemClipboard("hello world")
    );
    assert.equal(result, true);
    // ESC ] 52 ; c ; <base64> BEL
    const payload = Buffer.from("hello world", "utf8").toString("base64");
    assert.ok(written.includes(`]52;c;${payload}`), "expected OSC 52 sequence");
  } finally {
    Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
    if (originalWSL !== undefined) process.env.WSL_DISTRO_NAME = originalWSL;
    if (originalInterop !== undefined) process.env.WSL_INTEROP = originalInterop;
  }
});
