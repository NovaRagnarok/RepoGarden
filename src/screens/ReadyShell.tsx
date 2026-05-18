import { Box, Text, measureElement, type DOMElement } from "ink";
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { MultiProgress, type MultiProgressItem } from "@/components/ui/multi-progress";
import { Pagination } from "@/components/ui/pagination";
import { Panel } from "@/components/ui/panel";
import { usePrivacy, useMaskedCreatures } from "@/components/privacy-context";
import { ProgressCircle } from "@/components/ui/progress-circle";
import { Skeleton } from "@/components/ui/skeleton";
import { Sparkline } from "@/components/ui/sparkline";
import { Spinner } from "@/components/ui/spinner";
import { useMotion, useTheme } from "@/components/ui/theme-provider";
import { Toaster, useToasts } from "@/components/ui/toast-host";
import type { RootProgress } from "@/lib/scanner";
import { useInput } from "@/hooks/use-input";
import { useMouse } from "@/hooks/use-mouse";
import { layoutMode, useTerminalSize } from "@/hooks/use-terminal-size";
import type { RepoCreature } from "@/lib/creature";
import { tildify } from "@/lib/scanner";
import { vibeGlyph, type Vibe } from "@/lib/vibe";
import {
  gardenPageCapacity,
  safeGardenCapacity,
  type GardenDensity
} from "@/lib/garden-layout";
import {
  buildReadyFocusList,
  clampReadyFocusIndex,
  focusedGardenIndex,
  followVisibleItemAfterUnhide,
  resolveReadyPagination
} from "@/lib/ready-shell-state";
import { writeToSystemClipboard } from "@/lib/clipboard";
import { exportGardenGif } from "@/lib/gif/export";
import { renderShareableTextFrame } from "@/lib/gif/text-export";
import { frameToText } from "@/lib/text-frame";
import { buildTiles, createGardenModel, pinForExport } from "@/garden/model";
import { renderGardenFrame } from "@/garden/render";
import type { GardenSceneProps, GardenThemeColors } from "@/garden/types";
import { GardenView } from "@/screens/GardenView";
import { Credit } from "@/components/Credit";
import { DitherOverlay } from "@/components/DitherOverlay";
import { UsageBar, UsageBarPlaceholder } from "@/components/UsageBar";
import { useUsage } from "@/hooks/use-usage";
import { useEvents } from "@/hooks/use-events";
import { JournalView } from "@/screens/JournalView";
import { ResizePrompt } from "@/components/ResizePrompt";
import { computeOverlayCardSlot, getTerminalLayout } from "@/lib/responsive-layout";

export type ReadyView = "garden" | "shelf" | "journal";

export interface ReadyShellProps {
  creatures: RepoCreature[];
  rootsLabel?: string;
  view?: ReadyView;
  onSetView?: (view: ReadyView) => void;
  onOpenSettings?: () => void;
  onOpenWorkbench?: (creature: RepoCreature) => void;
  onOpenFolder?: (creature: RepoCreature) => void;
  onCreaturePlacementChange?: (changes: Array<{
    creature: RepoCreature;
    offset: { offsetX: number; offsetY: number };
  }>) => void;
  onOpenHelp?: () => void;
  onOpenUsage?: () => void;
  onEditRoots?: () => void;
  onRescan?: () => void;
  onToggleHidden?: (creature: RepoCreature) => void;
  onQuit?: () => void;
  isRescanning?: boolean;
  rescanError?: string;
  scanProgress?: { done: number; total: number };
  scanProgressByRoot?: RootProgress[];
  /** When true, suppresses the Claude/Codex usage bar entirely (no credential
   *  reads, no network calls, no footer row). Defaults off unless the user
   *  opts in from Settings. */
  usageBarDisabled?: boolean;
  /** Master pagination toggle for the garden view. False jams the whole
   *  creature list onto a single page and lets the placer's graceful-
   *  degradation handle dense packing. Default true. */
  gardenPaginate?: boolean;
  /** Per-page slot density (garden) and per-cell breathing room (shelf).
   *  Default `comfortable`. */
  gardenDensity?: GardenDensity;
}

export const ReadyShell = ({
  creatures: rawCreatures,
  rootsLabel,
  view = "garden",
  onSetView,
  onOpenSettings,
  onOpenWorkbench,
  onOpenFolder,
  onCreaturePlacementChange,
  onOpenHelp,
  onOpenUsage,
  onEditRoots,
  onRescan,
  onToggleHidden,
  onQuit,
  isRescanning,
  rescanError,
  scanProgress,
  scanProgressByRoot,
  usageBarDisabled = true,
  gardenPaginate = true,
  gardenDensity = "comfortable"
}: ReadyShellProps) => {
  const theme = useTheme();
  const { reduced: reducedMotion } = useMotion();
  const { latest: latestStatus, push: pushToast, active: activeToasts } = useToasts();
  const { columns, rows } = useTerminalSize();
  const responsive = getTerminalLayout(columns, rows);
  const usage = useUsage(undefined, { disabled: usageBarDisabled });
  const mode = layoutMode(columns);
  const privacy = usePrivacy();
  // Mask creature names + sensitive fields when privacy mode is on. Every
  // creature consumer downstream sees the same masked version, so the engine
  // and sidebar render fake names without needing privacy awareness.
  const creatures = useMaskedCreatures(rawCreatures);
  // Hidden trigger for demo mode: typing 'd','e','m','o' in sequence in the
  // garden view toggles demo mode. Buffer the last few characters and reset
  // when the next input would no longer be a prefix of "demo".
  const demoSequenceRef = useRef<string>("");
  const demoSequenceLastKeyRef = useRef<number | null>(null);
  // Populated below once gardenWidth/gardenHeight/etc are known. The input
  // handler reads through the ref so the `x`/`t`/`T` keys can grab a fresh
  // scene-props snapshot without a separate `useInput` block.
  const sceneSnapshotRef = useRef<(() => GardenSceneProps | null) | null>(null);
  const exportingRef = useRef(false);
  // Action handlers (workbench, open folder, toggle hidden) need the real
  // underlying creature even while privacy is on — opening "~/▓▓▓" would just
  // fail. Resolve by id from the unmasked prop.
  const unmaskById = useCallback(
    (id: string) => rawCreatures.find((c) => c.id === id),
    [rawCreatures]
  );
  const [focusIndex, setFocusIndex] = useState(0);
  // Sidebar selection: a literal "home" row sits above the creatures in every
  // wide ready view. When true, the cursor lives on that row — garden/shelf
  // render with no focus ring or overlay card, and the journal scopes to all
  // repos. When false, the cursor is on focusList[focusIndex] and that
  // creature drives every focus-dependent UI element.
  const [homeSelected, setHomeSelected] = useState(false);
  // Garden-mode pagination. Only meaningful when displayView === "garden";
  // shelf and journal render the full creature list. [ / ] flip pages.
  const [gardenPageIndex, setGardenPageIndex] = useState(0);
  // Journal two-pane focus model. The journal view has two keyboard zones —
  // the event-list pane and the repo sidebar — and Esc toggles between them
  // (with an active filter consumed first). ↑↓ / jk both operate on the
  // focused zone; Enter always opens the workbench for the sidebar
  // selection. Reset to "pane" whenever the user enters journal mode so
  // they land scrolling events with `home` scoped to all repos.
  const [journalFocus, setJournalFocus] = useState<"pane" | "sidebar">("pane");
  useEffect(() => {
    if (view === "journal") {
      setJournalFocus("pane");
      // Land on `home` so the timeline scopes to "all events" by default —
      // the user can drill into a single repo by switching pane focus
      // (Esc) and pressing ↓.
      setHomeSelected(true);
    }
  }, [view]);

  // ---- view transition machinery --------------------------------------
  // `view` is the user's intent (set the instant they click a segment).
  // `displayView` is what we render. They diverge only across a list↔
  // garden/shelf boundary so we can paint a dither cross-fade between the
  // two frames. Garden↔shelf passes through immediately — GardenView's own
  // placement tween already covers that swap.
  //
  // Dither runs for TRANSITION_MS. We commit the new view at the midpoint,
  // so the user sees: old frame → rising noise → swap hidden by peak noise
  // → falling noise → new frame.
  const TRANSITION_MS = 1400;
  const GARDEN_SHELF_TRANSITION_MS = 1400;
  const [displayView, setDisplayView] = useState<ReadyView>(view);
  const [ditherStartedAt, setDitherStartedAt] = useState<number | null>(null);
  const transitionTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const gardenShelfTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [gardenShelfTransitioning, setGardenShelfTransitioning] = useState(false);
  useEffect(() => {
    if (view === displayView) return;
    if (reducedMotion) {
      // Skip both the dither cross-fade and the garden↔shelf hold — swap
      // straight to the new view. Sprite layout already snaps because the
      // garden layoutTransition is gated on reducedMotion too.
      if (gardenShelfTimerRef.current) clearTimeout(gardenShelfTimerRef.current);
      gardenShelfTimerRef.current = null;
      transitionTimersRef.current.forEach((id) => clearTimeout(id));
      transitionTimersRef.current = [];
      setGardenShelfTransitioning(false);
      setDitherStartedAt(null);
      setDisplayView(view);
      return;
    }
    const crossesJournalBoundary =
      (view === "journal" && displayView !== "journal") ||
      (displayView === "journal" && view !== "journal");
    if (!crossesJournalBoundary) {
      // garden ↔ shelf — GardenView's own tween handles the creature motion.
      // Keep the detail card hidden until that short placement swap settles;
      // otherwise the moving sprite cuts through the card's text block.
      if (gardenShelfTimerRef.current) clearTimeout(gardenShelfTimerRef.current);
      setGardenShelfTransitioning(true);
      setDisplayView(view);
      gardenShelfTimerRef.current = setTimeout(() => {
        setGardenShelfTransitioning(false);
        gardenShelfTimerRef.current = null;
      }, GARDEN_SHELF_TRANSITION_MS);
      return;
    }
    if (gardenShelfTimerRef.current) {
      clearTimeout(gardenShelfTimerRef.current);
      gardenShelfTimerRef.current = null;
    }
    setGardenShelfTransitioning(false);
    // Cancel any in-flight transition timers — a second click should restart
    // the dither, not stack on top of the prior one.
    transitionTimersRef.current.forEach((id) => clearTimeout(id));
    transitionTimersRef.current = [];
    setDitherStartedAt(performance.now());
    const swap = setTimeout(() => setDisplayView(view), Math.floor(TRANSITION_MS / 2));
    const end = setTimeout(() => setDitherStartedAt(null), TRANSITION_MS);
    transitionTimersRef.current.push(swap, end);
  }, [view, displayView, reducedMotion]);
  useEffect(() => () => {
    transitionTimersRef.current.forEach((id) => clearTimeout(id));
    if (gardenShelfTimerRef.current) clearTimeout(gardenShelfTimerRef.current);
  }, []);
  // ---------------------------------------------------------------------

  const [filter, setFilter] = useState("");
  const [filterMode, setFilterMode] = useState(false);
  const [cardVisible, setCardVisible] = useState(true);
  const journalActive = view === "journal";
  const creatureFilter = journalActive ? "" : filter;

  const shownCreatures = useMemo(
    () => creatures.filter((c) => !c.memory.hidden),
    [creatures]
  );
  const hiddenCreatures = useMemo(
    () => creatures.filter((c) => c.memory.hidden),
    [creatures]
  );
  const visibleCreatures = useMemo(() => {
    if (!creatureFilter.trim()) return shownCreatures;
    const needle = creatureFilter.toLowerCase();
    return shownCreatures.filter((c) => c.scan.name.toLowerCase().includes(needle));
  }, [shownCreatures, creatureFilter]);
  const visibleHiddenCreatures = useMemo(() => {
    if (!creatureFilter.trim()) return hiddenCreatures;
    const needle = creatureFilter.toLowerCase();
    return hiddenCreatures.filter((c) => c.scan.name.toLowerCase().includes(needle));
  }, [hiddenCreatures, creatureFilter]);
  // focusList, gardenFocusIndex, and related effects are derived further
  // down — after gardenWidth/gardenHeight/overlayDeadZone are known — so
  // pagination can slice visibleCreatures before the cursor walks it.
  const followAfterUnhideRef = useRef<string | null>(null);

  const handleExportGif = useCallback(async () => {
    const snapshot = sceneSnapshotRef.current?.();
    if (!snapshot) {
      pushToast("nothing to export yet", "info");
      return;
    }
    if (exportingRef.current) return;
    exportingRef.current = true;
    pushToast("rendering gif…", "info");
    try {
      // Use the live habitat dimensions verbatim — the goal is that the
      // user recognises their garden in the GIF. The snapshot already
      // carries `pagedVisibleCreatures`, so the export inherits paging too:
      // if you're on page 2 of 3 when you press `x`, the GIF is page 2.
      // Only mutation: drop the focus ring — it's a habitat shot, not a
      // session screenshot.
      const result = await exportGardenGif({ ...snapshot, focusIndex: -1 });
      pushToast(`saved ${tildify(result.path)}`, "success", 6_000);
    } catch (error) {
      const message = error instanceof Error ? error.message : "gif export failed";
      pushToast(message, "error", 6_000);
    } finally {
      exportingRef.current = false;
    }
  }, [pushToast]);

  const handleCopyTextFrameSmall = useCallback(async () => {
    const snapshot = sceneSnapshotRef.current?.();
    if (!snapshot) {
      pushToast("nothing to copy yet", "info");
      return;
    }
    // "Small" mode: bisect a wide-short panorama until it fits Discord's
    // 1999-char budget. Names get truncated at 16 chars + `…` so the
    // placer can pack a denser horizontal row instead of stacking 2-up.
    const text = renderShareableTextFrame(snapshot.creatures, {
      theme: snapshot.theme,
      maxChars: 1999,
      nameMaxChars: 16,
      shareFormat: true,
      startWidth: 150,
      startHeight: 12
    });
    const ok = writeToSystemClipboard(text);
    pushToast(
      ok ? `copied panorama (${text.length} chars)` : "clipboard unavailable",
      ok ? "success" : "error"
    );
  }, [pushToast]);

  const handleCopyTextFrameBig = useCallback(async () => {
    const snapshot = sceneSnapshotRef.current?.();
    if (!snapshot) {
      pushToast("nothing to copy yet", "info");
      return;
    }
    // "Big" mode: render the current habitat page at the live canvas
    // dimensions verbatim. No bisect, no truncation. Useful for pasting
    // into a wide editor / README / Slack canvas where the 2000-char
    // limit doesn't apply.
    const model = createGardenModel(snapshot, 0);
    pinForExport(model);
    const frame = renderGardenFrame(model, 0);
    const text = frameToText(frame, { brand: true, fenced: true });
    const ok = writeToSystemClipboard(text);
    pushToast(
      ok ? "copied habitat frame" : "clipboard unavailable",
      ok ? "success" : "error"
    );
  }, [pushToast]);

  useInput((input, key) => {
    if (filterMode) {
      if (key.escape) {
        setFilterMode(false);
        setFilter("");
        setFocusIndex(0);
        return;
      }
      if (key.return) {
        setFilterMode(false);
        return;
      }
      if (key.backspace || key.delete) {
        setFilter((current) => current.slice(0, -1));
        setFocusIndex(0);
        return;
      }
      if (input && !key.ctrl && !key.meta && input.length === 1) {
        setFilter((current) => current + input);
        setFocusIndex(0);
      }
      return;
    }

    if (input === "/") {
      setFilterMode(true);
      return;
    }

    if (journalActive) {
      if (input === "s" && onOpenSettings) {
        onOpenSettings();
        return;
      }
      if (input === "r" && onRescan) {
        onRescan();
        return;
      }
      if (input === "g" && onSetView) {
        const order: ReadyView[] = ["garden", "shelf", "journal"];
        const next = order[(order.indexOf(view) + 1) % order.length];
        onSetView(next);
        return;
      }
      if (input === "o" && onOpenFolder) {
        // Only meaningful when a creature is highlighted in the sidebar —
        // skip when the journal cursor is on the "home" row.
        if (!homeSelected) {
          const creature = focusList[focusIndex];
          const target = creature ? (unmaskById(creature.id) ?? creature) : undefined;
          if (target) onOpenFolder(target);
        }
        return;
      }
      if (input === "?" && onOpenHelp) {
        onOpenHelp();
        return;
      }
      if (input === "U" && onOpenUsage) {
        onOpenUsage();
        return;
      }
      if (input === "p" && onEditRoots) {
        onEditRoots();
        return;
      }
      if (input === "m") {
        privacy.toggle();
        return;
      }
      // Esc cascades. Active filter wins (clear it); otherwise toggle which
      // of the two journal panes owns the keyboard. This is the entry point
      // for the two-pane focus model — see the `journalFocus` state above.
      if (key.escape) {
        if (filter) {
          setFilter("");
        } else {
          setJournalFocus((current) => (current === "pane" ? "sidebar" : "pane"));
        }
        return;
      }
      if (input === "q" && onQuit) {
        onQuit();
        return;
      }

      // Enter always opens the workbench for whatever creature the sidebar
      // currently has selected, regardless of which pane has keyboard
      // focus. `home` is a no-op (it isn't a workbench target).
      if (key.return && onOpenWorkbench) {
        if (homeSelected) return;
        const creature = focusList[focusIndex];
        const target = creature ? (unmaskById(creature.id) ?? creature) : undefined;
        if (target) onOpenWorkbench(target);
        return;
      }

      // Two-pane focus model: ↑↓ (and j/k as aliases) operate on whichever
      // pane is currently focused. Sidebar-focused → walk repos through the
      // virtual home row; pane-focused → let JournalView's own useInput
      // handle scrolling. j/k arrive via `input` so we have to swallow them
      // here when the sidebar owns focus, otherwise JournalView would also
      // consume them and both panes would move at once.
      if (journalFocus === "sidebar" && (key.upArrow || input === "k")) {
        if (homeSelected) return;
        if (focusIndex <= 0) {
          setHomeSelected(true);
        } else {
          setFocusIndex((current) => Math.max(0, current - 1));
        }
        return;
      }
      if (journalFocus === "sidebar" && (key.downArrow || input === "j")) {
        if (homeSelected) {
          if (focusList.length > 0) setHomeSelected(false);
          return;
        }
        setFocusIndex((current) => Math.min(Math.max(0, focusList.length - 1), current + 1));
        return;
      }

      // Pane-focused → JournalView owns ↑↓/jk plus its filter/detail keys.
      return;
    }

    // Hidden trigger: typing 'd','e','m','o' in sequence (within ~1.5s
    // between keys) toggles demo mode. The buffer only advances when the
    // input extends "demo" as a prefix, so a stray 'm' still toggles
    // mask mode and a stray 'o' still opens the folder. When 'd' starts
    // the sequence, subsequent matching keys are consumed (don't fire
    // their normal bindings) so we don't accidentally open a folder mid-
    // word. After the full sequence fires (or fails the prefix check)
    // the buffer resets.
    const DEMO_SEQUENCE = "demo";
    const SEQUENCE_TIMEOUT_MS = 1500;
    const sequenceNow = Date.now();
    if (sequenceNow - (demoSequenceRef.current.length > 0 ? (demoSequenceLastKeyRef.current ?? 0) : sequenceNow) > SEQUENCE_TIMEOUT_MS) {
      demoSequenceRef.current = "";
    }
    if (input.length === 1) {
      const candidate = demoSequenceRef.current + input;
      if (DEMO_SEQUENCE.startsWith(candidate)) {
        demoSequenceRef.current = candidate;
        demoSequenceLastKeyRef.current = sequenceNow;
        if (candidate === DEMO_SEQUENCE) {
          privacy.setMode(privacy.mode === "demo" ? "off" : "demo");
          demoSequenceRef.current = "";
        }
        return;
      }
      demoSequenceRef.current = "";
    }

    // Sidebar navigation in garden/shelf. The "home" row sits above the
    // creatures; ↑ from creature[0] steps up to home, ↓ from home steps down
    // to creature[0]. When home is selected, no creature is focused —
    // garden/shelf render without a focus ring or overlay card.
    if (key.upArrow) {
      if (homeSelected) return;
      if (focusIndex <= 0) {
        setHomeSelected(true);
      } else {
        setFocusIndex((current) => Math.max(0, current - 1));
      }
      return;
    }
    if (key.downArrow) {
      if (homeSelected) {
        if (focusList.length > 0) setHomeSelected(false);
        return;
      }
      setFocusIndex((current) => Math.min(Math.max(0, focusList.length - 1), current + 1));
      return;
    }
    if (key.return && onOpenWorkbench) {
      if (homeSelected) return; // home isn't a workbench target
      const creature = focusList[focusIndex];
      const target = creature ? (unmaskById(creature.id) ?? creature) : undefined;
      if (target) onOpenWorkbench(target);
      return;
    }
    if (input === "s" && onOpenSettings) {
      onOpenSettings();
      return;
    }
    if (input === "r" && onRescan) {
      onRescan();
      return;
    }
    if (input === "g" && onSetView) {
      // Cycle through the three view modes so the keyboard exposes everything
      // the badge does plus the legacy list view.
      const order: ReadyView[] = ["garden", "shelf", "journal"];
      const next = order[(order.indexOf(view) + 1) % order.length];
      onSetView(next);
      return;
    }
    if (input === "o" && onOpenFolder) {
      if (homeSelected) return;
      const creature = focusList[focusIndex];
      const target = creature ? (unmaskById(creature.id) ?? creature) : undefined;
      if (target) onOpenFolder(target);
      return;
    }
    if (input === "h" && onToggleHidden) {
      if (homeSelected) return;
      const creature = focusList[focusIndex];
      const target = creature ? (unmaskById(creature.id) ?? creature) : undefined;
      if (target) {
        if (target.memory.hidden) followAfterUnhideRef.current = target.id;
        onToggleHidden(target);
      }
      return;
    }
    if (input === "?" && onOpenHelp) {
      onOpenHelp();
      return;
    }
    if (input === "U" && onOpenUsage) {
      onOpenUsage();
      return;
    }
    if (input === "p" && onEditRoots) {
      onEditRoots();
      return;
    }
    // 'm' for mask. Journal mode has its own copy of this handler higher up
    // since it owns its own key-routing branch.
    if (input === "m") {
      privacy.toggle();
      return;
    }
    if (input === "c") {
      setCardVisible((current) => !current);
      return;
    }
    // Share-the-garden keys. Active in garden + shelf only — journal is text,
    // not a habitat. `x` → animated GIF to ~/Downloads; `t` → Discord-sized
    // panorama (under 2000 chars, truncated names, single horizontal-ish row);
    // `T` → full-canvas habitat snapshot (no size limit).
    if (input === "x") {
      void handleExportGif();
      return;
    }
    if (input === "t") {
      void handleCopyTextFrameSmall();
      return;
    }
    if (input === "T") {
      void handleCopyTextFrameBig();
      return;
    }
    // Page nav — only meaningful in garden view (shelf/journal don't paginate).
    // Clamps at edges so a stray ] at the last page doesn't move the cursor.
    // Focus resets to the first creature on the new page so the highlight
    // never lands on something the user can't see.
    if (input === "[" && isGardenView && gardenPageCount > 1) {
      setGardenPageIndex((p) => Math.max(0, p - 1));
      setFocusIndex(0);
      setHomeSelected(false);
      return;
    }
    if (input === "]" && isGardenView && gardenPageCount > 1) {
      setGardenPageIndex((p) => Math.min(gardenPageCount - 1, p + 1));
      setFocusIndex(0);
      setHomeSelected(false);
      return;
    }
    if (key.escape && filter) {
      setFilter("");
      return;
    }
    if (input === "q" && onQuit) {
      onQuit();
    }
  });

  // `focus` is derived after focusList exists — see further down. We still
  // need a few things up here that DON'T depend on focusList:
  // JournalView owns scope/search/kind/range filtering locally so the user can
  // switch between focused and all-repo timelines without disk re-reads. Keep
  // the poller dormant outside journal mode so its 5s disk reads do not force
  // unrelated garden rerenders.
  const shouldPollJournalEvents = view === "journal" || displayView === "journal";
  const journalEvents = useEvents({ limit: 1_000, enabled: shouldPollJournalEvents });
  const gardenSidebarWidth = responsive.showSidebar
    ? Math.max(22, Math.min(32, Math.floor(columns * 0.22)))
    : 0;
  const stackedWidth = responsive.contentWidth;
  const gardenWidth = responsive.showSidebar
    ? Math.max(40, columns - gardenSidebarWidth - 3)
    : stackedWidth;

  // Measure the chrome above the garden (everything between the outer
  // paddingY and the garden block) so we know exactly where the garden
  // content area starts on screen — even after a resize or when conditional
  // info rows appear/disappear. The garden's height is derived from this
  // instead of a fixed estimate, which is what kept ~6–8 rows of slack
  // unallocated at the bottom of the screen.
  const chromeRef = useRef<DOMElement | null>(null);
  const [chromeRowHeight, setChromeRowHeight] = useState(7);
  // Measure on every commit. Ink can sometimes return 0 from
  // measureElement on the very first layout pass (notably when the app
  // boots straight into a full-screen window — yoga hasn't sized the
  // node yet by the time useLayoutEffect runs). When that happens, no
  // state update fires, no re-render is scheduled, and chromeRowHeight
  // stays stuck at the initial guess. Origin coordinates derived from
  // it are then wrong, mouse hit-testing in the garden misses every
  // creature, and the user has to physically resize the terminal
  // before things start working. Schedule a single retry on the next
  // task tick if we see a zero so the measurement loop self-heals
  // instead of waiting for a resize.
  const chromeRetryRef = useRef<NodeJS.Immediate | null>(null);
  useLayoutEffect(() => {
    if (!chromeRef.current) return;
    const { height } = measureElement(chromeRef.current);
    if (height > 0) {
      if (height !== chromeRowHeight) setChromeRowHeight(height);
      return;
    }
    if (chromeRetryRef.current) return;
    chromeRetryRef.current = setImmediate(() => {
      chromeRetryRef.current = null;
      if (!chromeRef.current) return;
      const retried = measureElement(chromeRef.current).height;
      if (retried > 0 && retried !== chromeRowHeight) setChromeRowHeight(retried);
    });
  });
  useEffect(
    () => () => {
      if (chromeRetryRef.current) {
        clearImmediate(chromeRetryRef.current);
        chromeRetryRef.current = null;
      }
    },
    []
  );

  // Below the garden Panel: outer paddingY bottom (1) + footer body. The
  // footer sits flush against the garden Panel's bottom border — no spacer
  // row in between. Footer body is 1 row when the inline usage strip is
  // hidden, or 2 rows when it's shown (7d row + 5h row, with hint/Credit
  // bottom-aligned next to the 5h row). The toaster is absolutely positioned
  // and the latest status lives inside the sidebar Panel, so neither steals
  // a row of garden height.
  // `useUsage` starts at `[]` and resolves to 2 entries asynchronously, so
  // we key the footer height off `columns` alone — otherwise the garden
  // would shrink by 1 the moment usage data lands.
  const footerBodyRows = responsive.showUsageFooter ? 2 : 1;
  const gardenChromeBelow = 1 + footerBodyRows;
  const compactSummaryRows = responsive.showSidebar ? 0 : 1;
  const gardenHeight = Math.max(
    8,
    responsive.contentHeight - chromeRowHeight - gardenChromeBelow - compactSummaryRows
  );
  // Wide habitat card: the slot is only reserved when the user has it
  // toggled on. Dismissing with `c` returns the bottom-right corner to
  // the garden — the placeholder Box stops painting, stars render
  // through, and creatures can wander or be dragged into it.
  const overlayCardSlot = useMemo(
    () =>
      computeOverlayCardSlot({
        canReserve: responsive.showOverlayCard,
        cardVisible,
        gardenWidth,
        gardenHeight
      }),
    [responsive.showOverlayCard, cardVisible, gardenWidth, gardenHeight]
  );
  const showOverlayCard = overlayCardSlot.visible;
  const habitatPlacementMode = displayView === "shelf" ? "shelf" : "organic";
  const overlayDeadZone = overlayCardSlot.deadZone;
  const overlayCardWidth = overlayCardSlot.width;
  const overlayCardHeight = overlayCardSlot.height;
  const overlayCardOffsetTop = overlayCardSlot.offsetTop;
  const overlayCardOffsetLeft = overlayCardSlot.offsetLeft;

  // Pagination — only active in garden mode. The capacity formula mirrors the
  // placer's own slot math (PAGE_SLOT_W/H in garden-layout.ts) so a page's
  // creatures fit cleanly without the placer falling back to overlap-packing.
  // Shelf/journal keep the full visibleCreatures list.
  const isGardenView = displayView === "garden";
  const gardenInnerWidth = Math.max(
    20,
    (responsive.showSidebar ? gardenWidth : stackedWidth) - 4
  );
  const gardenInnerHeight = Math.max(10, gardenHeight - 4);
  const gardenCapacity = useMemo(
    () => gardenPageCapacity(gardenInnerWidth, gardenInnerHeight, overlayDeadZone, undefined, gardenDensity),
    [gardenInnerWidth, gardenInnerHeight, overlayDeadZone?.width, overlayDeadZone?.height, gardenDensity]
  );
  // When pagination is off, the whole creature list goes onto a single page
  // and the placer's graceful-degradation handles dense packing if the
  // canvas can't physically fit everyone without overlap.
  const gardenPagination = useMemo(
    () =>
      resolveReadyPagination({
        items: visibleCreatures,
        isGardenView,
        paginate: gardenPaginate,
        capacity: gardenCapacity,
        pageIndex: gardenPageIndex
      }),
    [isGardenView, gardenPaginate, visibleCreatures, gardenCapacity, gardenPageIndex]
  );
  const gardenPageCount = gardenPagination.pageCount;
  const safeGardenPageIndex = gardenPagination.safePageIndex;
  const pagedVisibleCreatures = gardenPagination.pageItems;

  // Reset page on filter change so an empty page can't strand the user.
  useEffect(() => {
    setGardenPageIndex(0);
  }, [filter]);
  // Clamp pageIndex when page count shrinks (rescan, unhide).
  useEffect(() => {
    if (gardenPageIndex >= gardenPageCount) setGardenPageIndex(0);
  }, [gardenPageCount, gardenPageIndex]);
  // Focus reset on explicit page flip lives inline in the [ / ] handlers —
  // doing it via useEffect would fire spuriously when isGardenView flips
  // (e.g. transitioning back into garden after a shelf detour).

  // Combined list the cursor can traverse — paginated shown creatures first,
  // then hidden. In garden mode the shown half is just the current page's
  // creatures; in shelf/journal it's the full visibleCreatures list.
  const focusList = useMemo(
    () => buildReadyFocusList(pagedVisibleCreatures, visibleHiddenCreatures),
    [pagedVisibleCreatures, visibleHiddenCreatures]
  );
  const gardenFocusIndex = focusedGardenIndex({
    homeSelected,
    focusIndex,
    visibleCount: pagedVisibleCreatures.length
  });

  // Snapshot builder for the export keybindings (x/t/T). Refreshed every
  // render so the export keys always see the current page, focus, theme,
  // and layout. Returns null in views where habitat export doesn't make
  // sense (journal, empty pages).
  sceneSnapshotRef.current = (): GardenSceneProps | null => {
    if (displayView !== "garden" && displayView !== "shelf") return null;
    if (pagedVisibleCreatures.length === 0) return null;
    const gardenThemeColors: GardenThemeColors = {
      foreground: theme.colors.foreground,
      background: theme.colors.background,
      mutedForeground: theme.colors.mutedForeground,
      primary: theme.colors.primary,
      accent: theme.colors.accent,
      success: theme.colors.success,
      warning: theme.colors.warning,
      error: theme.colors.error,
      info: theme.colors.info,
      creaturePalette: theme.creaturePalette
    };
    const innerWidth = Math.max(20, gardenWidth - 4);
    const canvasH = Math.max(10, gardenHeight - 4);
    // Strip saved drag positions so the export uses canonical placement.
    // A prior manual drag in the TUI would otherwise pull creatures toward
    // the canvas edge in the snapshot, where long labels can clip.
    const canonicalCreatures = pagedVisibleCreatures.map((c) => ({
      ...c,
      memory: { ...c.memory, gardenPlacement: undefined }
    }));
    // The live page may pack more creatures than fit without label overlap
    // (especially with long repo names). For export, slice down to the
    // labels-aware capacity so the snapshot reads cleanly. Same first-N
    // ordering as the live view — the user still sees the start of their
    // current page in the export. `pinForExport` (applied later to the
    // resulting model) zeroes wander so labels can't drift off-canvas;
    // we leave reducedMotion=false here so the body wiggle still animates.
    const draftProps: GardenSceneProps = {
      creatures: canonicalCreatures,
      focusIndex: gardenFocusIndex,
      innerWidth,
      canvasH,
      deadZone: responsive.showSidebar ? overlayDeadZone : undefined,
      placementMode: habitatPlacementMode,
      theme: gardenThemeColors,
      reducedMotion: false
    };
    const safeCapacity = safeGardenCapacity(
      buildTiles(draftProps),
      innerWidth,
      canvasH,
      responsive.showSidebar ? overlayDeadZone : undefined
    );
    const safeCreatures = pagedVisibleCreatures.slice(0, safeCapacity);
    return { ...draftProps, creatures: safeCreatures };
  };

  useEffect(() => {
    if (focusIndex >= focusList.length && focusList.length > 0) {
      setFocusIndex(focusList.length - 1);
    }
  }, [focusList.length, focusIndex]);

  // When a repo is unhidden via 'h', follow it to its new spot — including
  // jumping to whichever page contains it now.
  useEffect(() => {
    const id = followAfterUnhideRef.current;
    if (!id) return;
    const globalIdx = visibleCreatures.findIndex((c) => c.id === id);
    const gardenTarget = isGardenView
      ? followVisibleItemAfterUnhide({ globalIndex: globalIdx, capacity: gardenCapacity })
      : null;
    if (gardenTarget) {
      setGardenPageIndex(gardenTarget.pageIndex);
      setFocusIndex(gardenTarget.focusIndex);
      setHomeSelected(false);
      followAfterUnhideRef.current = null;
      return;
    }
    const idx = focusList.findIndex((c) => c.id === id);
    if (idx >= 0) {
      setFocusIndex(idx);
      setHomeSelected(false);
    }
    followAfterUnhideRef.current = null;
  }, [focusList, gardenCapacity, isGardenView, visibleCreatures]);

  // When "home" is selected, no creature is in focus — every focus-dependent
  // UI element (focus ring, overlay card, detail card, status text, etc.)
  // sees `focus` as undefined and gracefully renders an empty/calm state.
  const focus = homeSelected ? undefined : focusList[focusIndex];

  const handleGardenCreatureSelect = useCallback((index: number) => {
    setFocusIndex(index);
  }, []);
  const handleGardenFocusDelta = useCallback((delta: number) => {
    setFocusIndex((current) =>
      clampReadyFocusIndex(current + delta, focusList.length)
    );
  }, [focusList.length]);
  const handleGardenCreaturePlacementChange = useCallback(
    (changes: Array<{ creature: RepoCreature; offset: { offsetX: number; offsetY: number } }>) => {
      onCreaturePlacementChange?.(changes);
    },
    [onCreaturePlacementChange]
  );

  // Hit zones for the wide-garden sidebar items, computed from the same
  // windowing math the sidebar render uses. Stored so a single useMouse
  // handler can map a click row → focus index without the sidebar having to
  // know its own absolute screen coordinates.
  const sidebarHitZones = useMemo(() => {
    // Sidebar is present in all three wide ready views; only narrow layouts
    // skip it. The home row is rendered in all wide views and is always
    // clickable, even when there are no creatures.
    if (!responsive.showSidebar) return [];
    if (displayView !== "garden" && displayView !== "shelf" && displayView !== "journal") return [];
    // Mirror the sidebar function: status row + home row each eat 1 row of
    // content area.
    const statusRowCost = latestStatus ? 1 : 0;
    const homeRowCost = 1;
    const totalContent = Math.max(1, gardenHeight - 4 - statusRowCost - homeRowCost);
    const creatureFocusActive = !homeSelected;
    const shownFocus =
      creatureFocusActive && focusIndex < pagedVisibleCreatures.length ? focusIndex : -1;
    const hiddenFocus =
      creatureFocusActive && focusIndex >= pagedVisibleCreatures.length
        ? focusIndex - pagedVisibleCreatures.length
        : -1;
    const hiddenHeader = visibleHiddenCreatures.length > 0 ? 1 : 0;
    const hiddenWish = hiddenHeader + visibleHiddenCreatures.length;
    const hiddenCap = Math.max(2, Math.floor(totalContent / 3));
    const hiddenAllotment =
      visibleHiddenCreatures.length === 0 ? 0 : Math.min(hiddenWish, hiddenCap);
    const shownAllotment = Math.max(1, totalContent - hiddenAllotment);
    const shownAnchor = shownFocus >= 0 ? shownFocus : 0;
    const shownStart = Math.max(
      0,
      Math.min(
        shownAnchor - Math.floor(shownAllotment / 2),
        Math.max(0, pagedVisibleCreatures.length - shownAllotment)
      )
    );
    const shownSliced = pagedVisibleCreatures.slice(shownStart, shownStart + shownAllotment);
    const shownOverflowAfter = pagedVisibleCreatures.length - (shownStart + shownSliced.length);
    const hiddenItemRows = Math.max(0, hiddenAllotment - hiddenHeader);
    const hiddenAnchor = hiddenFocus >= 0 ? hiddenFocus : 0;
    const hiddenStart = Math.max(
      0,
      Math.min(
        hiddenAnchor - Math.floor(hiddenItemRows / 2),
        Math.max(0, visibleHiddenCreatures.length - hiddenItemRows)
      )
    );
    const hiddenSliced = visibleHiddenCreatures.slice(hiddenStart, hiddenStart + hiddenItemRows);

    // Sidebar Panel: outer paddingY top (1) + chrome (chromeRowHeight)
    //   + Panel top border (1) + title box (3 rows: borders + text)
    //   = chromeRowHeight + 5 rows occupied before the first item.
    // Add 1 to convert to a 1-indexed screen row. (The status row sits at
    // the bottom of the panel now, so it doesn't shift item positions.)
    let row = chromeRowHeight + 6;
    const leftCol = 2; // outer paddingX (1) → col 2 is the panel left border
    const rightCol = gardenSidebarWidth + 1;
    const zones: {
      topRow: number;
      leftCol: number;
      rightCol: number;
      /** focusIdx = -1 is the "home" row; >=0 indexes focusList. */
      focusIdx: number;
    }[] = [];
    // Virtual "home" row sits at the top of every wide ready sidebar.
    zones.push({ topRow: row, leftCol, rightCol, focusIdx: -1 });
    row += 1;
    for (let i = 0; i < shownSliced.length; i += 1) {
      zones.push({ topRow: row, leftCol, rightCol, focusIdx: shownStart + i });
      row += 1;
    }
    if (shownOverflowAfter > 0) row += 1;
    if (shownStart > 0) row += 1;
    if (visibleHiddenCreatures.length > 0) {
      row += 1; // marginTop=1 spacer
      row += 1; // "hidden · N" header
      if (hiddenStart > 0) row += 1;
      for (let i = 0; i < hiddenSliced.length; i += 1) {
        zones.push({
          topRow: row,
          leftCol,
          rightCol,
          focusIdx: pagedVisibleCreatures.length + hiddenStart + i
        });
        row += 1;
      }
    }
    return zones;
  }, [
    displayView,
    responsive.showSidebar,
    columns,
    chromeRowHeight,
    gardenHeight,
    gardenSidebarWidth,
    pagedVisibleCreatures,
    visibleHiddenCreatures,
    focusIndex,
    latestStatus,
    homeSelected
  ]);

  // Top-right segmented toggle click zone. The header renders three bordered
  // Badges (GARDEN · SHELF · LIST) in a row; clicking any segment jumps to
  // that view. Clicks during a scan are ignored — the row is replaced by a
  // SCANNING indicator and shouldn't act as a toggle.
  useMouse(
    useCallback(
      (event) => {
        if (event.kind !== "press" || event.button !== "left") return;
        if (isRescanning) return;
        if (!onSetView) return;
        // Render order matches the keyboard cycle (g).
        const segments: { view: ReadyView; label: string }[] = [
          { view: "garden", label: "GARDEN" },
          { view: "shelf", label: "SHELF" },
          { view: "journal", label: "JOURNAL" },
        ];
        // Each bordered Badge: text + 2 padding + 2 borders. Row gap=1.
        const widths = segments.map((s) => s.label.length + 4);
        const totalW = widths.reduce((a, b) => a + b, 0) + (segments.length - 1);
        const rowRight = columns - 1;
        const rowLeft = rowRight - totalW + 1;
        const badgeH = 3;
        // Outer wrapper paddingX=1 puts content at col 1+; paddingY=1 puts the
        // first chrome row at screen row 2. In narrow mode the badge row drops
        // below the title block (3 lines + marginTop=1).
        const rowTop = mode === "narrow" ? 2 + 3 + 1 : 2;
        const rowBottom = rowTop + badgeH - 1;
        if (event.row < rowTop || event.row > rowBottom) return;
        let cursor = rowLeft;
        for (let i = 0; i < segments.length; i++) {
          const segLeft = cursor;
          const segRight = cursor + widths[i] - 1;
          if (event.col >= segLeft && event.col <= segRight) {
            onSetView(segments[i].view);
            return;
          }
          cursor = segRight + 2; // 1 gap col between segments
        }
      },
      [columns, mode, isRescanning, onSetView]
    )
  );

  // Sidebar + card mouse handler. The garden's own mouse hooks are inside
  // GardenView; this one covers everything outside the garden Panel. The
  // sidebar renders in all three wide ready views (garden/shelf/journal), so
  // the gate is "any wide ready layout" rather than "garden only".
  useMouse(
    useCallback(
      (event) => {
        if (!responsive.showSidebar) return;
        if (displayView !== "garden" && displayView !== "shelf" && displayView !== "journal") return;
        // Wheel over the sidebar column → step focus.
        if (event.kind === "wheel") {
          if (event.col >= 2 && event.col <= gardenSidebarWidth + 1) {
            if (event.button === "wheel-up") {
              setFocusIndex((current) => Math.max(0, current - 1));
            } else if (event.button === "wheel-down") {
              setFocusIndex((current) =>
                Math.min(Math.max(0, focusList.length - 1), current + 1)
              );
            }
          }
          return;
        }
        if (event.kind !== "press" || event.button !== "left") return;
        if (
          (displayView === "garden" || displayView === "shelf") &&
          showOverlayCard &&
          focus &&
          !gardenShelfTransitioning &&
          onOpenWorkbench
        ) {
          const cardTop = chromeRowHeight + 2 + overlayCardOffsetTop;
          const cardLeft = gardenSidebarWidth + 3 + overlayCardOffsetLeft;
          if (
            event.row >= cardTop &&
            event.row < cardTop + overlayCardHeight &&
            event.col >= cardLeft &&
            event.col < cardLeft + overlayCardWidth
          ) {
            onOpenWorkbench(unmaskById(focus.id) ?? focus);
            return;
          }
        }
        // Click on a sidebar row. Two kinds of row:
        //   focusIdx === -1: the journal "home" row → scope = all.
        //   focusIdx >= 0:  a creature row → focus that creature; in journal
        //                   mode, also flip scope = focused.
        // Two-pane focus model: clicking a sidebar row in journal mode
        // updates the sidebar selection BUT keeps keyboard focus on the
        // event-list pane, so arrows continue to scroll events. The mouse
        // is for picking the scope; the keyboard stays where the reader's
        // attention is.
        for (const zone of sidebarHitZones) {
          if (
            event.row === zone.topRow &&
            event.col >= zone.leftCol &&
            event.col <= zone.rightCol
          ) {
            if (zone.focusIdx === -1) {
              setHomeSelected(true);
            } else {
              setFocusIndex(zone.focusIdx);
              setHomeSelected(false);
            }
            if (journalActive) setJournalFocus("pane");
            return;
          }
        }
      },
      [
        displayView,
        responsive.showSidebar,
        columns,
        gardenSidebarWidth,
        focusList.length,
        showOverlayCard,
        focus,
        gardenShelfTransitioning,
        onOpenWorkbench,
        chromeRowHeight,
        overlayCardOffsetTop,
        overlayCardOffsetLeft,
        overlayCardHeight,
        overlayCardWidth,
        sidebarHitZones,
        journalActive
      ]
    )
  );

  // Garden Panel content first row (1-indexed):
  //   outer paddingY top (1)
  // + measured chrome height (header + conditional rows + tagline block)
  // + outer Panel top border (1)
  // + paddingY top inside Panel (1)
  // Then add +1 to convert from "rows-occupied" to 1-indexed position.
  const gardenContentRow = 1 + chromeRowHeight + 2 + 1;
  // First content col (1-indexed):
  //   outer paddingX (1)
  // + sidebar width + sidebar marginRight (1)
  // + Panel left border (1)
  // + paddingX inside Panel (1)
  // + 1 for the 1-indexed conversion.
  const wideGardenContentCol = 1 + gardenSidebarWidth + 1 + 1 + 1 + 1;
  const stackedGardenContentCol = 1 + 1 + 1 + 1;

  // Paint-mask the toast's screen footprint so the garden engine's
  // direct-stdout star/sprite painter doesn't overpaint Ink's toast.
  // The toast is positioned by the absolutely-placed Toaster Box below
  // (`marginTop = rows - TOASTER_MARGIN_TOP`, right-aligned within
  // `width = columns - 2`), so its top-left screen position is
  // deterministic from `rows` / `columns` plus the visible toast widths.
  // The mask is consumed by GardenView in canvas-local coords, so we
  // convert from absolute screen rows/cols to canvas-local via the same
  // origin math used to place the engine.
  //
  // Mask geometry per toast (matches `Toast`'s Yoga box with
  // showProgress=false): width = message.length + border(2) +
  // paddingX(2) + icon(1) + gap(1); height = 3 (top border + content +
  // bottom border). Stacked vertically inside the Toaster's column,
  // newest at the bottom; `max=3` cap.
  const TOASTER_MARGIN_TOP = 9; // keep in sync with the Toaster Box below
  const TOAST_MAX_VISIBLE = 3;
  const TOAST_ROWS_EACH = 3;
  const TOAST_WIDTH_PADDING = 6; // border(2) + paddingX(2) + icon(1) + gap(1)
  const visibleToasts = activeToasts.slice(-TOAST_MAX_VISIBLE);
  // Serialized message lengths so the paintExclusions memo doesn't see
  // a fresh reference every render (the active list is rebuilt on each
  // push/dismiss). Exclusion geometry is purely a function of message
  // width and count.
  const visibleToastSig = visibleToasts.map((t) => t.message.length).join(",");
  const gardenContentCol = responsive.showSidebar
    ? wideGardenContentCol
    : stackedGardenContentCol;
  const gardenContentRowForCanvas = responsive.showSidebar
    ? gardenContentRow
    : gardenContentRow + 1;
  const gardenCanvasInnerWidth = responsive.showSidebar
    ? gardenInnerWidth
    : Math.max(20, stackedWidth - 4);
  const gardenCanvasInnerHeight = gardenInnerHeight;
  const paintExclusions = useMemo(() => {
    if (visibleToasts.length === 0) return undefined;
    const widestMessage = visibleToasts.reduce(
      (acc, t) => Math.max(acc, t.message.length),
      0
    );
    const boxWidth = widestMessage + TOAST_WIDTH_PADDING;
    const stackHeight = visibleToasts.length * TOAST_ROWS_EACH;
    // Toaster's parent has paddingY=1 (parent's content origin row = 2,
    // 1-indexed); marginTop adds further offset.
    const screenTopRow = 1 + 1 + (rows - TOASTER_MARGIN_TOP);
    // The Toaster's `alignSelf="flex-end"` was intended to right-align
    // the box, but the wrapping `position="absolute"` Box defaults to
    // row-direction, so flex-end pushes vertically (cross-axis) rather
    // than horizontally. Toasts render at the LEFT edge of the absolute
    // Box, offset by the parent's paddingX=1 — so left col (1-indexed)
    // is 1 + 1 = 2.
    const screenLeftCol = 1 + 1;
    const localX = screenLeftCol - gardenContentCol;
    const localY = screenTopRow - gardenContentRowForCanvas;
    // Clamp to canvas — over-wide rects waste no work but keep
    // semantics clean. Negative coords are valid (engine renders only
    // the in-bounds intersection) but we trim to keep the mask compact.
    const clampedX = Math.max(0, localX);
    const clampedY = Math.max(0, localY);
    const clampedW = Math.max(
      0,
      Math.min(gardenCanvasInnerWidth - clampedX, boxWidth - (clampedX - localX))
    );
    const clampedH = Math.max(
      0,
      Math.min(gardenCanvasInnerHeight - clampedY, stackHeight - (clampedY - localY))
    );
    if (clampedW <= 0 || clampedH <= 0) return undefined;
    return [{ x: clampedX, y: clampedY, width: clampedW, height: clampedH }];
  }, [
    visibleToastSig,
    rows,
    columns,
    gardenContentCol,
    gardenContentRowForCanvas,
    gardenCanvasInnerWidth,
    gardenCanvasInnerHeight
  ]);

  const sidebar = (width?: number, height?: number, borderColor?: string) => {
    // Content rows = panel height minus 4 rows of chrome (top border, title
    // header, title bottom border, bottom border), (-1) for the inline status
    // row when present, and (-1) for the "home" row, which is always rendered
    // at the top of wide ready sidebars.
    const statusRowCost = latestStatus ? 1 : 0;
    const homeRowCost = 1;
    const totalContent =
      height !== undefined
        ? Math.max(1, height - 4 - statusRowCost - homeRowCost)
        : pagedVisibleCreatures.length + visibleHiddenCreatures.length + 2 + homeRowCost;

    // When "home" is selected no creature is highlighted — the cursor lives
    // on the synthetic top row. Windowing falls back to the natural anchor
    // (top of list) so the list doesn't auto-scroll to a hidden focus.
    const creatureFocusActive = !homeSelected;
    const shownFocus =
      creatureFocusActive && focusIndex < pagedVisibleCreatures.length ? focusIndex : -1;
    const hiddenFocus =
      creatureFocusActive && focusIndex >= pagedVisibleCreatures.length
        ? focusIndex - pagedVisibleCreatures.length
        : -1;

    // Allocate rows between the shown list and the hidden section. The hidden
    // section gets its natural size up to ~1/3 of the panel, leaving the rest
    // for shown so the active list never collapses.
    const hiddenHeader = visibleHiddenCreatures.length > 0 ? 1 : 0;
    const hiddenWish = hiddenHeader + visibleHiddenCreatures.length;
    const hiddenCap = Math.max(2, Math.floor(totalContent / 3));
    const hiddenAllotment = visibleHiddenCreatures.length === 0 ? 0 : Math.min(hiddenWish, hiddenCap);
    const shownAllotment = Math.max(1, totalContent - hiddenAllotment);

    // Window the shown list. Centre on focus when focus is in the shown
    // section; otherwise pin to the top.
    const shownAnchor = shownFocus >= 0 ? shownFocus : 0;
    const shownStart = Math.max(
      0,
      Math.min(shownAnchor - Math.floor(shownAllotment / 2), Math.max(0, pagedVisibleCreatures.length - shownAllotment))
    );
    const shownSliced = pagedVisibleCreatures.slice(shownStart, shownStart + shownAllotment);
    const shownOverflowAfter = pagedVisibleCreatures.length - (shownStart + shownSliced.length);

    // Window the hidden list. Header takes 1 row, leaving the remainder for
    // items (and an "above"/"below" indicator if needed).
    const hiddenItemRows = Math.max(0, hiddenAllotment - hiddenHeader);
    const hiddenAnchor = hiddenFocus >= 0 ? hiddenFocus : 0;
    const hiddenStart = Math.max(
      0,
      Math.min(hiddenAnchor - Math.floor(hiddenItemRows / 2), Math.max(0, visibleHiddenCreatures.length - hiddenItemRows))
    );
    const hiddenSliced = visibleHiddenCreatures.slice(hiddenStart, hiddenStart + hiddenItemRows);
    const hiddenOverflowAfter = visibleHiddenCreatures.length - (hiddenStart + hiddenSliced.length);

    const title = creatureFilter
      ? `creatures · ${visibleCreatures.length}/${shownCreatures.length}`
      : `creatures · ${shownCreatures.length}`;
    const statusVariantColor = (variant: string): string => {
      switch (variant) {
        case "success":
          return theme.colors.success;
        case "error":
          return theme.colors.error;
        case "warning":
          return theme.colors.warning;
        default:
          return theme.colors.info;
      }
    };
    const statusIcon = (variant: string): string => {
      switch (variant) {
        case "success":
          return "✓";
        case "error":
          return "✗";
        case "warning":
          return "⚠";
        default:
          return "ℹ";
      }
    };

    const homeRowFocused = homeSelected;
    const homeRow = (
      <Box key="__home__" flexDirection="row">
        <Text color={homeRowFocused ? theme.colors.primary : theme.colors.mutedForeground}>
          {homeRowFocused ? "›" : " "}
        </Text>
        <Text color={theme.colors.mutedForeground} bold>
          {" ⌂ "}
        </Text>
        <Text
          color={homeRowFocused ? theme.colors.primary : theme.colors.foreground}
          bold={homeRowFocused}
          wrap="truncate-end"
        >
          home
        </Text>
      </Box>
    );

    return (
      <Panel title={title} paddingY={0} width={width} height={height} borderColor={borderColor}>
        {homeRow}
        {visibleCreatures.length === 0 ? (
          isRescanning && !creatureFilter ? (
            <Box flexDirection="column" gap={0}>
              {Array.from({ length: 4 }).map((_, idx) => (
                <Skeleton key={idx} width={Math.max(8, (width ?? 32) - 7)} />
              ))}
            </Box>
          ) : (
            <Text dimColor color={theme.colors.mutedForeground}>
              {creatureFilter ? `no matches for "${creatureFilter}".` : "nothing scanned yet — press r to scan."}
            </Text>
          )
        ) : (
          shownSliced.map((creature, slicedIndex) => {
            const index = shownStart + slicedIndex;
            const focused = index === shownFocus;
            const glyph = vibeGlyph(creature.vibe.vibe);
            const vibeColor =
              creature.vibe.vibe === "stuck"
                ? theme.colors.error
                : creature.vibe.vibe === "awake"
                  ? theme.colors.warning
                  : creature.vibe.vibe === "sleepy"
                    ? theme.colors.info
                    : theme.colors.success;
            const display = creature.scan.name;
            return (
              <Box key={creature.id} flexDirection="row">
                <Text color={focused ? theme.colors.primary : theme.colors.mutedForeground}>
                  {focused ? "›" : " "}
                </Text>
                <Text color={vibeColor} bold>
                  {" " + glyph + " "}
                </Text>
                <Text
                  color={focused ? theme.colors.primary : theme.colors.foreground}
                  bold={focused}
                  wrap="truncate-end"
                >
                  {display}
                </Text>
              </Box>
            );
          })
        )}
        {shownOverflowAfter > 0 ? (
          <Text dimColor color={theme.colors.mutedForeground}>
            +{shownOverflowAfter} more…
          </Text>
        ) : null}
        {shownStart > 0 ? (
          <Text dimColor color={theme.colors.mutedForeground}>
            ↑{shownStart} above
          </Text>
        ) : null}
        {visibleHiddenCreatures.length > 0 ? (
          <Box flexDirection="column" marginTop={1}>
            <Text dimColor color={theme.colors.mutedForeground}>
              hidden · {visibleHiddenCreatures.length}
            </Text>
            {hiddenStart > 0 ? (
              <Text dimColor color={theme.colors.mutedForeground}>
                {`   ↑${hiddenStart} above`}
              </Text>
            ) : null}
            {hiddenSliced.map((creature, slicedIndex) => {
              const index = hiddenStart + slicedIndex;
              const focused = index === hiddenFocus;
              return (
                <Box key={creature.id} flexDirection="row">
                  <Text color={focused ? theme.colors.primary : theme.colors.mutedForeground}>
                    {focused ? "›" : " "}
                  </Text>
                  <Text dimColor={!focused} color={focused ? theme.colors.primary : theme.colors.mutedForeground}>
                    {"  "}
                  </Text>
                  <Text
                    dimColor={!focused}
                    color={focused ? theme.colors.primary : theme.colors.mutedForeground}
                    bold={focused}
                    wrap="truncate-end"
                  >
                    {creature.scan.name}
                  </Text>
                </Box>
              );
            })}
            {hiddenOverflowAfter > 0 ? (
              <Text dimColor color={theme.colors.mutedForeground}>
                {`   +${hiddenOverflowAfter} more…`}
              </Text>
            ) : null}
          </Box>
        ) : null}
        {/* Status pinned to the very bottom of the panel: the spacer
            consumes any remaining content rows so the status sits flush
            against the bottom border, regardless of how many creatures
            the windowing renders. */}
        {latestStatus ? (
          <>
            <Box flexGrow={1} />
            <Box>
              <Text
                color={statusVariantColor(latestStatus.variant)}
                wrap="truncate-end"
              >
                {statusIcon(latestStatus.variant)} {latestStatus.message}
              </Text>
            </Box>
          </>
        ) : null}
      </Panel>
    );
  };

  // A compact variant of the detail card sized for the bottom-right corner
  // of the garden view. Keeps the content dense so it can live in a small
  // overlay without stealing much habitat space.
  const compactDetail = (width: number, height: number) => {
    if (!focus) return null;

    const vibeColor =
      focus.vibe.vibe === "stuck"
        ? theme.colors.error
        : focus.vibe.vibe === "awake"
          ? theme.colors.warning
          : focus.vibe.vibe === "sleepy"
            ? theme.colors.info
            : theme.colors.success;

    const days = focus.vibe.daysSinceCommit;
    const ageText =
      days === undefined ? null : days === 0 ? "today" : days === 1 ? "1d ago" : `${days}d ago`;

    type Chip = { key: string; text: string; color: string; dim?: boolean };
    const chips: Chip[] = [];
    if (focus.scan.branch) {
      // Cap branch so a long branch name can't push later chips off-screen.
      const branch =
        focus.scan.branch.length > 14
          ? `${focus.scan.branch.slice(0, 13)}…`
          : focus.scan.branch;
      chips.push({ key: "branch", text: `⎇ ${branch}`, color: theme.colors.mutedForeground, dim: true });
    }
    if (ageText) {
      chips.push({ key: "age", text: ageText, color: theme.colors.mutedForeground, dim: true });
    }
    if (focus.scan.isDirty) {
      chips.push({ key: "dirty", text: "✎ dirty", color: theme.colors.warning });
    }
    if (focus.scan.ahead) {
      chips.push({ key: "ahead", text: `↑${focus.scan.ahead}`, color: theme.colors.info });
    }
    if (focus.scan.behind) {
      chips.push({ key: "behind", text: `↓${focus.scan.behind}`, color: theme.colors.info });
    }

    const sparkData =
      focus.scan.recentCommitDays && focus.scan.recentCommitDays.some((n) => n > 0)
        ? focus.scan.recentCommitDays
        : null;
    const commitCount = focus.scan.commitCount;

    const blocker = focus.memory.currentBlocker?.split("\n")[0]?.trim();
    const note = focus.memory.noteToFutureSelf?.split("\n")[0]?.trim();
    const memoryLine = blocker
      ? { icon: "⚑", label: "blocker", text: blocker, color: theme.colors.error }
      : note
        ? { icon: "✎", label: "note", text: note, color: theme.colors.mutedForeground }
        : null;

    // When the vibe is "stuck", vibe.reason is already "blocker: <text>" —
    // the memoryLine renders the same content with stronger styling, so we
    // skip the reason line to avoid a back-to-back duplicate.
    const showVibeReason = !(focus.vibe.vibe === "stuck" && blocker);

    // scan.path on the focus is intentionally unmasked so the garden engine
    // keeps stable sprite identity; redact (mask) or remap (demo) for display
    // only.
    const path = privacy.maskPath(tildify(focus.scan.path), focus.id);

    return (
      <Box
        flexDirection="column"
        borderStyle={theme.border.style}
        borderColor={theme.colors.border}
        width={width}
        height={height}
        paddingX={1}
      >
        {/* Header — vibe glyph + repo name (left), language (right). */}
        <Box flexDirection="row" justifyContent="space-between">
          <Box flexShrink={1}>
            <Text bold color={vibeColor}>
              {vibeGlyph(focus.vibe.vibe)}{" "}
            </Text>
            <Text bold color={theme.colors.foreground} wrap="truncate-end">
              {focus.scan.name}
            </Text>
          </Box>
          {focus.scan.primaryLanguage ? (
            <Box flexShrink={0} marginLeft={1}>
              <Text dimColor color={theme.colors.mutedForeground}>
                {focus.scan.primaryLanguage}
              </Text>
            </Box>
          ) : null}
        </Box>

        {/* Sub-header — branch · age · dirty · ahead/behind chips. */}
        {chips.length > 0 ? (
          <Box flexDirection="row">
            {chips.map((chip, index) => (
              <React.Fragment key={chip.key}>
                {index > 0 ? (
                  <Text dimColor color={theme.colors.mutedForeground}>
                    {" · "}
                  </Text>
                ) : null}
                <Text color={chip.color} dimColor={chip.dim}>
                  {chip.text}
                </Text>
              </React.Fragment>
            ))}
          </Box>
        ) : null}

        {/* Sparkline of 30-day commit activity, with total commits on the right. */}
        {sparkData ? (
          <Box flexDirection="row" justifyContent="space-between">
            <Sparkline
              data={sparkData}
              width={Math.max(10, width - (commitCount !== undefined ? 14 : 4))}
              color={vibeColor}
            />
            {commitCount !== undefined ? (
              <Text dimColor color={theme.colors.mutedForeground}>
                {commitCount} total
              </Text>
            ) : null}
          </Box>
        ) : null}

        {/* Vibe reason — colored to match the vibe. */}
        {showVibeReason ? (
          <Box>
            <Text color={vibeColor} wrap="truncate-end">
              {focus.vibe.reason}
            </Text>
          </Box>
        ) : null}

        {/* Last commit subject. */}
        {focus.scan.lastCommitSubject ? (
          <Box>
            <Text dimColor color={theme.colors.mutedForeground} wrap="truncate-end">
              ▸ {focus.scan.lastCommitSubject}
            </Text>
          </Box>
        ) : null}

        {/* Blocker (highest priority) or note — one line, never both. */}
        {memoryLine ? (
          <Box>
            <Text color={memoryLine.color} wrap="truncate-end">
              {memoryLine.icon} {memoryLine.label}: {memoryLine.text}
            </Text>
          </Box>
        ) : null}

        {/* Spacer pushes the footer to the bottom of the fixed-height card. */}
        <Box flexGrow={1} />

        {/* Footer — tildified path (left), workbench hint (right). */}
        <Box flexDirection="row" justifyContent="space-between">
          <Box flexShrink={1}>
            <Text dimColor color={theme.colors.mutedForeground} wrap="truncate-end">
              {path}
            </Text>
          </Box>
          <Box flexShrink={0} marginLeft={1}>
            <Text color={theme.colors.accent}>↵</Text>
            <Text dimColor color={theme.colors.mutedForeground}>
              {" workbench"}
            </Text>
          </Box>
        </Box>
      </Box>
    );
  };

  const compactDetailPlaceholder = (width: number, height: number) => (
    <Box
      flexDirection="column"
      borderStyle={theme.border.style}
      borderColor={theme.colors.border}
      width={width}
      height={height}
      paddingX={1}
    >
      <Box flexGrow={1} />
    </Box>
  );

  const compactFocusSummary = () => {
    const label = focus
      ? `${vibeGlyph(focus.vibe.vibe)} ${focus.scan.name}`
      : homeSelected
        ? "home"
        : "no repo selected";
    // In narrow layouts the top GARDEN badge is dropped to a separate row and
    // the page chip there is easy to miss. Repeat the page indicator inline
    // on the focus-summary row so users always know which page they're on.
    const pageBit =
      isGardenView && gardenPageCount > 1
        ? `page ${safeGardenPageIndex + 1}/${gardenPageCount}`
        : undefined;
    const detailParts = focus
      ? [
          focus.scan.branch ? `branch ${focus.scan.branch}` : undefined,
          focus.scan.primaryLanguage,
          focus.vibe.daysSinceCommit !== undefined ? `${focus.vibe.daysSinceCommit}d ago` : undefined,
          focus.scan.isDirty ? "dirty" : undefined,
          pageBit,
        ]
      : [view === "journal" ? "all repos" : "press r to scan", pageBit];
    const detailText = detailParts.filter(Boolean).join(" · ");
    return (
      <Box flexDirection="row" justifyContent="space-between" columnGap={2}>
        <Text color={focus ? theme.colors.primary : theme.colors.mutedForeground} bold={Boolean(focus)} wrap="truncate-end">
          {label}
        </Text>
        <Box flexShrink={1}>
          <Text dimColor color={theme.colors.mutedForeground} wrap="truncate-end">
            {detailText}
          </Text>
        </Box>
      </Box>
    );
  };

  if (responsive.tier === "too-small") {
    return <ResizePrompt columns={columns} rows={rows} />;
  }

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1} height={rows} overflow="hidden">
      <Box flexDirection="column" ref={chromeRef}>
      <Box
        flexDirection={mode === "narrow" ? "column" : "row"}
        justifyContent="space-between"
        alignItems="flex-start"
      >
        <Box flexDirection="column">
          <Text italic dimColor color={theme.colors.info}>
            a little local habitat
          </Text>
          <Text bold color={theme.colors.foreground}>
            REPOGARDEN
          </Text>
          {/* Tagline row also carries the mask-mode indicator. The indicator
              is appended (not swapped) so the row height stays constant
              regardless of state — no viewport shift on toggle. */}
          <Box flexDirection="row" gap={1}>
            <Text dimColor color={theme.colors.mutedForeground}>
              where your repos live
            </Text>
            {privacy.enabled ? (
              <Text bold color={theme.colors.warning}>
                [◐ mask]
              </Text>
            ) : null}
          </Box>
        </Box>
        <Box
          marginTop={mode === "narrow" ? 1 : 0}
          flexDirection="column"
          alignItems={mode === "narrow" ? "flex-start" : "flex-end"}
          gap={0}
        >
          <Box flexDirection="row" gap={1} alignItems="center">
            {isRescanning ? (
              <>
                <Spinner color={theme.colors.info} />
                {scanProgress && scanProgress.total > 0 ? (
                  <ProgressCircle
                    size="sm"
                    color={theme.colors.info}
                    value={(scanProgress.done / scanProgress.total) * 100}
                    showPercent
                  />
                ) : null}
                <Badge variant="info" bold>
                  SCANNING
                </Badge>
              </>
            ) : (
              <>
                {(
                  [
                    { view: "garden", label: "GARDEN" },
                    { view: "shelf", label: "SHELF" },
                    { view: "journal", label: "JOURNAL" },
                  ] as { view: ReadyView; label: string }[]
                ).map((segment) => {
                  const active = view === segment.view;
                  return (
                    <Badge
                      key={segment.view}
                      color={active ? theme.colors.success : theme.colors.mutedForeground}
                      bold={active}
                    >
                      {segment.label}
                    </Badge>
                  );
                })}
              </>
            )}
          </Box>
          {/* Pagination strip: visual indicator that mirrors the gardenPageIndex
              state ReadyShell already owns. Renders only when there's actually
              more than one page so single-page gardens look untouched, and
              only in wide layouts — narrow mode shows the "page N/M" hint
              inline in the compact focus summary instead. */}
          {!isRescanning && isGardenView && gardenPageCount > 1 && mode !== "narrow" ? (
            <Box marginTop={0}>
              <Pagination total={gardenPageCount} current={safeGardenPageIndex + 1} />
            </Box>
          ) : null}
          {/* Mask-mode indicator lives in the title tagline now (left
              column) so toggling it doesn't shift the viewport — see the
              tagline row above. */}
        </Box>
      </Box>
      {/* roots on the left, vibes on the right of the same row.
          flexDirection="row" + justifyContent="space-between" is exactly
          what termcn's <Columns> renders for a 2-cell layout — Yoga pushes
          the two children to opposite edges. If we ever need three or
          more columns with explicit widths, a thin Columns wrapper would
          be worth adding to components/ui. */}
      {rootsLabel || (!isRescanning && shownCreatures.length > 0) ? (
        <Box paddingTop={1} flexDirection="row" justifyContent="space-between" flexWrap="wrap">
          {rootsLabel ? (
            <Text dimColor color={theme.colors.mutedForeground} wrap="truncate-end">
              roots: {rootsLabel
                .split(" · ")
                .map((root) => privacy.maskPath(tildify(root), `root:${root}`))
                .join(" · ")}
            </Text>
          ) : (
            <Box />
          )}
          {!isRescanning && shownCreatures.length > 0 ? (
            <Box flexDirection="row" gap={2}>
              {(["awake", "happy", "stuck", "sleepy"] as Vibe[]).map((vibe) => {
                const count = shownCreatures.filter((c) => c.vibe.vibe === vibe).length;
                if (count === 0) return null;
                const tone =
                  vibe === "stuck"
                    ? theme.colors.error
                    : vibe === "awake"
                      ? theme.colors.warning
                      : vibe === "sleepy"
                        ? theme.colors.info
                        : theme.colors.success;
                return (
                  <Box key={vibe} flexDirection="row">
                    <Text color={tone} bold>
                      {vibeGlyph(vibe)} {count}{" "}
                    </Text>
                    <Text dimColor color={theme.colors.mutedForeground}>
                      {vibe}
                    </Text>
                  </Box>
                );
              })}
            </Box>
          ) : null}
        </Box>
      ) : null}
      {filterMode || filter ? (
        <Box paddingTop={1} flexDirection="row">
          <Text bold color={theme.colors.accent}>
            /{filter}
          </Text>
          {filterMode ? (
            <Text color={theme.colors.focusRing}>█</Text>
          ) : (
            <Text dimColor color={theme.colors.mutedForeground}>
              {journalActive
                ? " (journal search)"
                : ` (${visibleCreatures.length} match${visibleCreatures.length === 1 ? "" : "es"})`}
            </Text>
          )}
        </Box>
      ) : null}
      {/* Per-root scan progress. Gated on isRescanning + scanProgressByRoot
          rather than scanProgress.total > 0 so the bars appear the moment
          onRootsResolved fires — before any repo has been discovered. With
          slow disks and many roots that initial walking phase used to read
          as a dead spinner; the bars now make it obvious which root is
          taking the time. Single-root scans get one MultiProgress entry
          rather than the old ProgressBar fallback so the visual shape stays
          consistent across scan sizes. */}
      {isRescanning && scanProgressByRoot && scanProgressByRoot.length > 0 ? (
        <Box paddingTop={1} flexDirection="column">
          <MultiProgress
            compact
            barWidth={Math.max(8, Math.min(24, columns - 44))}
            labelWidth={Math.max(12, Math.min(28, Math.floor(columns / 3)))}
            items={scanProgressByRoot.map<MultiProgressItem>((entry) => ({
              id: entry.root,
              label: privacy.maskPath(tildify(entry.root), `root:${entry.root}`),
              value: entry.done,
              total: entry.total,
              status:
                entry.total === 0
                  ? "pending"
                  : entry.done >= entry.total
                    ? "done"
                    : "running",
              statusText: entry.total > 0 ? `${entry.done}/${entry.total}` : undefined,
            }))}
          />
        </Box>
      ) : null}
      {rescanError ? (
        <Box paddingTop={1}>
          <Banner variant="error" title="scan failed">
            {rescanError}
          </Banner>
        </Box>
      ) : null}
      </Box>

      {((displayView === "garden" || displayView === "shelf") && responsive.showSidebar) ? (
        <Box flexDirection="row">
          <Box width={gardenSidebarWidth} flexDirection="column" marginRight={1}>
            {sidebar(gardenSidebarWidth, gardenHeight)}
            <Box flexGrow={1} />
          </Box>
          <Box flexGrow={1} flexDirection="column">
            <GardenView
              creatures={pagedVisibleCreatures}
              focusIndex={gardenFocusIndex}
              width={gardenWidth}
              height={gardenHeight}
              originRow={gardenContentRow}
              originCol={wideGardenContentCol}
              onCreatureSelect={handleGardenCreatureSelect}
              onFocusDelta={handleGardenFocusDelta}
              onCreaturePlacementChange={handleGardenCreaturePlacementChange}
              deadZone={overlayDeadZone}
              paintExclusions={paintExclusions}
              placementMode={habitatPlacementMode}
              density={gardenDensity}
            />
            {overlayCardSlot.reserved ? (
              <Box
                position="absolute"
                marginTop={overlayCardOffsetTop}
                marginLeft={overlayCardOffsetLeft}
                width={overlayCardWidth}
                height={overlayCardHeight}
              >
                {showOverlayCard ? (
                  focus && !gardenShelfTransitioning
                    ? compactDetail(overlayCardWidth, overlayCardHeight)
                    : compactDetailPlaceholder(overlayCardWidth, overlayCardHeight)
                ) : (
                  <Box flexDirection="column">
                    {Array.from({ length: overlayCardHeight }, (_, index) => (
                      <Text key={index}>{" ".repeat(overlayCardWidth)}</Text>
                    ))}
                  </Box>
                )}
              </Box>
            ) : null}
          </Box>
        </Box>
      ) : (displayView === "garden" || displayView === "shelf") ? (
        <Box flexDirection="column">
          {compactFocusSummary()}
          <GardenView
            creatures={pagedVisibleCreatures}
            focusIndex={gardenFocusIndex}
            width={stackedWidth}
            height={gardenHeight}
            originRow={gardenContentRow + 1}
            originCol={stackedGardenContentCol}
            onCreatureSelect={handleGardenCreatureSelect}
            onFocusDelta={handleGardenFocusDelta}
            onCreaturePlacementChange={handleGardenCreaturePlacementChange}
            paintExclusions={paintExclusions}
            placementMode={habitatPlacementMode}
            density={gardenDensity}
          />
        </Box>
      ) : responsive.showSidebar ? (
        // Wide journal: sidebar (creature selection scopes timeline to one
        // repo) + JournalView in the garden's content rect. The two-pane
        // focus model tints whichever pane currently owns ↑↓/jk — the
        // sidebar's Panel border switches to the theme focus ring when
        // `journalFocus === "sidebar"`, JournalView mirrors the same on
        // its own border when `paneFocused`.
        <Box flexDirection="row">
          <Box width={gardenSidebarWidth} flexDirection="column" marginRight={1}>
            {sidebar(
              gardenSidebarWidth,
              gardenHeight,
              journalFocus === "sidebar" ? theme.colors.focusRing : undefined
            )}
            <Box flexGrow={1} />
          </Box>
          <Box flexGrow={1} flexDirection="column">
            <JournalView
              creatures={focusList}
              events={journalEvents}
              width={gardenWidth}
              height={gardenHeight}
              selectedRepoId={homeSelected ? undefined : focus?.scan.id}
              filter={filter}
              isActive={journalActive && !filterMode}
              paneFocused={journalFocus === "pane"}
              onOpenWorkbench={onOpenWorkbench ? (c) => onOpenWorkbench(unmaskById(c.id) ?? c) : undefined}
              onSelectRepo={(id) => {
                if (!id) {
                  setHomeSelected(true);
                  return;
                }
                const index = focusList.findIndex((creature) => creature.id === id);
                if (index >= 0) {
                  setFocusIndex(index);
                  setHomeSelected(false);
                }
              }}
            />
          </Box>
        </Box>
      ) : (
        <Box flexDirection="column">
          {compactFocusSummary()}
          <JournalView
            creatures={focusList}
            events={journalEvents}
            width={stackedWidth}
            height={gardenHeight}
            selectedRepoId={homeSelected ? undefined : focus?.scan.id}
            filter={filter}
            isActive={journalActive && !filterMode}
            paneFocused={journalFocus === "pane"}
            onOpenWorkbench={onOpenWorkbench ? (c) => onOpenWorkbench(unmaskById(c.id) ?? c) : undefined}
            onSelectRepo={(id) => {
              if (!id) {
                setHomeSelected(true);
                return;
              }
              const index = focusList.findIndex((creature) => creature.id === id);
              if (index >= 0) {
                setFocusIndex(index);
                setHomeSelected(false);
              }
            }}
          />
        </Box>
      )}

      {/*
        Toaster floats absolutely at the bottom-right so its appearance and
        dismissal can't shove the rest of the column around. When it lived
        in flow, a 3-row toast pushed the garden up by 3 rows; the
        starfield + sprite painters write to absolute screen coords, so they
        ended up painting at stale positions until the next layout settled —
        the visible "flicker" on startup the user reported.

        marginTop bumped up by 2 rows (rows-7 → rows-9) so the toast sits
        clearly inside the garden panel instead of straddling its bottom
        border — the toast box is 3 rows tall, the footer below the panel
        is 1–2 rows, so rows-7 put the toast bottom border on the same row
        as the panel bottom border (manual-qa-report B8).
      */}
      <Box
        position="absolute"
        marginTop={Math.max(0, rows - 9)}
        width={Math.max(0, columns - 2)}
      >
        <Toaster />
      </Box>
      {ditherStartedAt !== null ? (
        // Inset by one cell on every side so the Panel border stays clean —
        // gardenContentRow/wideGardenContentCol already sit inside the
        // border + the Panel's 1-cell pad, so backing each up by 1 puts the
        // origin on the paddingX/paddingY row, and the dimensions exclude
        // just the borders (gardenWidth − 2, gardenHeight − 2).
        <DitherOverlay
          originRow={(responsive.showSidebar ? gardenContentRow : gardenContentRow + 1) - 1}
          originCol={(responsive.showSidebar ? wideGardenContentCol : stackedGardenContentCol) - 1}
          width={(responsive.showSidebar ? gardenWidth : stackedWidth) - 2}
          height={gardenHeight - 2}
          startedAt={ditherStartedAt}
          durationMs={TRANSITION_MS}
        />
      ) : null}
      {/* Spacer absorbs the gap between the natural-height list content and
          the footer so Ink emits blank lines for the remainder of the
          terminal. Without it, switching from garden/shelf (which fills the
          column via an explicit-height GardenView) to list (sidebar+detail
          size to content) leaves rows below the list painted with the
          previous frame's pixels — the visible "freeze in the prior view"
          on view switch. */}
      <Box flexGrow={1} />
      <Box
        flexDirection="row"
        justifyContent="space-between"
        columnGap={2}
        alignItems="flex-end"
      >
        <Box flexShrink={1}>
          <Text dimColor color={theme.colors.mutedForeground} wrap="truncate-end">
            {journalActive
              ? "↑↓/jk scroll · esc switch pane · ↵ workbench · / search · g view · s settings · ? help"
              : isGardenView && gardenPageCount > 1
                ? "↑↓ move · ↵ open · / filter · g view · [] page · s settings · ? help · q quit"
                : "↑↓ move · ↵ open · / filter · g view · s settings · ? help · q quit"}
          </Text>
        </Box>
        <Box flexDirection="row" columnGap={2} flexShrink={0} alignItems="flex-end">
          {responsive.showUsageFooter ? (
            usage.length > 0 ? (
              <UsageBar items={usage} inline />
            ) : (
              <UsageBarPlaceholder />
            )
          ) : null}
          <Credit />
        </Box>
      </Box>
    </Box>
  );
};
