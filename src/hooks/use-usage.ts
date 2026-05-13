import { useEffect, useState } from "react";

import {
  isUsageFeatureDisabled,
  loadAllUsage,
  type ProviderUsage,
} from "@/lib/usage";

/**
 * Poll the live Claude + Codex plan-utilization endpoints. The endpoints
 * rate-limit aggressively (especially Anthropic's), so we deliberately poll
 * every 120s — the values move on the scale of minutes, not frames.
 *
 * Providers whose latest status is "error" or "auth" are silently dropped
 * before reaching consumers. The footer row is ambient context, not a
 * diagnostics surface — a stranded "auth" badge for codex on a Claude-only
 * setup just makes the bar noisier than it is useful. "stale" entries still
 * surface (cached data + softened badge) since they carry real information.
 */
export interface UseUsageOptions {
  /** Caller-supplied disable flag (typically the persistent settings
   *  toggle). Combined with the env-driven `isUsageFeatureDisabled()` —
   *  either one suppresses the network call. */
  disabled?: boolean;
}

export const useUsage = (
  intervalMs = 120_000,
  opts: UseUsageOptions = {}
): ProviderUsage[] => {
  const [data, setData] = useState<ProviderUsage[]>([]);
  const { disabled = false } = opts;
  useEffect(() => {
    if (disabled || isUsageFeatureDisabled()) {
      setData([]);
      return;
    }

    let cancelled = false;
    const tick = () => {
      // Defer to next tick so the first paint isn't blocked by credential
      // resolution / network I/O.
      setTimeout(async () => {
        try {
          const next = await loadAllUsage();
          if (!cancelled) {
            setData(next.filter((u) => u.status !== "error" && u.status !== "auth"));
          }
        } catch {
          // loadAllUsage already converts per-provider failure into a status
          // entry; any throw here is truly exceptional — hide the bar.
        }
      }, 0);
    };
    tick();
    const id = setInterval(tick, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [intervalMs, disabled]);
  return data;
};
