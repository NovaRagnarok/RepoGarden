import { Text, useStdout } from "ink";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";

import { Panel } from "@/components/ui/panel";
import { useMotion, useTheme } from "@/components/ui/theme-provider";
import { useMouse } from "@/hooks/use-mouse";
import { GardenEngine } from "@/garden/engine";
import type {
  GardenDeadZone,
  GardenEngineProps,
  GardenPaintExclusion,
  GardenTopRightDeadZone,
  GardenThemeColors
} from "@/garden/types";
import type { GardenDensity } from "@/lib/garden-layout";
import type { RepoCreature } from "@/lib/creature";
import type { Vibe } from "@/lib/vibe";

export interface GardenViewProps {
  creatures: RepoCreature[];
  focusIndex: number;
  width: number;
  height?: number;
  originRow?: number;
  originCol?: number;
  onCreatureSelect?: (index: number) => void;
  onFocusDelta?: (delta: number) => void;
  onCreaturePlacementChange?: (changes: Array<{
    creature: RepoCreature;
    offset: { offsetX: number; offsetY: number };
  }>) => void;
  deadZone?: GardenDeadZone;
  topRightDeadZone?: GardenTopRightDeadZone;
  paintExclusions?: GardenPaintExclusion[];
  placementMode?: "organic" | "rooms";
  density?: GardenDensity;
  roomsPageIndex?: Partial<Record<Vibe, number>>;
}

const toGardenTheme = (colors: GardenThemeColors): GardenThemeColors => colors;

const GardenViewInner = ({
  creatures,
  focusIndex,
  width,
  height,
  originRow,
  originCol,
  onCreatureSelect,
  onFocusDelta,
  onCreaturePlacementChange,
  deadZone,
  topRightDeadZone,
  paintExclusions,
  placementMode = "organic",
  density = "comfortable",
  roomsPageIndex
}: GardenViewProps) => {
  const theme = useTheme();
  const { reduced: reducedMotion } = useMotion();
  const { stdout } = useStdout();
  const innerWidth = Math.max(20, width - 4);
  const canvasH = Math.max(10, (height ?? 22) - 4);
  const engineRef = useRef<GardenEngine | null>(null);

  // Serialize the exclusion list for the memo's dep array — a fresh
  // empty/identical-shape array on every parent render would otherwise
  // re-identify engineProps every tick.
  const paintExclusionsKey = useMemo(
    () =>
      (paintExclusions ?? [])
        .map((rect) => `${rect.x},${rect.y},${rect.width},${rect.height}`)
        .join("|"),
    [paintExclusions]
  );
  // Stable serialization of the per-vibe page indexes so the engineProps
  // memo only re-fires when a value actually changes (the prop object
  // reference itself changes every render).
  const roomsPageIndexKey = useMemo(() => {
    if (!roomsPageIndex) return "";
    return Object.keys(roomsPageIndex)
      .sort()
      .map((k) => `${k}:${roomsPageIndex[k as Vibe] ?? 0}`)
      .join("|");
  }, [roomsPageIndex]);

  const engineProps = useMemo<GardenEngineProps | null>(() => {
    if (originRow === undefined || originCol === undefined) return null;
    return {
      creatures,
      focusIndex,
      innerWidth,
      canvasH,
      originRow,
      originCol,
      onCreatureSelect,
      onFocusDelta,
      onCreaturePlacementChange,
      deadZone,
      topRightDeadZone,
      paintExclusions,
      placementMode,
      density,
      roomsPageIndex,
      reducedMotion,
      theme: toGardenTheme({
        foreground: theme.colors.foreground,
        background: theme.colors.background,
        muted: theme.colors.muted,
        mutedForeground: theme.colors.mutedForeground,
        primary: theme.colors.primary,
        accent: theme.colors.accent,
        success: theme.colors.success,
        warning: theme.colors.warning,
        error: theme.colors.error,
        info: theme.colors.info,
        creaturePalette: theme.creaturePalette
      })
    };
  }, [
    creatures,
    focusIndex,
    innerWidth,
    canvasH,
    originRow,
    originCol,
    onCreatureSelect,
    onFocusDelta,
    onCreaturePlacementChange,
    deadZone,
    topRightDeadZone,
    // paintExclusions intentionally omitted — paintExclusionsKey above
    // serializes its content so identical-shape arrays don't churn the
    // engineProps reference (and therefore don't trigger setProps every
    // render). Kept in the closure via the memo body, not the dep list.
    paintExclusionsKey,
    placementMode,
    density,
    roomsPageIndexKey,
    reducedMotion,
    theme.colors.foreground,
    theme.colors.background,
    theme.colors.mutedForeground,
    theme.colors.primary,
    theme.colors.accent,
    theme.colors.success,
    theme.colors.warning,
    theme.colors.error,
    theme.colors.info,
    theme.creaturePalette
  ]);

  const hasEngineProps = engineProps !== null;
  const hasCreatures = creatures.length > 0;
  const canvasKey =
    engineProps === null
      ? "none"
      : [
          engineProps.originRow,
          engineProps.originCol,
          engineProps.innerWidth,
          engineProps.canvasH,
          engineProps.deadZone?.width ?? 0,
          engineProps.deadZone?.height ?? 0,
          engineProps.topRightDeadZone?.width ?? 0,
          engineProps.topRightDeadZone?.height ?? 0
        ].join(":");

  useLayoutEffect(() => {
    if (!stdout || !engineProps || !hasCreatures) {
      engineRef.current?.destroy();
      engineRef.current = null;
      return;
    }
    if (!engineRef.current) {
      engineRef.current = new GardenEngine(stdout, engineProps);
    }
    return () => {
      engineRef.current?.destroy();
      engineRef.current = null;
    };
  }, [stdout, hasEngineProps, hasCreatures]);

  useLayoutEffect(() => {
    if (!engineRef.current || !engineProps || creatures.length === 0) return;
    engineRef.current.setProps(engineProps);
  }, [engineProps, creatures.length]);

  useLayoutEffect(() => {
    if (!engineRef.current || creatures.length === 0) return;
    // Ink still commits the host panel's blank rows for the canvas placeholder.
    // Repaint the full garden after each GardenView commit so focus changes and
    // other real garden updates cannot leave partially-erased sprites behind.
    engineRef.current.repaintFull();
  });

  useEffect(() => {
    if (!engineRef.current || !hasCreatures) return;
    const id = setTimeout(() => {
      engineRef.current?.repaintFullFor(700);
    }, 0);
    return () => clearTimeout(id);
  }, [canvasKey, hasCreatures]);

  const handleMouse = useCallback((event: { kind: string; row: number; col: number; button: string }) => {
    engineRef.current?.handleMouse(event as never);
  }, []);
  useMouse(handleMouse, { isActive: creatures.length > 0 });

  if (creatures.length === 0) {
    // We reach this only when the filter/hidden list collapses to nothing
    // (a true zero-result scan routes to OnboardingScreen's contextual
    // empty-state instead). Stay terse — the user is one keystroke away
    // from clearing the filter.
    return (
      <Panel paddingY={1} width={width} height={height}>
        <Text dimColor color={theme.colors.mutedForeground}>
          empty plot — press r to rescan, / to clear a filter, or p to edit roots.
        </Text>
      </Panel>
    );
  }

  return (
    <Panel paddingY={1} width={width} height={height} />
  );
};

export const GardenView = GardenViewInner;
