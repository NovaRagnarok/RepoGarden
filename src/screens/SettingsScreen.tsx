import { Box, Text, measureElement, type DOMElement } from "ink";
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from "react";

import { Badge } from "@/components/ui/badge";
import { Credit } from "@/components/Credit";
import { Panel } from "@/components/ui/panel";
import { ThemeProvider, useTheme, type Theme } from "@/components/ui/theme-provider";
import { useInput } from "@/hooks/use-input";
import { useMouse } from "@/hooks/use-mouse";
import { layoutMode, useTerminalSize } from "@/hooks/use-terminal-size";
import { themeCatalogue } from "@/themes";
import { ResizePrompt } from "@/components/ResizePrompt";
import { getTerminalLayout } from "@/lib/responsive-layout";
import {
  generateCreatureFrames,
  pickSpriteColors,
  quadrantChar
} from "@/lib/sprite";
import {
  computeStarVisual,
  greyHex,
  sceneSeedForCreatures,
  starAtCell
} from "@/garden/stars";
import { wiggleFrameAt } from "@/garden/model";
import { vibeColor, vibeGlyph, type Vibe } from "@/lib/vibe";
import type { GardenDensity } from "@/lib/garden-layout";
import type { GitHubCloneProtocol } from "@/lib/config";
import { DEMO_NAMES, demoVibeFor } from "@/lib/demo-roster";

export interface SettingsScreenProps {
  currentThemeId: string;
  reducedMotion?: boolean;
  usageBarDisabled?: boolean;
  observerEnabled?: boolean;
  gardenPaginate?: boolean;
  gardenDensity?: GardenDensity;
  bellOnVibeChange?: boolean;
  githubEnabled?: boolean;
  githubIncludePrivate?: boolean;
  githubCloneProtocol?: GitHubCloneProtocol;
  githubRepoCount?: number;
  onPickTheme: (id: string) => void;
  onToggleReducedMotion?: () => void;
  onToggleUsageBar?: () => void;
  onToggleObserver?: () => void;
  onToggleGardenPaginate?: () => void;
  onCycleGardenDensity?: () => void;
  onToggleBellOnVibeChange?: () => void;
  onToggleGitHub?: () => void;
  onToggleGitHubPrivate?: () => void;
  onCycleGitHubCloneProtocol?: () => void;
  onRefreshGitHub?: () => void;
  /** Fire a single BEL right now so the user can verify their terminal
   *  passes `\x07` through audibly (or visibly). Independent of the
   *  toggle state — the test rings even when the persistent bell is off. */
  onTestBell?: () => void;
  onClose: () => void;
}

// Panel chrome rows above the content area: outer top border (1) + the title
// chip (single-border Box: top + text + bottom = 3). See components/ui/panel.tsx.
const PANEL_CONTENT_TOP_OFFSET = 4;
// Panel chrome rows below the content area: outer bottom border (1).
const PANEL_CONTENT_BOTTOM_OFFSET = 1;
const PANEL_CHROME_TOTAL = PANEL_CONTENT_TOP_OFFSET + PANEL_CONTENT_BOTTOM_OFFSET;

const SUB_PER_CELL = 2;

// A second click on the same theme row within this window counts as a
// double-click and applies the theme. First click only sets focus → previews.
const DOUBLE_CLICK_MS = 450;

// ---- mini garden preview --------------------------------------------------

interface PreviewCell {
  char: string;
  fg: string;
  bold?: boolean;
}

interface PreviewSprite {
  identity: string;
  name: string;
  vibe: Vibe;
  /** Top-left of the sprite cells, inside the preview canvas. */
  x: number;
  y: number;
  charW: number;
  charH: number;
  /** Row where the vibe glyph + name label paints (sprite bottom + 1). */
  labelRow: number;
  /** Column where the label starts (centered to sprite under-width). */
  labelStart: number;
  labelText: string;
}

// Lay out as many creatures as fit in the preview canvas, in a 4-wide x 3-tall
// sprite grid with a single label row beneath each. Each entry is sourced from
// the demo roster so a theme swap shows the full palette spread + every vibe
// glyph at once — the previous 2-sprite preview wasn't enough garden to read
// the theme's character.
const buildPreviewSprites = (innerW: number, innerH: number): PreviewSprite[] => {
  const charW = 4;
  const charH = 3;
  // Each creature occupies charH + 1 (label) rows of vertical space. We need
  // one row of starfield padding on top so creatures don't crowd the panel
  // header. Each column needs charW cells; we pad columns by 3 cells so the
  // labels have breathing room.
  const colSpacing = 3;
  const colWidth = charW + colSpacing;
  const rowSpacing = 2;
  const rowHeight = charH + 1 + rowSpacing;
  const topPad = 1;
  const cols = Math.max(1, Math.floor((innerW - 1) / colWidth));
  const rows = Math.max(1, Math.floor((innerH - topPad) / rowHeight));
  const count = Math.min(DEMO_NAMES.length, cols * rows);
  // Centre the grid horizontally so leftover cells distribute evenly on both
  // sides — keeps the preview from feeling left-anchored on wide panels.
  const usedW = cols * charW + (cols - 1) * colSpacing;
  const leftOffset = Math.max(0, Math.floor((innerW - usedW) / 2));
  const sprites: PreviewSprite[] = [];
  for (let i = 0; i < count; i += 1) {
    const r = Math.floor(i / cols);
    const c = i % cols;
    const x = leftOffset + c * colWidth;
    const y = topPad + r * rowHeight;
    const name = DEMO_NAMES[i] as string;
    const identity = `demo:${name}`;
    // Label is "<glyph> <space> <truncated-name>" — same shape as the real
    // garden's name strip. Truncate name so the label never exceeds the
    // column width.
    const maxNameLen = Math.max(2, colWidth - 2);
    const shortName = name.length > maxNameLen ? `${name.slice(0, maxNameLen - 1)}…` : name;
    const labelText = shortName;
    const labelStart = x + Math.floor((charW - labelText.length) / 2);
    sprites.push({
      identity,
      name,
      vibe: demoVibeFor(identity),
      x,
      y,
      charW,
      charH,
      labelRow: y + charH,
      labelStart,
      labelText
    });
  }
  return sprites;
};

const renderRow = (cells: PreviewCell[], key: number): React.ReactNode => {
  // Run-length encode consecutive cells with the same color into a single
  // <Text> — without this each row becomes 30-60 Ink nodes.
  const groups: { fg: string; chars: string; bold: boolean }[] = [];
  for (const cell of cells) {
    const last = groups[groups.length - 1];
    const bold = cell.bold === true;
    if (last && last.fg === cell.fg && last.bold === bold) {
      last.chars += cell.char;
    } else {
      groups.push({ fg: cell.fg, chars: cell.char, bold });
    }
  }
  // dimColor on the preview cells visually demotes the mini sprites so the
  // eye doesn't expect them to be hot the way the main garden's creatures are.
  return (
    <Box key={key} flexDirection="row">
      {groups.map((g, i) => (
        <Text key={i} color={g.fg} bold={g.bold} dimColor>
          {g.chars}
        </Text>
      ))}
    </Box>
  );
};

interface SettingsPreviewProps {
  theme: Theme;
  themeLabel: string;
  isAppliedTheme: boolean;
  reducedMotion: boolean;
  width: number;
  height: number;
}

const SettingsPreview = ({
  theme,
  themeLabel,
  isAppliedTheme,
  reducedMotion,
  width,
  height
}: SettingsPreviewProps) => {
  const [now, setNow] = useState<number>(() => performance.now());

  useEffect(() => {
    if (reducedMotion) return;
    const id = setInterval(() => setNow(performance.now()), 100);
    return () => clearInterval(id);
  }, [reducedMotion]);

  const innerW = Math.max(10, width - 4); // outer borders (2) + paddingX (2)
  const innerH = Math.max(5, height - PANEL_CHROME_TOTAL);

  const sceneSeed = useMemo(() => sceneSeedForCreatures("settings-preview"), []);

  const sprites = useMemo(() => buildPreviewSprites(innerW, innerH), [innerW, innerH]);
  const spriteFrames = useMemo(
    () =>
      sprites.map((sprite) => {
        const { frameA, frameB } = generateCreatureFrames(
          sprite.identity,
          sprite.charW,
          sprite.charH
        );
        const { body } = pickSpriteColors(sprite.identity, theme.creaturePalette);
        return {
          sprite,
          frameA,
          frameB,
          body,
          wiggle: { halfCycleMs: sprite.vibe === "happy" ? 2200 : 4200, phaseMs: 0 }
        };
      }),
    [
      sprites,
      theme.colors.primary,
      theme.colors.accent,
      theme.colors.success,
      theme.colors.warning,
      theme.colors.error,
      theme.colors.info
    ]
  );

  // Whole preview canvas is treated as one continuous scene: starfield
  // background + sprite grid + vibe-glyph-and-name labels. The previous
  // swatch rows are gone — the creature bodies already showcase the palette
  // and the vibe glyphs the four vibe accent colors, so the swatch grid was
  // duplicating signal that the herd already carries.
  const cells: PreviewCell[][] = [];
  for (let y = 0; y < innerH; y += 1) {
    const row: PreviewCell[] = [];
    for (let x = 0; x < innerW; x += 1) {
      const star = starAtCell(sceneSeed, x, y);
      if (!star) {
        row.push({ char: " ", fg: theme.colors.background });
        continue;
      }
      const { grey, glyph } = computeStarVisual(star, now, reducedMotion);
      row.push({ char: glyph, fg: greyHex(grey) });
    }
    cells.push(row);
  }
  const toneFor = (v: Vibe): string => vibeColor(v, theme.colors);
  for (const { sprite, frameA, frameB, body, wiggle } of spriteFrames) {
    const useFrameB = !reducedMotion && wiggleFrameAt(wiggle, now) === 1;
    const frame = useFrameB ? frameB : frameA;
    for (let cy = 0; cy < sprite.charH; cy += 1) {
      for (let cx = 0; cx < sprite.charW; cx += 1) {
        const targetY = sprite.y + cy;
        const targetX = sprite.x + cx;
        if (targetY < 0 || targetY >= innerH) continue;
        if (targetX < 0 || targetX >= innerW) continue;
        const sy = cy * SUB_PER_CELL;
        const sx = cx * SUB_PER_CELL;
        const tl = frame[sy]?.[sx] === 1;
        const tr = frame[sy]?.[sx + 1] === 1;
        const bl = frame[sy + 1]?.[sx] === 1;
        const br = frame[sy + 1]?.[sx + 1] === 1;
        if (!(tl || tr || bl || br)) continue;
        cells[targetY][targetX] = { char: quadrantChar(tl, tr, bl, br), fg: body };
      }
    }
    // Vibe glyph painted at the left edge of the sprite column on the label
    // row; name truncated to fit centered beneath the sprite. Mirrors the
    // real garden's "<glyph> <name>" treatment so the preview reads as a
    // shrunken garden, not a separate UI.
    if (sprite.labelRow >= 0 && sprite.labelRow < innerH) {
      const glyphCol = sprite.x;
      if (glyphCol >= 0 && glyphCol < innerW) {
        cells[sprite.labelRow][glyphCol] = {
          char: vibeGlyph(sprite.vibe),
          fg: toneFor(sprite.vibe),
          bold: true
        };
      }
      for (let i = 0; i < sprite.labelText.length; i += 1) {
        const col = sprite.labelStart + i;
        if (col < 0 || col >= innerW) continue;
        // Don't overwrite the glyph cell if the centered label happened to
        // align with it.
        if (col === glyphCol) continue;
        cells[sprite.labelRow][col] = {
          char: sprite.labelText[i] as string,
          fg: theme.colors.foreground
        };
      }
    }
  }

  while (cells.length < innerH) {
    cells.push(
      Array.from({ length: innerW }, () => ({ char: " ", fg: theme.colors.background }))
    );
  }
  if (cells.length > innerH) cells.length = innerH;

  const title = isAppliedTheme
    ? `preview · ${themeLabel} (applied)`
    : `preview · ${themeLabel}`;
  return (
    <Panel title={title} paddingY={0}>
      <Box flexDirection="column">{cells.map((row, i) => renderRow(row, i))}</Box>
    </Panel>
  );
};

// ---- preference row -------------------------------------------------------

interface PrefRowProps {
  hotkey: string;
  label: string;
  indicator: string;
  indicatorColor: string;
  labelColor: string;
}

// Indicator sits on the left so it reads next to the option name instead of
// floating at the far right of the row. The fixed-width column (wide enough
// for the longest density value, "comfortable") aligns the labels vertically
// across all five rows.
const PREF_INDICATOR_WIDTH = 12;

const PrefRow = ({ hotkey, label, indicator, indicatorColor, labelColor }: PrefRowProps) => (
  <Box flexDirection="row">
    <Box flexShrink={0} width={PREF_INDICATOR_WIDTH}>
      <Text color={indicatorColor} wrap="truncate-end">
        {indicator}
      </Text>
    </Box>
    <Box flexShrink={1} flexGrow={1}>
      <Text color={labelColor} wrap="truncate-end">
        <Text bold>{hotkey}</Text> {label}
      </Text>
    </Box>
  </Box>
);

// ---- settings screen ------------------------------------------------------

export const SettingsScreen = ({
  currentThemeId,
  reducedMotion = false,
  usageBarDisabled = true,
  observerEnabled = true,
  gardenPaginate = true,
  gardenDensity = "comfortable",
  bellOnVibeChange = false,
  githubEnabled = false,
  githubIncludePrivate = true,
  githubCloneProtocol = "ssh",
  githubRepoCount = 0,
  onPickTheme,
  onToggleReducedMotion,
  onToggleUsageBar,
  onToggleObserver,
  onToggleGardenPaginate,
  onCycleGardenDensity,
  onToggleBellOnVibeChange,
  onToggleGitHub,
  onToggleGitHubPrivate,
  onCycleGitHubCloneProtocol,
  onRefreshGitHub,
  onTestBell,
  onClose
}: SettingsScreenProps) => {
  const appliedTheme = useTheme();
  const { columns, rows } = useTerminalSize();
  const responsive = getTerminalLayout(columns, rows);
  const mode = layoutMode(columns);
  // Compact mode kicks in when the full stack (header + prefs + min 4 themes
  // + four-line footer + padding) would overflow the container. Worst-case
  // chrome cost (narrow header):
  //   header(6) + prefs(15) + themes-chrome(5) + footer(5) + paddingY(2) = 33
  // Plus min pageSize 4 + container off-by-one (1) = 34 rows. Below that we
  // switch to a tab bar that shows one section at a time, so no option ever
  // gets clipped.
  const compactMode = rows < 38;
  // reservedRows is the chrome cost that's subtracted from rows to derive
  // pageSize. We use the worst-case (narrow) numbers so themes content never
  // overflows the container — at wide widths this just leaves ~2 rows of
  // margin, which is fine.
  //   compact: header(6) + tab(1) + themes-chrome(5) + footer(3) + padding(2) + container off-by-one(1) = 18
  //   non-compact: header(6) + prefs(15) + themes-chrome(5) + footer(5) + padding(2) + container off-by-one(1) = 34
  const reservedRows = compactMode ? 18 : 34;
  const pageSize = Math.max(4, Math.min(themeCatalogue.length, rows - reservedRows));
  const containerHeight = Math.max(8, rows - 1);
  const startIndex = Math.max(
    0,
    themeCatalogue.findIndex((choice) => choice.id === currentThemeId)
  );
  const [focusIndex, setFocusIndex] = useState(startIndex === -1 ? 0 : startIndex);
  const [compactSection, setCompactSection] = useState<"themes" | "prefs">("themes");

  const headerRef = useRef<DOMElement | null>(null);
  const motionPanelRef = useRef<DOMElement | null>(null);
  const [headerHeight, setHeaderHeight] = useState(0);
  const [motionHeight, setMotionHeight] = useState(0);
  const lastThemeClickRef = useRef<{ themeIndex: number; time: number } | null>(null);

  // Side-by-side themes + preview when there's enough horizontal room. Need
  // ~32 cols for the preview to fit two mini sprites + swatches, plus ~28 for
  // a usable themes panel + the gap + outer padding. Compact mode disables
  // it — vertical room is tight enough that the preview can't share screen
  // real-estate with the themes list.
  const sideBySide = !compactMode && mode !== "narrow" && columns >= 62;
  const innerContentW = Math.max(10, columns - 2); // outer paddingX (1 each side)
  const previewWidth = sideBySide ? Math.max(30, Math.floor(innerContentW * 0.48)) : 0;
  const themesWidth = sideBySide
    ? Math.max(20, innerContentW - previewWidth - 1)
    : innerContentW;

  useInput((input, key) => {
    if (compactMode && key.tab) {
      setCompactSection((current) => (current === "themes" ? "prefs" : "themes"));
      return;
    }
    if (key.upArrow) {
      setFocusIndex((current) => Math.max(0, current - 1));
      return;
    }
    if (key.downArrow) {
      setFocusIndex((current) => Math.min(themeCatalogue.length - 1, current + 1));
      return;
    }
    if (key.return) {
      const choice = themeCatalogue[focusIndex];
      if (choice) {
        onPickTheme(choice.id);
      }
      return;
    }
    if (input === "m" && onToggleReducedMotion) {
      onToggleReducedMotion();
      return;
    }
    if (input === "u" && onToggleUsageBar) {
      onToggleUsageBar();
      return;
    }
    if (input === "o" && onToggleObserver) {
      onToggleObserver();
      return;
    }
    if (input === "p" && onToggleGardenPaginate) {
      onToggleGardenPaginate();
      return;
    }
    if (input === "g" && onCycleGardenDensity) {
      onCycleGardenDensity();
      return;
    }
    if (input === "b" && onToggleBellOnVibeChange) {
      onToggleBellOnVibeChange();
      return;
    }
    if (input === "B" && onTestBell) {
      onTestBell();
      return;
    }
    if (input === "G" && onToggleGitHub) {
      onToggleGitHub();
      return;
    }
    if (input === "v" && onToggleGitHubPrivate) {
      onToggleGitHubPrivate();
      return;
    }
    if (input === "C" && onCycleGitHubCloneProtocol) {
      onCycleGitHubCloneProtocol();
      return;
    }
    if (input === "R" && onRefreshGitHub) {
      onRefreshGitHub();
      return;
    }
    if (key.escape || input === "q") {
      onClose();
    }
  });

  const windowStart = Math.max(0, Math.min(focusIndex - Math.floor(pageSize / 2), themeCatalogue.length - pageSize));
  const visible = themeCatalogue.slice(windowStart, windowStart + pageSize);

  const focused = themeCatalogue[focusIndex];
  // The whole settings subtree re-renders in the focused theme so chrome,
  // borders, badges, swatches, and accent colors all preview at once. The
  // persisted theme only changes on Enter / double-click via onPickTheme.
  const previewTheme = focused?.theme ?? appliedTheme;
  const previewIsApplied = focused?.id === currentThemeId;

  useLayoutEffect(() => {
    if (headerRef.current) {
      setHeaderHeight(measureElement(headerRef.current).height);
    }
    if (motionPanelRef.current) {
      setMotionHeight(measureElement(motionPanelRef.current).height);
    }
  });

  const hitZones = useMemo(() => {
    type PrefKind =
      | "motion"
      | "usage"
      | "observer"
      | "paginate"
      | "density"
      | "bell"
      | "test-bell"
      | "github"
      | "github-private"
      | "github-protocol"
      | "github-refresh";
    type TabKind = "tab-themes" | "tab-prefs";
    type Zone =
      | {
          kind: PrefKind | TabKind;
          topRow: number;
          bottomRow: number;
          leftCol: number;
          rightCol: number;
        }
      | {
          kind: "theme";
          themeIndex: number;
          topRow: number;
          bottomRow: number;
          leftCol: number;
          rightCol: number;
        };
    const zones: Zone[] = [];
    if (headerHeight === 0) return zones;

    const innerLeft = 2;
    const innerRight = Math.max(innerLeft, innerLeft + innerContentW - 1);
    const prefKinds: PrefKind[] = [
      "motion",
      "usage",
      "observer",
      "paginate",
      "density",
      "bell",
      "test-bell",
      "github",
      "github-private",
      "github-protocol",
      "github-refresh"
    ];

    if (compactMode) {
      // Tab bar lives in a single row directly below the header. Labels are
      // "[ themes ]" (10 chars) and "[ prefs ]" (9 chars) separated by a
      // space, so the prefs label starts at innerLeft + 11.
      const tabRow = 2 + headerHeight;
      zones.push({
        kind: "tab-themes",
        topRow: tabRow,
        bottomRow: tabRow,
        leftCol: innerLeft,
        rightCol: innerLeft + 9
      });
      zones.push({
        kind: "tab-prefs",
        topRow: tabRow,
        bottomRow: tabRow,
        leftCol: innerLeft + 11,
        rightCol: innerLeft + 19
      });

      const sectionTop = tabRow + 1;
      if (compactSection === "prefs") {
        const contentTop = sectionTop + PANEL_CONTENT_TOP_OFFSET;
        prefKinds.forEach((kind, i) => {
          zones.push({
            kind,
            topRow: contentTop + i,
            bottomRow: contentTop + i,
            leftCol: innerLeft,
            rightCol: innerRight
          });
        });
      } else {
        const contentTop = sectionTop + PANEL_CONTENT_TOP_OFFSET;
        for (let i = 0; i < visible.length; i += 1) {
          zones.push({
            kind: "theme",
            themeIndex: windowStart + i,
            topRow: contentTop + i,
            bottomRow: contentTop + i,
            leftCol: innerLeft,
            rightCol: innerLeft + themesWidth - 1
          });
        }
      }
      return zones;
    }

    if (motionHeight === 0) return zones;

    const prefsTop = 2 + headerHeight;
    const prefsContentTop = prefsTop + PANEL_CONTENT_TOP_OFFSET;
    prefKinds.forEach((kind, i) => {
      zones.push({
        kind,
        topRow: prefsContentTop + i,
        bottomRow: prefsContentTop + i,
        leftCol: innerLeft,
        rightCol: innerRight
      });
    });

    const themesPanelTop = prefsTop + motionHeight;
    const themesContentTop = themesPanelTop + PANEL_CONTENT_TOP_OFFSET;
    for (let i = 0; i < visible.length; i += 1) {
      zones.push({
        kind: "theme",
        themeIndex: windowStart + i,
        topRow: themesContentTop + i,
        bottomRow: themesContentTop + i,
        leftCol: innerLeft,
        rightCol: innerLeft + themesWidth - 1
      });
    }
    return zones;
  }, [
    compactMode,
    compactSection,
    headerHeight,
    motionHeight,
    visible.length,
    windowStart,
    innerContentW,
    themesWidth
  ]);

  const themesScrollBounds = useMemo(() => {
    if (headerHeight === 0) return null;
    if (compactMode) {
      if (compactSection !== "themes") return null;
      const top = 2 + headerHeight + 1;
      const bottom =
        top + PANEL_CONTENT_TOP_OFFSET + visible.length + PANEL_CONTENT_BOTTOM_OFFSET - 1;
      return { top, bottom, left: 2, right: 2 + themesWidth - 1 };
    }
    if (motionHeight === 0) return null;
    const top = 2 + headerHeight + motionHeight;
    const bottom =
      top + PANEL_CONTENT_TOP_OFFSET + visible.length + PANEL_CONTENT_BOTTOM_OFFSET - 1;
    return { top, bottom, left: 2, right: 2 + themesWidth - 1 };
  }, [compactMode, compactSection, headerHeight, motionHeight, visible.length, themesWidth]);

  useMouse(
    useCallback(
      (event) => {
        if (event.kind === "wheel") {
          if (!themesScrollBounds) return;
          if (
            event.row < themesScrollBounds.top ||
            event.row > themesScrollBounds.bottom ||
            event.col < themesScrollBounds.left ||
            event.col > themesScrollBounds.right
          )
            return;
          if (event.button === "wheel-up") {
            setFocusIndex((current) => Math.max(0, current - 1));
          } else if (event.button === "wheel-down") {
            setFocusIndex((current) => Math.min(themeCatalogue.length - 1, current + 1));
          }
          return;
        }
        if (event.kind !== "press" || event.button !== "left") return;
        for (const zone of hitZones) {
          if (
            event.row >= zone.topRow &&
            event.row <= zone.bottomRow &&
            event.col >= zone.leftCol &&
            event.col <= zone.rightCol
          ) {
            if (zone.kind === "theme") {
              const choice = themeCatalogue[zone.themeIndex];
              if (choice) {
                setFocusIndex(zone.themeIndex);
                const clickedAt = performance.now();
                const last = lastThemeClickRef.current;
                if (
                  last &&
                  last.themeIndex === zone.themeIndex &&
                  clickedAt - last.time <= DOUBLE_CLICK_MS
                ) {
                  onPickTheme(choice.id);
                  lastThemeClickRef.current = null;
                } else {
                  lastThemeClickRef.current = { themeIndex: zone.themeIndex, time: clickedAt };
                }
              }
            } else {
              lastThemeClickRef.current = null;
              switch (zone.kind) {
                case "motion":
                  onToggleReducedMotion?.();
                  break;
                case "usage":
                  onToggleUsageBar?.();
                  break;
                case "observer":
                  onToggleObserver?.();
                  break;
                case "paginate":
                  onToggleGardenPaginate?.();
                  break;
                case "density":
                  onCycleGardenDensity?.();
                  break;
                case "bell":
                  onToggleBellOnVibeChange?.();
                  break;
                case "test-bell":
                  onTestBell?.();
                  break;
                case "github":
                  onToggleGitHub?.();
                  break;
                case "github-private":
                  onToggleGitHubPrivate?.();
                  break;
                case "github-protocol":
                  onCycleGitHubCloneProtocol?.();
                  break;
                case "github-refresh":
                  onRefreshGitHub?.();
                  break;
                case "tab-themes":
                  setCompactSection("themes");
                  break;
                case "tab-prefs":
                  setCompactSection("prefs");
                  break;
              }
            }
            return;
          }
        }
      },
      [
        hitZones,
        themesScrollBounds,
        onPickTheme,
        onToggleReducedMotion,
        onToggleUsageBar,
        onToggleObserver,
        onToggleGardenPaginate,
        onCycleGardenDensity,
        onToggleBellOnVibeChange,
        onToggleGitHub,
        onToggleGitHubPrivate,
        onCycleGitHubCloneProtocol,
        onRefreshGitHub,
        onTestBell
      ]
    )
  );

  if (responsive.tier === "too-small") {
    return <ResizePrompt columns={columns} rows={rows} title="SETTINGS" />;
  }

  const headerTitle = focused
    ? previewIsApplied
      ? `theme picker · previewing ${focused.label} (applied)`
      : `theme picker · previewing ${focused.label}`
    : "theme picker";

  const themesPanelBody = (
    <Panel title="themes" paddingY={0}>
      {visible.map((choice, offset) => {
        const idx = windowStart + offset;
        const isFocused = idx === focusIndex;
        const isActive = choice.id === currentThemeId;
        return (
          <Box key={choice.id} flexDirection="row" justifyContent="space-between">
            <Box flexDirection="row">
              <Text color={isFocused ? previewTheme.colors.primary : "transparent"}>
                {isFocused ? "›" : " "}
              </Text>
              <Text
                color={isFocused ? previewTheme.colors.primary : previewTheme.colors.foreground}
                bold={isFocused}
                wrap="truncate-end"
              >
                {" "}{choice.label}
              </Text>
            </Box>
            {isActive ? (
              <Text color={previewTheme.colors.success}>● active</Text>
            ) : null}
          </Box>
        );
      })}
    </Panel>
  );

  const prefsPanelBody = (
    <Panel title="preferences" paddingY={0}>
      <PrefRow
        hotkey="m"
        label="reduced motion · quiets stars, wiggle, wander, transitions"
        indicator={reducedMotion ? "● on" : "○ off"}
        indicatorColor={
          reducedMotion ? previewTheme.colors.success : previewTheme.colors.mutedForeground
        }
        labelColor={previewTheme.colors.foreground}
      />
      <PrefRow
        hotkey="u"
        label="usage bar · opt-in Claude/Codex quota checks"
        indicator={usageBarDisabled ? "○ off" : "● on"}
        indicatorColor={
          usageBarDisabled
            ? previewTheme.colors.mutedForeground
            : previewTheme.colors.success
        }
        labelColor={previewTheme.colors.foreground}
      />
      <PrefRow
        hotkey="o"
        label="observer · live-watches .git for commits + new repos"
        indicator={observerEnabled ? "● on" : "○ off"}
        indicatorColor={
          observerEnabled ? previewTheme.colors.success : previewTheme.colors.mutedForeground
        }
        labelColor={previewTheme.colors.foreground}
      />
      <PrefRow
        hotkey="p"
        label="pagination · off shows every creature on one screen"
        indicator={gardenPaginate ? "● on" : "○ off"}
        indicatorColor={
          gardenPaginate ? previewTheme.colors.success : previewTheme.colors.mutedForeground
        }
        labelColor={previewTheme.colors.foreground}
      />
      <PrefRow
        hotkey="g"
        label="density · how packed garden + shelf feel"
        indicator={gardenDensity}
        indicatorColor={previewTheme.colors.success}
        labelColor={previewTheme.colors.foreground}
      />
      <PrefRow
        hotkey="b"
        label="bell on vibe flip · BEL when a repo changes state"
        indicator={bellOnVibeChange ? "● on" : "○ off"}
        indicatorColor={
          bellOnVibeChange ? previewTheme.colors.success : previewTheme.colors.mutedForeground
        }
        labelColor={previewTheme.colors.foreground}
      />
      <PrefRow
        hotkey="B"
        label="test bell · ring once to check this terminal passes BEL through"
        indicator="♪ ring"
        indicatorColor={previewTheme.colors.mutedForeground}
        labelColor={previewTheme.colors.foreground}
      />
      <PrefRow
        hotkey="G"
        label={`github · fetch repo metadata via gh CLI${githubRepoCount > 0 ? ` (${githubRepoCount})` : ""}`}
        indicator={githubEnabled ? "● on" : "○ off"}
        indicatorColor={
          githubEnabled ? previewTheme.colors.success : previewTheme.colors.mutedForeground
        }
        labelColor={previewTheme.colors.foreground}
      />
      <PrefRow
        hotkey="v"
        label="github private/org repos · include what gh auth can read"
        indicator={githubIncludePrivate ? "● all" : "○ public"}
        indicatorColor={
          githubIncludePrivate ? previewTheme.colors.success : previewTheme.colors.mutedForeground
        }
        labelColor={previewTheme.colors.foreground}
      />
      <PrefRow
        hotkey="C"
        label="github clone protocol · used by catalog import"
        indicator={githubCloneProtocol}
        indicatorColor={previewTheme.colors.success}
        labelColor={previewTheme.colors.foreground}
      />
      <PrefRow
        hotkey="R"
        label="github refresh · fetch catalog now"
        indicator="↻ fetch"
        indicatorColor={previewTheme.colors.mutedForeground}
        labelColor={previewTheme.colors.foreground}
      />
    </Panel>
  );

  const tabBar = compactMode ? (
    <Box flexDirection="row">
      <Text
        bold={compactSection === "themes"}
        color={
          compactSection === "themes"
            ? previewTheme.colors.primary
            : previewTheme.colors.mutedForeground
        }
      >
        [ themes ]
      </Text>
      <Text color={previewTheme.colors.mutedForeground}> </Text>
      <Text
        bold={compactSection === "prefs"}
        color={
          compactSection === "prefs"
            ? previewTheme.colors.primary
            : previewTheme.colors.mutedForeground
        }
      >
        [ prefs ]
      </Text>
      <Text dimColor color={previewTheme.colors.mutedForeground}>
        {"  ·  tab to switch"}
      </Text>
    </Box>
  ) : null;

  return (
    <ThemeProvider theme={previewTheme} reducedMotion={reducedMotion}>
      <Box flexDirection="column" paddingX={1} paddingY={1} height={containerHeight} overflow="hidden">
        <Box ref={headerRef} flexDirection="column">
          <Box flexDirection={mode === "narrow" ? "column" : "row"} justifyContent="space-between">
            <Box flexDirection="column">
              <Text dimColor color={previewTheme.colors.mutedForeground}>
                settings
              </Text>
              <Text bold color={previewTheme.colors.primary} wrap="truncate-end">
                {headerTitle}
              </Text>
            </Box>
            <Box marginTop={mode === "narrow" ? 1 : 0}>
              <Badge variant="info" bold>
                SETTINGS
              </Badge>
            </Box>
          </Box>
          <Box paddingBottom={1}>
            <Text wrap="truncate-end" color={previewTheme.colors.foreground}>
              {themeCatalogue.length} themes ported from termcn. click to preview, double-click or enter to apply.
            </Text>
          </Box>
        </Box>

        {compactMode ? (
          <>
            {tabBar}
            {compactSection === "prefs" ? (
              <Box ref={motionPanelRef} flexDirection="column">
                {prefsPanelBody}
              </Box>
            ) : (
              themesPanelBody
            )}
          </>
        ) : (
          <>
            <Box ref={motionPanelRef} flexDirection="column">
              {prefsPanelBody}
            </Box>
            {sideBySide ? (
              <Box flexDirection="row">
                <Box width={themesWidth} flexDirection="column">
                  {themesPanelBody}
                </Box>
                <Box width={1} />
                <Box width={previewWidth} flexDirection="column">
                  <SettingsPreview
                    theme={previewTheme}
                    themeLabel={focused?.label ?? "—"}
                    isAppliedTheme={previewIsApplied}
                    reducedMotion={reducedMotion}
                    width={previewWidth}
                    height={visible.length + PANEL_CHROME_TOTAL}
                  />
                </Box>
              </Box>
            ) : (
              themesPanelBody
            )}
          </>
        )}

        <Box paddingTop={1} flexDirection="column">
          <Text dimColor color={previewTheme.colors.mutedForeground} wrap="truncate-end">
            showing {windowStart + 1}–{windowStart + visible.length} of {themeCatalogue.length}
            {focused ? `  ·  focused: ${focused.label}` : ""}
          </Text>
          {compactMode ? (
            <Box flexDirection="row" justifyContent="space-between">
              <Text dimColor color={previewTheme.colors.mutedForeground} wrap="truncate-end">
                tab switch · ↑/↓ pick · enter apply · click row · esc back
              </Text>
              <Credit />
            </Box>
          ) : (
            <>
              <Text dimColor color={previewTheme.colors.mutedForeground} wrap="truncate-end">
                <Text bold>themes</Text>  ↑/↓ pick · enter or dbl-click apply · esc back
              </Text>
                <Text dimColor color={previewTheme.colors.mutedForeground} wrap="truncate-end">
                  <Text bold>prefs </Text>  click row to toggle · keys m u o p g G v C R
                </Text>
              <Box flexDirection="row" justifyContent="space-between">
                <Text dimColor color={previewTheme.colors.mutedForeground} wrap="truncate-end">
                  <Text bold>mouse </Text>  scroll themes · click previews · double-click applies
                </Text>
                <Credit />
              </Box>
            </>
          )}
        </Box>
      </Box>
    </ThemeProvider>
  );
};
