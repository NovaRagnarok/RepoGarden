import type { GardenDensity } from "@/lib/garden-layout";

export type AppPhase =
  | "booting"
  | "onboarding"
  | "ready"
  | "settings"
  | "workbench"
  | "help"
  | "edit-roots";

export interface ScanStatus {
  kind: "idle" | "scanning" | "error" | "ok";
  message: string;
}

export interface ScanOutcome {
  ok: boolean;
  count: number;
  message: string;
}

export const parseScanRoots = (raw: string): string[] =>
  raw
    .split(/[,\n]/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

export const bootPhaseForScanOutcome = (
  outcome: ScanOutcome
): { phase: AppPhase; scanStatus?: ScanStatus } => {
  if (outcome.ok && outcome.count > 0) {
    return { phase: "ready" };
  }
  return {
    phase: "onboarding",
    scanStatus: { kind: "error", message: outcome.message }
  };
};

export const nextGardenDensity = (current: GardenDensity): GardenDensity => {
  const order: GardenDensity[] = ["cozy", "comfortable", "dense"];
  return order[(order.indexOf(current) + 1) % order.length] ?? "comfortable";
};

export const countVibeFlips = (
  previous: ReadonlyMap<string, string> | null | undefined,
  current: ReadonlyMap<string, string>
): number => {
  if (!previous) return 0;
  let flips = 0;
  for (const [id, vibe] of current) {
    const before = previous.get(id);
    if (before !== undefined && before !== vibe) flips += 1;
  }
  return flips;
};

export const shouldRingVibeBell = ({
  enabled,
  phase,
  isRescanning,
  flips,
  isTTY
}: {
  enabled: boolean;
  phase: AppPhase;
  isRescanning: boolean;
  flips: number;
  isTTY: boolean;
}): boolean =>
  enabled && phase === "ready" && !isRescanning && flips > 0 && isTTY;
