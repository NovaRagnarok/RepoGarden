import { spawn } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";

const OPEN_SUCCESS_TIMEOUT_MS = 500;

type Opener = { cmd: string; args: string[] };

interface SpawnedChild {
  once(event: "error", listener: (error: Error) => void): SpawnedChild;
  once(event: "close", listener: (code: number | null) => void): SpawnedChild;
  unref(): void;
}

interface OpenInFileBrowserDeps {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  hasCommand?: (cmd: string, env?: NodeJS.ProcessEnv) => boolean;
  spawnCommand?: (
    cmd: string,
    args: string[],
    options: { stdio: "ignore"; detached: true }
  ) => SpawnedChild;
  successTimeoutMs?: number;
}

const isWsl = (platform: NodeJS.Platform, env: NodeJS.ProcessEnv): boolean =>
  platform === "linux" && (env.WSL_DISTRO_NAME !== undefined || env.WSL_INTEROP !== undefined);

const commandExists = (cmd: string, env: NodeJS.ProcessEnv = process.env): boolean => {
  const candidates = isAbsolute(cmd) ? [cmd] : (env.PATH ?? "").split(delimiter).map((dir) => join(dir, cmd));
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      accessSync(candidate, constants.X_OK);
      return true;
    } catch {
      continue;
    }
  }
  return false;
};

export const detectFileBrowserOpener = ({
  platform = process.platform,
  env = process.env,
  hasCommand = commandExists,
}: Pick<OpenInFileBrowserDeps, "platform" | "env" | "hasCommand"> = {}): Opener | null => {
  if (platform === "darwin") return { cmd: "open", args: [] };
  if (platform === "win32") return { cmd: "cmd", args: ["/c", "start", ""] };
  if (platform !== "linux") return null;

  if (isWsl(platform, env)) {
    if (hasCommand("wslview", env)) return { cmd: "wslview", args: [] };
    if (hasCommand("explorer.exe", env)) return { cmd: "explorer.exe", args: [] };
  }

  if (hasCommand("xdg-open", env)) return { cmd: "xdg-open", args: [] };
  return null;
};

export const openInFileBrowser = async (
  path: string,
  {
    platform = process.platform,
    env = process.env,
    hasCommand = commandExists,
    spawnCommand = spawn,
    successTimeoutMs = OPEN_SUCCESS_TIMEOUT_MS,
  }: OpenInFileBrowserDeps = {}
): Promise<boolean> => {
  const opener = detectFileBrowserOpener({ platform, env, hasCommand });
  if (!opener) return false;

  try {
    return await new Promise<boolean>((resolve) => {
      let settled = false;
      const child = spawnCommand(opener.cmd, [...opener.args, path], {
        stdio: "ignore",
        detached: true,
      });
      const timer = setTimeout(() => settle(true), successTimeoutMs);

      const settle = (ok: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (ok) child.unref();
        resolve(ok);
      };

      child.once("error", () => settle(false));
      child.once("close", (code) => settle(code === 0));
    });
  } catch {
    return false;
  }
};
