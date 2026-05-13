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
 */
export const useUsage = (intervalMs = 120_000): ProviderUsage[] => {
  const [data, setData] = useState<ProviderUsage[]>([]);
  useEffect(() => {
    if (isUsageFeatureDisabled()) {
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
          if (!cancelled) setData(next);
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
  }, [intervalMs]);
  return data;
};
