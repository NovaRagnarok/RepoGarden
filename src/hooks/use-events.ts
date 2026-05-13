/**
 * use-events.ts — React hook that reads JournalEvents from disk. Updates
 * land via fs.watch (~100 ms after a write); a slow safety-net poll keeps
 * things fresh on filesystems where fs.watch can't fire (network mounts,
 * some WSL paths). Filtering is intentionally light here; the Journal
 * screen owns richer UI filters so it can switch scope/range/kind without
 * re-reading from disk.
 */

import { useEffect, useState } from "react";

import {
  readEvents,
  subscribeToEventsFile,
  type JournalEvent,
  type JournalEventKind,
} from "@/lib/events";

export interface UseEventsOptions {
  repoId?: string;
  kinds?: readonly JournalEventKind[];
  limit?: number;
  enabled?: boolean;
}

const payloadsEqual = (left: Record<string, unknown>, right: Record<string, unknown>): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

const eventsEqual = (left: JournalEvent[], right: JournalEvent[]): boolean => {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const leftEvent = left[index];
    const rightEvent = right[index];
    if (
      leftEvent.ts !== rightEvent.ts ||
      leftEvent.repoId !== rightEvent.repoId ||
      leftEvent.repoName !== rightEvent.repoName ||
      leftEvent.kind !== rightEvent.kind ||
      !payloadsEqual(leftEvent.payload, rightEvent.payload)
    ) {
      return false;
    }
  }
  return true;
};

export const useEvents = (opts?: UseEventsOptions): JournalEvent[] => {
  const repoId = opts?.repoId;
  const limit = opts?.limit ?? 500;
  const kinds = opts?.kinds;
  const enabled = opts?.enabled ?? true;
  const kindsKey = kinds?.join("|") ?? "";

  const [events, setEvents] = useState<JournalEvent[]>([]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    const tick = () => {
      const loaded = readEvents({ limit, repoId, kinds });
      if (!cancelled) {
        setEvents((current) => (eventsEqual(current, loaded) ? current : loaded));
      }
    };

    tick();
    // Primary update path: fs.watch on the events file fires within ~100ms
    // of a write. Falls back to a no-op subscription on filesystems that
    // don't support it; the safety-net poll below covers that case.
    const unsubscribe = subscribeToEventsFile(tick);
    // Safety-net poll, much slower than the old 5s tick. Mostly redundant
    // when fs.watch is working; the load comes from caller-driven actions
    // (note save, blocker add, etc.) which already re-render this hook
    // via dep changes anyway.
    const id = setInterval(tick, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
      unsubscribe();
    };
  }, [enabled, repoId, limit, kindsKey]);

  return events;
};
