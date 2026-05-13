import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { appendEvent } from "./events";

export interface ProjectMemory {
  currentBlocker?: string;
  noteToFutureSelf?: string;
  lastVisitedAt?: string;
  hidden?: boolean;
  gardenPlacement?: {
    offsetX: number;
    offsetY: number;
  };
}

const memoryDir = (): string => join(homedir(), ".repogarden", "projects");

const filePath = (id: string): string => join(memoryDir(), `${id}.json`);

const ensureDir = (): void => {
  try {
    mkdirSync(memoryDir(), { recursive: true });
  } catch {
    // Directory may already exist or be unwritable; loadMemory will return empty.
  }
};

export const loadMemory = (id: string): ProjectMemory => {
  try {
    const path = filePath(id);
    if (!existsSync(path)) return {};
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as Partial<ProjectMemory>;
    const gardenPlacement =
      parsed.gardenPlacement &&
      Number.isFinite(parsed.gardenPlacement.offsetX) &&
      Number.isFinite(parsed.gardenPlacement.offsetY)
        ? {
            offsetX: Math.round(parsed.gardenPlacement.offsetX),
            offsetY: Math.round(parsed.gardenPlacement.offsetY)
          }
        : undefined;
    return {
      currentBlocker: typeof parsed.currentBlocker === "string" ? parsed.currentBlocker : undefined,
      noteToFutureSelf: typeof parsed.noteToFutureSelf === "string" ? parsed.noteToFutureSelf : undefined,
      lastVisitedAt: typeof parsed.lastVisitedAt === "string" ? parsed.lastVisitedAt : undefined,
      hidden: typeof parsed.hidden === "boolean" ? parsed.hidden : undefined,
      gardenPlacement
    };
  } catch {
    return {};
  }
};

/**
 * Persist memory for a repo. When `repoName` is provided the function reads
 * the prior memory from disk before overwriting so it can diff the
 * `currentBlocker` field and emit the appropriate journal event:
 *   - empty → nonempty  → blocker-added
 *   - nonempty → empty  → blocker-cleared
 *   - both nonempty, changed → no emit (avoids typo-edit spam)
 *   - no change → no emit
 */
export const saveMemory = (id: string, memory: ProjectMemory, repoName = ""): void => {
  ensureDir();

  // Read prior state from disk so call sites don't need to thread it through.
  const prev = loadMemory(id);

  try {
    writeFileSync(filePath(id), JSON.stringify(memory, null, 2), "utf8");
  } catch {
    // best-effort; in-memory copy lives on regardless.
  }

  // Only emit blocker events when a repoName was provided (so internal
  // housekeeping calls like touchMemory stay silent).
  if (repoName) {
    const prevBlocker = prev.currentBlocker?.trim() ?? "";
    const nextBlocker = memory.currentBlocker?.trim() ?? "";
    const ts = new Date().toISOString();

    if (!prevBlocker && nextBlocker) {
      appendEvent({
        ts,
        repoId: id,
        repoName,
        kind: "blocker-added",
        payload: { firstLine: nextBlocker.split("\n")[0].slice(0, 200) },
      });
    } else if (prevBlocker && !nextBlocker) {
      appendEvent({
        ts,
        repoId: id,
        repoName,
        kind: "blocker-cleared",
        payload: { firstLine: prevBlocker.split("\n")[0].slice(0, 200) },
      });
    }
    // both nonempty but changed → no emit (avoids typo spam)
    // both empty → no emit
  }
};

export const touchMemory = (id: string, current: ProjectMemory): ProjectMemory => {
  const next: ProjectMemory = { ...current, lastVisitedAt: new Date().toISOString() };
  // touchMemory is a housekeeping call — no repoName, so no blocker events.
  saveMemory(id, next);
  return next;
};
