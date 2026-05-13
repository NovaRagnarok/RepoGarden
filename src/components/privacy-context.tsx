import React, { createContext, useCallback, useContext, useMemo, useState } from "react";

import { fakeName as fakeNameImpl, redact as redactImpl, type RedactKind } from "@/lib/privacy";
import type { RepoCreature } from "@/lib/creature";

export interface PrivacyContextValue {
  enabled: boolean;
  toggle: () => void;
  setEnabled: (next: boolean) => void;
  /** Returns the original name when disabled, a deterministic alias when on. */
  maskName: (id: string, originalName: string) => string;
  /** Returns the original text when disabled, redacted when on. */
  maskText: (text: string, kind?: RedactKind) => string;
}

const PrivacyContext = createContext<PrivacyContextValue | null>(null);

export const PrivacyProvider = ({ children }: { children: React.ReactNode }) => {
  const [enabled, setEnabled] = useState(false);
  const toggle = useCallback(() => setEnabled((v) => !v), []);
  const maskName = useCallback(
    (id: string, originalName: string) => (enabled ? fakeNameImpl(id) : originalName),
    [enabled]
  );
  const maskText = useCallback(
    (text: string, kind?: RedactKind) => (enabled ? redactImpl(text, kind) : text),
    [enabled]
  );
  const value = useMemo<PrivacyContextValue>(
    () => ({ enabled, toggle, setEnabled, maskName, maskText }),
    [enabled, toggle, maskName, maskText]
  );
  return <PrivacyContext.Provider value={value}>{children}</PrivacyContext.Provider>;
};

/** Throws if used outside a PrivacyProvider — same contract as useTheme. */
export const usePrivacy = (): PrivacyContextValue => {
  const ctx = useContext(PrivacyContext);
  if (!ctx) throw new Error("usePrivacy must be used inside <PrivacyProvider>");
  return ctx;
};

/** Mask every privacy-sensitive field on a creature. Pure — returns a new
 *  object so consumers can compare by reference. */
export const maskCreature = (creature: RepoCreature): RepoCreature => ({
  ...creature,
  scan: {
    ...creature.scan,
    name: fakeNameImpl(creature.id),
    branch: creature.scan.branch ? redactImpl(creature.scan.branch, "branch") : creature.scan.branch,
    path: creature.scan.path ? redactImpl(creature.scan.path, "path") : creature.scan.path,
    lastCommitSubject: creature.scan.lastCommitSubject
      ? redactImpl(creature.scan.lastCommitSubject, "subject")
      : creature.scan.lastCommitSubject,
    recentCommits: creature.scan.recentCommits?.map((c) => ({
      ...c,
      subject: redactImpl(c.subject, "subject"),
      author: redactImpl(c.author, "author")
    })),
    dirtyChanges: undefined,
    dirtyFiles: undefined
  },
  vibe: {
    ...creature.vibe,
    reason: redactImpl(creature.vibe.vibe, "vibe")
  },
  memory: {
    ...creature.memory,
    noteToFutureSelf: creature.memory.noteToFutureSelf
      ? redactImpl(creature.memory.noteToFutureSelf, "note")
      : creature.memory.noteToFutureSelf,
    currentBlocker: creature.memory.currentBlocker
      ? redactImpl(creature.memory.currentBlocker, "note")
      : creature.memory.currentBlocker
  }
});

/** Returns the input array when privacy is off, or a stable masked copy when
 *  on. Memoized so the same creatures produce the same masked array refs
 *  across renders — important for downstream React.memo / engine memoization. */
export const useMaskedCreatures = (creatures: RepoCreature[]): RepoCreature[] => {
  const { enabled } = usePrivacy();
  return useMemo(() => {
    if (!enabled) return creatures;
    return creatures.map(maskCreature);
  }, [creatures, enabled]);
};
