import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { useMotion } from "@/components/ui/theme-provider";

import {
  fakeName as fakeNameImpl,
  redact as redactImpl,
  scrambleName,
  type RedactKind
} from "@/lib/privacy";
import {
  demoNameFor,
  demoBranchFor,
  demoSubjectFor,
  demoAuthorFor,
  setActiveDemoIds,
  clearActiveDemoIds
} from "@/lib/demo-roster";
import { hashString } from "@/lib/sprite";
import type { RepoCreature } from "@/lib/creature";

// How long the name-scramble lasts when mode flips. Long enough to read as a
// deliberate transition (not a glitch), short enough that the new state
// arrives before the user reaches for the next key.
export const SCRAMBLE_DURATION_MS = 700;
const SCRAMBLE_TICK_MS = 50;

export type PrivacyMode = "off" | "mask" | "demo";

interface PrivacyState {
  mode: PrivacyMode;
  /** Timestamp when the current scramble started, or null when settled. */
  scrambleStartedAt: number | null;
  scrambleProgress: number;
  scrambleTick: number;
}

export interface PrivacyContextValue {
  mode: PrivacyMode;
  /** Convenience — true when mode !== "off". */
  enabled: boolean;
  /** Toggles off ↔ mask. The user-facing `m` hotkey calls this. Demo mode
   *  has a separate trigger and is exited via setMode("off"). */
  toggle: () => void;
  setMode: (next: PrivacyMode) => void;
  /** True while the name-scramble animation is mid-flight. */
  scrambling: boolean;
  maskName: (id: string, originalName: string) => string;
  maskText: (text: string, kind?: RedactKind) => string;
  /** Returns the original path when mode is off, redacted when masking,
   *  or a demo path `~/work/<demoName>` when in demo mode. The id arg
   *  lets demo mode pick a stable demo name. */
  maskPath: (originalPath: string, id: string) => string;
}

interface InternalContextValue extends PrivacyContextValue {
  _scrambleProgress: number;
  _scrambleTick: number;
  _scrambling: boolean;
}

const PrivacyContext = createContext<InternalContextValue | null>(null);

export const PrivacyProvider = ({
  children,
  initialMode = "off"
}: {
  children: React.ReactNode;
  initialMode?: PrivacyMode;
}) => {
  const { reduced } = useMotion();
  const [state, setState] = useState<PrivacyState>({
    mode: initialMode,
    scrambleStartedAt: null,
    scrambleProgress: 0,
    scrambleTick: 0
  });

  // Drive the scramble animation. Each mode change bumps scrambleStartedAt
  // which restarts this effect — interrupting an in-flight animation
  // immediately (the cleanup clears the old interval).
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

  // Reduced motion: skip the scramble animation entirely and land on the
  // settled state immediately. Same destination, no in-between chaos frames.
  const startScramble = useCallback(() => (
    reduced
      ? { scrambleStartedAt: null, scrambleProgress: 1, scrambleTick: 0 }
      : { scrambleStartedAt: Date.now(), scrambleProgress: 0, scrambleTick: 0 }
  ), [reduced]);

  const setMode = useCallback((next: PrivacyMode) => {
    setState((s) => (s.mode === next ? s : { mode: next, ...startScramble() }));
  }, [startScramble]);

  // Toggle is the user-facing m-hotkey path. Cycles off ↔ mask, leaving demo
  // mode reachable only through the hidden triggers.
  const toggle = useCallback(() => {
    setState((s) => ({
      mode: s.mode === "off" ? "mask" : "off",
      ...startScramble()
    }));
  }, [startScramble]);

  const scrambling = state.scrambleStartedAt !== null;
  const enabled = state.mode !== "off";

  const targetNameFor = (id: string, originalName: string): string => {
    switch (state.mode) {
      case "mask":
        return fakeNameImpl(id);
      case "demo":
        return demoNameFor(id);
      default:
        return originalName;
    }
  };

  const maskName = useCallback(
    (id: string, originalName: string) => {
      const target = targetNameFor(id, originalName);
      if (!scrambling) return target;
      const seed = hashString(`scramble:${id}:${Math.floor(state.scrambleTick / 2)}`);
      return scrambleName(target, state.scrambleProgress, seed);
    },
    [state.mode, scrambling, state.scrambleTick, state.scrambleProgress]
  );

  const maskText = useCallback(
    (text: string, kind?: RedactKind) => {
      if (state.mode === "off") return text;
      if (state.mode === "demo") {
        // Demo mode renders plausible content via maskCreature; this helper
        // is only invoked by display sites that have a raw text string with
        // no creature handle. Best we can do is leave it real (it's already
        // demo-friendly when the demoified creature flows through).
        return text;
      }
      return redactImpl(text, kind);
    },
    [state.mode]
  );

  const maskPath = useCallback(
    (originalPath: string, id: string) => {
      if (state.mode === "off") return originalPath;
      if (state.mode === "demo") return `~/work/${demoNameFor(id)}`;
      return redactImpl(originalPath, "path");
    },
    [state.mode]
  );

  const value = useMemo<InternalContextValue>(
    () => ({
      mode: state.mode,
      enabled,
      toggle,
      setMode,
      scrambling,
      maskName,
      maskText,
      maskPath,
      _scrambleProgress: state.scrambleProgress,
      _scrambleTick: state.scrambleTick,
      _scrambling: scrambling
    }),
    [
      state.mode,
      enabled,
      toggle,
      setMode,
      scrambling,
      maskName,
      maskText,
      maskPath,
      state.scrambleProgress,
      state.scrambleTick
    ]
  );
  return <PrivacyContext.Provider value={value}>{children}</PrivacyContext.Provider>;
};

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
  mode: PrivacyMode;
  scramble?: { progress: number; tick: number };
}

/** Mask every privacy-sensitive field on a creature. Pure given its opts —
 *  the calling hook supplies fresh opts each tick during scramble so output
 *  changes per frame. */
export const maskCreature = (creature: RepoCreature, opts: MaskOpts): RepoCreature => {
  const targetName =
    opts.mode === "mask"
      ? fakeNameImpl(creature.id)
      : opts.mode === "demo"
        ? demoNameFor(creature.id)
        : creature.scan.name;
  const displayName = opts.scramble
    ? scrambleName(
        targetName,
        opts.scramble.progress,
        hashString(`scramble:${creature.id}:${Math.floor(opts.scramble.tick / 2)}`)
      )
    : targetName;

  // Off + no scramble: pass-through.
  if (opts.mode === "off" && !opts.scramble) return creature;

  // Off mid-scramble (transitioning back to off): keep real fields, animate
  // the name back to its real value.
  if (opts.mode === "off") {
    return { ...creature, scan: { ...creature.scan, name: displayName } };
  }

  // Demo mode: swap names + branches + commit subjects + authors with plausible
  // demo content keyed off the creature id. scan.path stays real for sprite
  // identity (engine uses path || id); display sites that show the path call
  // maskPath separately.
  if (opts.mode === "demo") {
    return {
      ...creature,
      scan: {
        ...creature.scan,
        name: displayName,
        branch: demoBranchFor(creature.id),
        lastCommitSubject: demoSubjectFor(creature.id),
        recentCommits: creature.scan.recentCommits?.map((c, idx) => ({
          ...c,
          subject: demoSubjectFor(`${creature.id}:${idx}`),
          author: demoAuthorFor(`${creature.id}:${idx}`)
        })),
        dirtyChanges: undefined,
        dirtyFiles: undefined
      },
      memory: {
        ...creature.memory,
        // Demo mode wipes notes/blockers since they're highly likely to be
        // private. We deliberately don't generate plausible fake notes —
        // that'd risk a screenshot looking like advice the user wrote.
        noteToFutureSelf: undefined,
        currentBlocker: undefined
      }
    };
  }

  // Mask mode: full redaction with the same scan.path-preservation rationale
  // as before. scan.path stays unmasked because the garden engine derives
  // sprite identity from creature.scan.path || creature.id — redacting it
  // would collapse every masked creature to the same shape and palette.
  return {
    ...creature,
    scan: {
      ...creature.scan,
      name: displayName,
      branch: creature.scan.branch ? redactImpl(creature.scan.branch, "branch") : creature.scan.branch,
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
 *  consumers naturally see the chaotic phase.
 *
 *  Side effect: when mode === "demo", registers the active id set with the
 *  demo-roster module so per-id callers (maskName, maskPath, maskCreature)
 *  resolve to the same without-replacement assignment — fixing #7. This
 *  has to run during render (not in useEffect) so the first paint with a
 *  populated creature list already uses the unique-name map instead of
 *  falling back to the hash-modulo path. `setActiveDemoIds` is
 *  fingerprinted internally so the call is cheap on the no-op path. */
export const useMaskedCreatures = (creatures: RepoCreature[]): RepoCreature[] => {
  const { mode, _scrambling, _scrambleProgress, _scrambleTick } = useInternalPrivacy();
  useEffect(() => () => clearActiveDemoIds(), []);
  return useMemo(() => {
    if (mode === "demo") {
      setActiveDemoIds(creatures.map((c) => c.id));
    } else {
      clearActiveDemoIds();
    }
    if (mode === "off" && !_scrambling) return creatures;
    const opts: MaskOpts = {
      mode,
      scramble: _scrambling ? { progress: _scrambleProgress, tick: _scrambleTick } : undefined
    };
    return creatures.map((c) => maskCreature(c, opts));
  }, [creatures, mode, _scrambling, _scrambleProgress, _scrambleTick]);
};
