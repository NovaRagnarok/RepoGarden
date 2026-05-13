#!/usr/bin/env node
import { render, useApp } from "ink";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { PassThrough } from "stream";

import {
  ThemeProvider,
  isReducedMotion,
  type Theme
} from "@/components/ui/theme-provider";
import { DISABLE_MOUSE, ENABLE_MOUSE, parseStdinChunk } from "@/lib/mouse";
import {
  DISABLE_FOCUS,
  ENABLE_FOCUS,
  parseFocusChunk,
  subscribeFocus
} from "@/lib/focus";
import { PrivacyProvider } from "@/components/privacy-context";
import { ToastProvider, useToasts } from "@/components/ui/toast-host";
import { BootScreen } from "@/screens/BootScreen";
import { OnboardingScreen } from "@/screens/OnboardingScreen";
import { ReadyShell, type ReadyView } from "@/screens/ReadyShell";
import { SettingsScreen } from "@/screens/SettingsScreen";
import { WorkbenchScreen } from "@/screens/WorkbenchScreen";
import { HelpOverlay } from "@/screens/HelpOverlay";
import { openInFileBrowser } from "@/lib/system";
import { defaultThemeId, themeById, themeCatalogue } from "@/themes";
import { loadConfig, updateConfig } from "@/lib/config";
import { scanRootsProgressive, type ScannedRepo, type RootProgress } from "@/lib/scanner";
import { buildCreature, enrichScans, refreshCreaturesLight, type RepoCreature } from "@/lib/creature";
import { loadMemory, saveMemory, type ProjectMemory } from "@/lib/memory";
import { CLI_HELP_TEXT, hasHelpFlag } from "@/lib/cli-help";
import { checkForUpdate, readCurrentVersion } from "@/lib/update-check";

type Phase = "booting" | "onboarding" | "ready" | "settings" | "workbench" | "help" | "edit-roots";

const BOOT_SCAN_DELAY_MS = 400;
const MIN_BOOT_PRESENTATION_MS = 900;

interface ScanStatus {
  kind: "idle" | "scanning" | "error" | "ok";
  message: string;
}

const parseRoots = (raw: string): string[] =>
  raw
    .split(/[,\n]/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

interface AppProps {
  initialThemeId: string;
  initialRoots: string[];
  initialView: ReadyView;
  initialReducedMotion: boolean;
  onThemeChange: (theme: Theme) => void;
  onReducedMotionChange: (reduced: boolean) => void;
}

const App = ({
  initialThemeId,
  initialRoots,
  initialView,
  initialReducedMotion,
  onThemeChange,
  onReducedMotionChange
}: AppProps) => {
  const { exit } = useApp();
  const { push: pushToast } = useToasts();
  const [phase, setPhase] = useState<Phase>("booting");
  const [scanStatus, setScanStatus] = useState<ScanStatus | undefined>();
  const [themeId, setThemeId] = useState<string>(initialThemeId);
  const [roots, setRoots] = useState<string[]>(initialRoots);
  const [creatures, setCreatures] = useState<RepoCreature[]>([]);
  const [isRescanning, setIsRescanning] = useState(false);
  const [rescanError, setRescanError] = useState<string | undefined>();
  const [activeWorkbench, setActiveWorkbench] = useState<RepoCreature | null>(null);
  const [readyView, setReadyView] = useState<ReadyView>(initialView);
  const [reducedMotion, setReducedMotion] = useState<boolean>(initialReducedMotion);
  const [scanProgress, setScanProgress] = useState<{ done: number; total: number } | undefined>();
  const [scanProgressByRoot, setScanProgressByRoot] = useState<RootProgress[] | undefined>();

  const runScan = useCallback(
    async (rootsToScan: string[]): Promise<{ ok: boolean; count: number; message: string }> => {
      setIsRescanning(true);
      setRescanError(undefined);
      setScanProgress({ done: 0, total: 0 });
      setScanProgressByRoot(undefined);
      const collected: ScannedRepo[] = [];
      try {
        const result = await scanRootsProgressive(rootsToScan, {
          onRepo: (repo, index, total) => {
            collected.push(repo);
            setScanProgress({ done: index + 1, total });
            // Stream creatures as they're discovered so the garden fills in
            // live. Skip the snapshot reconcile here — see EnrichScansOptions:
            // reconciling a partial list trims the snapshot and makes the next
            // partial batch emit phantom repo-added events.
            setCreatures(enrichScans([...collected], { reconcile: false }));
          },
          onRootsResolved: (rootsProgress) => {
            setScanProgressByRoot(rootsProgress);
          },
          onRoot: (rootProgress) => {
            setScanProgressByRoot((current) => {
              if (!current) return [rootProgress];
              return current.map((entry) =>
                entry.root === rootProgress.root ? rootProgress : entry
              );
            });
          }
        }, 4);
        setIsRescanning(false);
        setScanProgress(undefined);
        setScanProgressByRoot(undefined);
        if (result.errors.length > 0) {
          const joined = result.errors.map((entry) => `${entry.root}: ${entry.message}`).join(" · ");
          setRescanError(joined);
          pushToast(`scan errors · ${joined}`, "warning");
        }
        // If any configured root errored (unmounted drive, missing folder),
        // treat the scan as partial: preserve snapshot entries for repos
        // from the failed root so they don't look "new" next clean scan.
        const finalCreatures = enrichScans(result.repos, {
          preserveMissing: result.errors.length > 0,
        });
        setCreatures(finalCreatures);
        const message =
          finalCreatures.length === 0
            ? "no git repos found in those folders."
            : `found ${finalCreatures.length} creature${finalCreatures.length === 1 ? "" : "s"}.`;
        pushToast(message, finalCreatures.length === 0 ? "info" : "success");
        return { ok: true, count: finalCreatures.length, message };
      } catch (error) {
        setIsRescanning(false);
        setScanProgress(undefined);
        setScanProgressByRoot(undefined);
        const message = error instanceof Error ? error.message : "scan failed.";
        setRescanError(message);
        pushToast(message, "error");
        return { ok: false, count: 0, message };
      }
    },
    [pushToast]
  );

  // Fire-and-forget update check. Runs once per session, after the boot
  // sequence settles. Cached for 24h under ~/.repogarden/update-check.json,
  // opt out with REPOGARDEN_NO_UPDATE_CHECK=1 (and auto-skipped in demo
  // mode + CI). The toast is informational — never blocks anything.
  const didCheckUpdate = useRef(false);
  useEffect(() => {
    if (didCheckUpdate.current) return;
    if (phase === "booting" || phase === "onboarding" || phase === "edit-roots") {
      return;
    }
    didCheckUpdate.current = true;
    void checkForUpdate({ current: readCurrentVersion() })
      .then((result) => {
        if (!result || !result.isOutdated) return;
        pushToast(
          `update available · v${result.latest} (npm i -g @outsideheaven/repogarden)`,
          "info",
          6000
        );
      })
      .catch(() => {
        // checkForUpdate never throws, but belt-and-braces — a toast that
        // never appears is fine; a crash on launch is not.
      });
  }, [phase, pushToast]);

  // Light background refresh: every 30s, probe each repo with a single
  // `git status --porcelain=v2 --branch` to pick up push/commit/dirty
  // state without the cost of a full rescan. When HEAD moved on a repo,
  // refreshCreaturesLight runs a one-repo `inspectRepo` + full enrich so
  // the journal events store still sees the new commit. Silent — no
  // toasts, no spinners, no dither. Paused during an active full rescan
  // so the two passes don't race over the same git state. The boot
  // sequence's own initial scan starts the loop; an empty creature list
  // is a no-op anyway.
  useEffect(() => {
    if (phase === "booting" || phase === "onboarding" || phase === "edit-roots") {
      return;
    }
    if (isRescanning) return;
    const id = setInterval(() => {
      setCreatures((current) => {
        if (current.length === 0) return current;
        const next = refreshCreaturesLight(current);
        return next === current ? current : next;
      });
    }, 30_000);
    return () => clearInterval(id);
  }, [phase, isRescanning]);

  // Boot sequence: if we already have roots, scan them; otherwise show onboarding.
  useEffect(() => {
    let cancelled = false;
    const bootStartedAt = performance.now();
    const holdBootIntro = async () => {
      const remaining = MIN_BOOT_PRESENTATION_MS - (performance.now() - bootStartedAt);
      if (remaining > 0) {
        await new Promise((resolve) => setTimeout(resolve, remaining));
      }
    };
    const timer = setTimeout(async () => {
      if (cancelled) return;
      if (roots.length === 0) {
        await holdBootIntro();
        if (cancelled) return;
        setPhase("onboarding");
        return;
      }
      const result = await runScan(roots);
      if (cancelled) return;
      await holdBootIntro();
      if (cancelled) return;
      if (result.ok && result.count > 0) {
        setPhase("ready");
      } else if (result.ok) {
        setPhase("onboarding");
        setScanStatus({ kind: "error", message: result.message });
      } else {
        setPhase("onboarding");
        setScanStatus({ kind: "error", message: result.message });
      }
    }, BOOT_SCAN_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  const handleScan = async (raw: string) => {
    const nextRoots = parseRoots(raw);
    if (nextRoots.length === 0) {
      setScanStatus({ kind: "error", message: "give at least one folder path." });
      return;
    }
    setScanStatus({ kind: "scanning", message: `scanning ${nextRoots.join(", ")}` });
    setRoots(nextRoots);
    updateConfig({ scanRoots: nextRoots });
    const result = await runScan(nextRoots);
    setScanStatus({ kind: result.ok ? "ok" : "error", message: result.message });
    if (result.ok && result.count > 0) {
      setPhase("ready");
    }
  };

  const handlePickTheme = (id: string) => {
    const choice = themeById(id);
    if (!choice) return;
    setThemeId(id);
    onThemeChange(choice.theme);
    updateConfig({ themeId: id });
    setPhase("ready");
  };

  const handleToggleReducedMotion = () => {
    const next = !reducedMotion;
    setReducedMotion(next);
    onReducedMotionChange(next);
    updateConfig({ reducedMotion: next });
    pushToast(`reduced motion · ${next ? "on" : "off"}`, "info");
  };

  const handleRescan = async () => {
    if (roots.length === 0) {
      setPhase("onboarding");
      return;
    }
    await runScan(roots);
  };

  const handleSaveMemory = (creature: RepoCreature, patch: ProjectMemory) => {
    // Re-read from disk before merging: the workbench writes directly to
    // memory (currentBlocker mirrored from a "blocker" note), and the
    // creature object in state predates that write. Merging against the
    // stale in-memory copy would silently revert those writes.
    const fresh = loadMemory(creature.id);
    const nextMemory: ProjectMemory = { ...fresh, ...patch, lastVisitedAt: new Date().toISOString() };
    saveMemory(creature.id, nextMemory);
    setCreatures((current) =>
      current
        .map((entry) => (entry.id === creature.id ? buildCreature(entry.scan) : entry))
        .sort((left, right) => {
          // Match enrichScans' canonical order: happy first, sleepy last.
          const order = { happy: 0, noisy: 1, blocked: 2, sleepy: 3 } as const;
          const diff = order[left.vibe.vibe] - order[right.vibe.vibe];
          return diff !== 0 ? diff : left.scan.name.localeCompare(right.scan.name);
        })
    );
    // An empty patch is a visit-stamp from the workbench (notes live in their
    // own files now), so don't bother the user with a "saved" toast.
    const hasFields = Object.keys(patch).length > 0;
    if (hasFields) {
      pushToast(`saved memory · ${creature.scan.name}`, "success");
    }
  };

  const handleToggleHidden = (creature: RepoCreature) => {
    const willHide = !creature.memory.hidden;
    const nextMemory: ProjectMemory = { ...creature.memory, hidden: willHide };
    saveMemory(creature.id, nextMemory);
    setCreatures((current) =>
      current.map((entry) => (entry.id === creature.id ? buildCreature(entry.scan) : entry))
    );
    pushToast(`${willHide ? "hid" : "unhid"} ${creature.scan.name}`, "info");
  };

  const handleCreaturePlacementChange = (
    changes: Array<{ creature: RepoCreature; offset: { offsetX: number; offsetY: number } }>
  ) => {
    for (const { creature, offset } of changes) {
      const fresh = loadMemory(creature.id);
      saveMemory(creature.id, {
        ...fresh,
        gardenPlacement: offset
      });
    }
    const changedIds = new Set(changes.map((change) => change.creature.id));
    setCreatures((current) =>
      current.map((entry) => (changedIds.has(entry.id) ? buildCreature(entry.scan) : entry))
    );
  };

  if (phase === "booting") {
    return (
      <BootScreen
        message={isRescanning ? "scanning local repos…" : undefined}
        scanProgress={scanProgress}
        scanProgressByRoot={scanProgressByRoot}
      />
    );
  }

  if (phase === "onboarding") {
    const seedPath = roots.length > 0 ? roots.join("\n") : "~/repos";
    return (
      <OnboardingScreen
        initialPath={seedPath}
        onScan={handleScan}
        scanStatus={scanStatus}
      />
    );
  }

  if (phase === "settings") {
    return (
      <SettingsScreen
        currentThemeId={themeId}
        reducedMotion={reducedMotion}
        onToggleReducedMotion={handleToggleReducedMotion}
        onPickTheme={handlePickTheme}
        onClose={() => setPhase("ready")}
      />
    );
  }

  if (phase === "help") {
    return <HelpOverlay onClose={() => setPhase("ready")} />;
  }

  if (phase === "edit-roots") {
    return (
      <OnboardingScreen
        editing
        initialPath={roots.join(", ")}
        onScan={handleScan}
        onCancel={() => setPhase("ready")}
        scanStatus={scanStatus}
      />
    );
  }

  if (phase === "workbench" && activeWorkbench) {
    return (
      <WorkbenchScreen
        creature={activeWorkbench}
        onClose={() => {
          // The workbench owns note persistence now; we only stamp
          // lastVisitedAt so the creature's vibe and sort order reflect
          // the visit. An empty patch makes handleSaveMemory a touch.
          handleSaveMemory(activeWorkbench, {});
          setPhase("ready");
          setActiveWorkbench(null);
        }}
      />
    );
  }

  return (
    <ReadyShell
      creatures={creatures}
      rootsLabel={roots.join(" · ")}
      view={readyView}
      onSetView={(next) => {
        setReadyView(next);
        updateConfig({ view: next });
      }}
      onOpenSettings={() => setPhase("settings")}
      onOpenWorkbench={(creature) => {
        setActiveWorkbench(creature);
        setPhase("workbench");
      }}
      onOpenFolder={(creature) => {
        void (async () => {
          const opened = await openInFileBrowser(creature.scan.path);
          if (opened) {
            pushToast(`opened ${creature.scan.name} in file browser`, "info");
            return;
          }
          pushToast(`couldn't open ${creature.scan.name} in file browser`, "error");
        })();
      }}
      onCreaturePlacementChange={handleCreaturePlacementChange}
      onToggleHidden={handleToggleHidden}
      onOpenHelp={() => setPhase("help")}
      onEditRoots={() => setPhase("edit-roots")}
      onRescan={() => void handleRescan()}
      onQuit={() => exit()}
      isRescanning={isRescanning}
      rescanError={rescanError}
      scanProgress={scanProgress}
      scanProgressByRoot={scanProgressByRoot}
    />
  );
};

const Root = () => {
  const config = loadConfig();
  // No light-terminal auto-routing: see themes/index.ts — we ship dark themes
  // only, since Ink can't repaint the terminal's own background.
  const initialChoice =
    themeById(config.themeId) ??
    themeById(defaultThemeId) ??
    themeCatalogue[0];
  const [activeTheme, setActiveTheme] = useState<Theme>(initialChoice.theme);
  // NO_MOTION / CI seed the initial value when no saved preference is on;
  // the settings toggle then writes user intent to config and wins per-session.
  const [reducedMotion, setReducedMotion] = useState<boolean>(
    config.reducedMotion || isReducedMotion()
  );

  // Demo mode for headless screenshot capture. Setting REPOGARDEN_DEMO=1
  // boots straight into demo mode so the captured frame already shows
  // believable repo names + commit subjects from the demo roster. The
  // typed `demo` sequence in garden view is the interactive equivalent.
  const demoBoot = process.env.REPOGARDEN_DEMO === "1" ? "demo" : "off";

  return (
    <ThemeProvider theme={activeTheme} reducedMotion={reducedMotion}>
      <PrivacyProvider initialMode={demoBoot}>
        <ToastProvider>
          <App
            initialThemeId={initialChoice.id}
            initialRoots={config.scanRoots}
            initialView={config.view}
            initialReducedMotion={reducedMotion}
            onThemeChange={setActiveTheme}
            onReducedMotionChange={setReducedMotion}
          />
        </ToastProvider>
      </PrivacyProvider>
    </ThemeProvider>
  );
};

// Switch to the alternate screen buffer + hide cursor so the garden gets a
// dedicated, scrollback-free canvas. Most terminals (incl. Windows Terminal /
// WSL) repaint the alt-screen far more smoothly, which kills the flicker on
// big repaints when focus moves around the garden.
const ENTER_ALT = "\x1b[?1049h\x1b[?25l\x1b[H";
const LEAVE_ALT = "\x1b[?25h\x1b[?1049l";

// Synchronized Update Mode (DEC 2026): bracket every stdout write so the
// terminal buffers the whole frame and presents it atomically instead of
// processing the byte stream incrementally. Ink's log-update repaints by
// writing `eraseLines(N) + output` in a single chunk — on slow terminals
// (WSL/Windows Terminal especially) the eraseLines half lands visibly before
// the new output does, which is what reads as flicker on Tab and other
// whole-frame re-renders. Terminals that don't recognize 2026 just ignore
// the CSI sequences, so wrapping is safe to apply unconditionally.
const BSU = "\x1b[?2026h";
const ESU = "\x1b[?2026l";

if (hasHelpFlag(process.argv.slice(2))) {
  console.log(CLI_HELP_TEXT);
  process.exit(0);
}

if (process.stdout.isTTY) {
  const originalWrite = process.stdout.write.bind(process.stdout);
  // `write` has two overloads (with/without encoding); both forward callbacks
  // as the last arg, so we can pass through ...args after prepending/appending
  // our brackets to the chunk.
  process.stdout.write = ((chunk: string | Uint8Array, ...args: unknown[]) => {
    const body = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (originalWrite as any)(BSU + body + ESU, ...args);
  }) as typeof process.stdout.write;

  process.stdout.write(ENTER_ALT + ENABLE_MOUSE + ENABLE_FOCUS);
  const restore = () => {
    process.stdout.write(DISABLE_FOCUS + DISABLE_MOUSE + LEAVE_ALT);
  };

  // macOS-specific recovery: when the terminal goes to another Space (or
  // otherwise loses focus) the kernel can suspend our process mid-write.
  // If suspension lands between a BSU and its ESU (the DEC 2026 brackets
  // around every stdout write above), the terminal stays in
  // "buffering, not painting" mode forever. On focus-in we re-emit ESU
  // unconditionally to release any stuck SUM state. The originalWrite
  // bypasses our own BSU/ESU wrapper so this can't itself get stuck.
  // See: github.com/NovaRagnarok/RepoGarden/issues/8
  subscribeFocus((kind) => {
    if (kind === "focus-in") {
      originalWrite(ESU);
    }
  });
  process.on("exit", restore);
  process.on("SIGINT", () => {
    restore();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    restore();
    process.exit(0);
  });
  process.on("uncaughtException", (error) => {
    restore();
    console.error(error);
    process.exit(1);
  });
}

// Wrap stdin so we can intercept SGR mouse sequences before Ink sees them.
// Ink reads keystrokes off `stdin.on('data')`, and mouse sequences (which
// start with `\x1b[<…M`) would otherwise register as escape + a stream of
// printable chars — exiting filter mode and inserting `<0;42;7M` into queries.
// Real raw-mode/TTY plumbing stays on the actual process.stdin; the wrapped
// PassThrough only carries the cleaned byte stream.
const buildWrappedStdin = (): NodeJS.ReadStream => {
  const wrapped = new PassThrough() as unknown as NodeJS.ReadStream & {
    setRawMode?: (mode: boolean) => NodeJS.ReadStream;
    isTTY?: boolean;
    ref?: () => NodeJS.ReadStream;
    unref?: () => NodeJS.ReadStream;
  };
  wrapped.setRawMode = (mode: boolean) => {
    if (typeof process.stdin.setRawMode === "function") {
      process.stdin.setRawMode(mode);
    }
    return wrapped;
  };
  wrapped.isTTY = process.stdin.isTTY;
  // Ink calls ref/unref to keep the event loop alive while listening for input.
  // PassThrough doesn't provide those (they're net.Socket/TTY methods), so
  // forward to the real stdin.
  wrapped.ref = () => {
    if (typeof process.stdin.ref === "function") process.stdin.ref();
    return wrapped;
  };
  wrapped.unref = () => {
    if (typeof process.stdin.unref === "function") process.stdin.unref();
    return wrapped;
  };
  process.stdin.on("data", (chunk: Buffer) => {
    const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
    // Strip mouse and focus sequences before Ink sees the stream — both
    // would otherwise look like Esc + printable garbage to the keyboard
    // parser. Order is independent: each only consumes its own pattern.
    const passthrough = parseFocusChunk(parseStdinChunk(text));
    if (passthrough.length > 0) wrapped.write(passthrough);
  });
  process.stdin.resume();
  return wrapped;
};

const wrappedStdin = process.stdin.isTTY ? buildWrappedStdin() : process.stdin;

render(<Root />, { stdin: wrappedStdin });
