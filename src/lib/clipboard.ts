import { spawnSync } from "node:child_process";

/**
 * Best-effort cross-platform system-clipboard write from a TUI.
 *
 * Strategy order:
 *   1. WSL — pipe to `clip.exe` (most reliable on WSL: bypasses terminal
 *      OSC handling and writes directly to the Windows clipboard).
 *   2. macOS — `pbcopy`.
 *   3. Linux (non-WSL) — Wayland `wl-copy`, then X11 `xclip`, then `xsel`.
 *   4. Fallback — OSC 52 escape, which modern terminals (iTerm2, kitty,
 *      alacritty, recent xterm, Windows Terminal post-2022) interpret as
 *      a clipboard write. Older terminals will silently ignore the sequence
 *      but it leaves stdout cleanly either way.
 *
 * Returns true when any strategy reports success. Note that OSC 52 always
 * "succeeds" from our side because we can't observe the terminal's response;
 * if no native tool is available the caller can't tell whether the user's
 * clipboard actually updated. That's an irreducible limitation of OSC 52.
 */
export const writeToSystemClipboard = (text: string): boolean => {
  if (!text) return false;

  const tryNative = (cmd: string, args: string[] = []): boolean => {
    try {
      const result = spawnSync(cmd, args, { input: text, encoding: "utf8" });
      return result.status === 0;
    } catch {
      return false;
    }
  };

  const isWSL =
    process.platform === "linux" &&
    (process.env.WSL_DISTRO_NAME !== undefined || process.env.WSL_INTEROP !== undefined);

  if (isWSL) {
    if (tryNative("clip.exe")) return true;
  } else if (process.platform === "darwin") {
    if (tryNative("pbcopy")) return true;
  } else if (process.platform === "linux") {
    if (process.env.WAYLAND_DISPLAY && tryNative("wl-copy")) return true;
    if (tryNative("xclip", ["-selection", "clipboard"])) return true;
    if (tryNative("xsel", ["--clipboard", "--input"])) return true;
  } else if (process.platform === "win32") {
    if (tryNative("clip")) return true;
  }

  // OSC 52 fallback. ESC ] 52 ; c ; <base64> BEL.
  try {
    const payload = Buffer.from(text, "utf8").toString("base64");
    process.stdout.write(`]52;c;${payload}`);
    return true;
  } catch {
    return false;
  }
};

/**
 * Best-effort cross-platform system-clipboard read. Mirrors the platform
 * strategy of `writeToSystemClipboard`. Returns null when no native tool is
 * available or the read failed — OSC 52 reads aren't supported here because
 * they require terminal cooperation we can't synchronously observe.
 *
 * Trailing newlines added by the underlying tool (notably `Get-Clipboard`
 * on Windows/WSL, which suffixes CRLF) are stripped so paste round-trips
 * don't accumulate phantom newlines.
 */
export const readFromSystemClipboard = (): string | null => {
  const tryNative = (cmd: string, args: string[] = []): string | null => {
    try {
      const result = spawnSync(cmd, args, { encoding: "utf8" });
      if (result.status !== 0) return null;
      return result.stdout;
    } catch {
      return null;
    }
  };

  const isWSL =
    process.platform === "linux" &&
    (process.env.WSL_DISTRO_NAME !== undefined || process.env.WSL_INTEROP !== undefined);

  let raw: string | null = null;
  if (isWSL) {
    raw = tryNative("powershell.exe", ["-NoProfile", "-Command", "Get-Clipboard"]);
  } else if (process.platform === "darwin") {
    raw = tryNative("pbpaste");
  } else if (process.platform === "linux") {
    if (process.env.WAYLAND_DISPLAY) raw = tryNative("wl-paste", ["--no-newline"]);
    if (raw === null) raw = tryNative("xclip", ["-selection", "clipboard", "-o"]);
    if (raw === null) raw = tryNative("xsel", ["--clipboard", "--output"]);
  } else if (process.platform === "win32") {
    raw = tryNative("powershell", ["-NoProfile", "-Command", "Get-Clipboard"]);
  }

  if (raw === null) return null;
  // Normalize CRLF and drop a single trailing newline that command-line
  // clipboard tools commonly append.
  return raw.replace(/\r\n/g, "\n").replace(/\n$/, "");
};
