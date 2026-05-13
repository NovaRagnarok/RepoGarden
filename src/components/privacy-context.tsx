import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import {
  fakeName as fakeNameImpl,
  redact as redactImpl,
  scrambleName,
  type RedactKind
} from "@/lib/privacy";
import { hashString } from "@/lib/sprite";
import type { RepoCreature } from "@/lib/creature";

// How long the name-scramble lasts when the user toggles privacy. Long enough
// to read as a deliberate transition (not a glitch), short enough that the
// new state arrives before the user reaches for the next key.
export const SCRAMBLE_DURATION_MS = 700;
const SCRAMBLE_TICK_MS = 50;

interface PrivacyState {
  enabled: boolean;
  /** Timestamp when the current scramble started, or null when settled. */
  scrambleStartedAt: number | null;
  /** 0..1 progress of the current scramble. Meaningful only when
   *  scrambleStartedAt !== null. */
  scrambleProgress: number;
  /** Increments each interval tick so consumers re-render with fresh random
   *  letters during the chaotic phase. */
  scrambleTick: number;
}

export interface PrivacyContextValue {
  /** The user's most recent intent. Commits immediately on toggle even though
   *  the visual scramble takes ~700 ms to complete. */
  enabled: boolean;
  toggle: () => void;
  setEnabled: (next: boolean) => void;
  /** True while the name-scramble animation is mid-flight. */
  scrambling: boolean;
  maskName: (id: string, originalName: string) => string;
  maskText: (text: string, kind?: RedactKind) => string;
}

interface InternalContextValue extends PrivacyContextValue {
  _scrambleProgress: number;
  _scrambleTick: number;
  _scrambling: boolean;
}

const PrivacyContext = createContext<InternalContextValue | null>(null);

export const PrivacyProvider = ({ children }: { children: React.ReactNode }) => {
  const [state, setState] = useState<PrivacyState>({
    enabled: false,
    scrambleStartedAt: null,
    scrambleProgress: 0,
    scrambleTick: 0
  });

  // Drive the scramble animation. Each toggle bumps scrambleStartedAt, which
  // restarts this effect — interrupting an in-flight animation immediately
  // (the cleanup clears the old interval).
  useEffect(() => {
    if (state.scrambleStartedAt === null) return;
    const startedAt = state.scrambleStartedAt;
    const id = setInterval(() => {
      const elapsed = Date.now() - startedAt;
      if (elapsed >= SCRAMBLE_DURATION_MS) {
        setState((s) =>
          s.scrambleStartedAt === startedAt
            ? { ...s, scrambleStartedAt: null, scrambleProgress: 1 }
            : s
        );
        clearInterval(id);
        return;
      }
      setState((s) =>
        s.scrambleStartedAt === startedAt
          ? { ...s, scrambleProgress: elapsed / SCRAMBLE_DURATION_MS, scrambleTick: s.scrambleTick + 1 }
          : s
      );
    }, SCRAMBLE_TICK_MS);
    return () => clearInterval(id);
  }, [state.scrambleStartedAt]);

  const startScramble = useCallback(() => ({
    scrambleStartedAt: Date.now(),
    scrambleProgress: 0,
    scrambleTick: 0
  }), []);

  const toggle = useCallback(() => {
    setState((s) => ({ enabled: !s.enabled, ...startScramble() }));
  }, [startScramble]);

  const setEnabled = useCallback((next: boolean) => {
    setState((s) => (s.enabled === next ? s : { enabled: next, ...startScramble() }));
  }, [startScramble]);

  const scrambling = state.scrambleStartedAt !== null;

  const maskName = useCallback(
    (id: string, originalName: string) => {
      const target = state.enabled ? fakeNameImpl(id) : originalName;
      if (!scrambling) return target;
      // Vary seed across creatures (so they churn out of sync) and across
      // ticks (so the random letters keep changing). Dividing tick by 2
      // slows the churn slightly — at the raw 50 ms tick it reads as noise.
      const seed = hashString(`scramble:${id}:${Math.floor(state.scrambleTick / 2)}`);
      return scrambleName(target, state.scrambleProgress, seed);
    },
    [state.enabled, scrambling, state.scrambleTick, state.scrambleProgress]
  );

  const maskText = useCallback(
    (text: string, kind?: RedactKind) => (state.enabled ? redactImpl(text, kind) : text),
    [state.enabled]
  );

  const value = useMemo<InternalContextValue>(
    () => ({
      enabled: state.enabled,
      toggle,
      setEnabled,
      scrambling,
      maskName,
      maskText,
      _scrambleProgress: state.scrambleProgress,
      _scrambleTick: state.scrambleTick,
      _scrambling: scrambling
    }),
    [state.enabled, toggle, setEnabled, scrambling, maskName, maskText, state.scrambleProgress, state.scrambleTick]
  );
  return <PrivacyContext.Provider value={value}>{children}</PrivacyContext.Provider>;
};

/** Throws if used outside a PrivacyProvider — same contract as useTheme. */
export const usePrivacy = (): PrivacyContextValue => {
  const ctx = useContext(PrivacyContext);
  if (!ctx) throw new Error("usePrivacy must be used inside <PrivacyProvider>");
  return ctx;
};

const useInternalPrivacy = (): InternalContextValue => {
  const ctx = useContext(PrivacyContext);
  if (!ctx) throw new Error("usePrivacy must be used inside <PrivacyProvider>");
  return ctx;
};

interface MaskOpts {
  enabled: boolean;
  scramble?: { progress: number; tick: number };
}

/** Mask every privacy-sensitive field on a creature. Pure given its opts —
 *  the calling hook supplies fresh opts each tick during scramble so output
 *  changes per frame. */
export const maskCreature = (creature: RepoCreature, opts: MaskOpts): RepoCreature => {
  const targetName = opts.enabled ? fakeNameImpl(creature.id) : creature.scan.name;
  const displayName = opts.scramble
    ? scrambleName(
        targetName,
        opts.scramble.progress,
        hashString(`scramble:${creature.id}:${Math.floor(opts.scramble.tick / 2)}`)
      )
    : targetName;

  // Disabled + no scramble: pass-through.
  if (!opts.enabled && !opts.scramble) return creature;

  // Disabled mid-scramble (transitioning OFF): keep every real field but
  // show the animated name on its way back to the real value.
  if (!opts.enabled) {
    return {
      ...creature,
      scan: { ...creature.scan, name: displayName }
    };
  }

  // Enabled (with or without scramble): full mask.
  return {
    ...creature,
    scan: {
      ...creature.scan,
      name: displayName,
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
  };
};

/** Returns the input array when privacy is off and not scrambling, or a
 *  fresh masked copy otherwise. Re-runs each tick during the scramble so
 *  consumers naturally see the chaotic phase. */
export const useMaskedCreatures = (creatures: RepoCreature[]): RepoCreature[] => {
  const { enabled, _scrambling, _scrambleProgress, _scrambleTick } = useInternalPrivacy();
  return useMemo(() => {
    if (!enabled && !_scrambling) return creatures;
    const opts: MaskOpts = {
      enabled,
      scramble: _scrambling ? { progress: _scrambleProgress, tick: _scrambleTick } : undefined
    };
    return creatures.map((c) => maskCreature(c, opts));
  }, [creatures, enabled, _scrambling, _scrambleProgress, _scrambleTick]);
};
