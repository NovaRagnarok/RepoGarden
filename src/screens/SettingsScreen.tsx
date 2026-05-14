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
import { vibeGlyph, type Vibe } from "@/lib/vibe";
import type { GardenDensity } from "@/lib/garden-layout";
import { DEMO_NAMES, demoVibeFor } from "@/lib/demo-roster";

export interface SettingsScreenProps {
  currentThemeId: string;
  reducedMotion?: boolean;
  usageBarDisabled?: boolean;
  observerEnabled?: boolean;
  gardenPaginate?: boolean;
  gardenDensity?: GardenDensity;
  onPickTheme: (id: string) => void;
  onToggleReducedMotion?: () => void;
  onToggleUsageBar?: () => void;
  onToggleObserver?: () => void;
  onToggleGardenPaginate?: () => void;
  onCycleGardenDensity?: () => void;
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
  return (
    <Box key={key} flexDirection="row">
      {groups.map((g, i) => (
        <Text key={i} color={g.fg} bold={g.bold}>
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
  const vibeColor = (v: Vibe): string => {
    switch (v) {
      case "stuck":
        return theme.colors.error;
      case "awake":
        return theme.colors.warning;
      case "sleepy":
        return theme.colors.info;
      default:
        return theme.colors.success;
    }
  };
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
          fg: vibeColor(sprite.vibe),
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

// ---- settings screen ------------------------------------------------------

export const SettingsScreen = ({
  currentThemeId,
  reducedMotion = false,
  usageBarDisabled = false,
  observerEnabled = true,
  gardenPaginate = true,
  gardenDensity = "comfortable",
  onPickTheme,
  onToggleReducedMotion,
  onToggleUsageBar,
  onToggleObserver,
  onToggleGardenPaginate,
  onCycleGardenDensity,
  onClose
}: SettingsScreenProps) => {
  const appliedTheme = useTheme();
  const { columns, rows } = useTerminalSize();
  const responsive = getTerminalLayout(columns, rows);
  const mode = layoutMode(columns);
  // Reserve ~13 rows for the chrome (header, tagline, motion panel, theme panel
  // borders, footer hints).
  const pageSize = Math.max(4, Math.min(themeCatalogue.length, rows - 13));
  const containerHeight = Math.max(8, rows - 1);
  const startIndex = Math.max(
    0,
    themeCatalogue.findIndex((choice) => choice.id === currentThemeId)
  );
  const [focusIndex, setFocusIndex] = useState(startIndex === -1 ? 0 : startIndex);

  const headerRef = useRef<DOMElement | null>(null);
  const motionPanelRef = useRef<DOMElement | null>(null);
  const [headerHeight, setHeaderHeight] = useState(0);
  const [motionHeight, setMotionHeight] = useState(0);
  const lastThemeClickRef = useRef<{ themeIndex: number; time: number } | null>(null);

  // Side-by-side themes + preview when there's enough horizontal room. Need
  // ~32 cols for the preview to fit two mini sprites + swatches, plus ~28 for
  // a usable themes panel + the gap + outer padding.
  const sideBySide = mode !== "narrow" && columns >= 62;
  const innerContentW = Math.max(10, columns - 2); // outer paddingX (1 each side)
  const previewWidth = sideBySide ? Math.max(30, Math.floor(innerContentW * 0.48)) : 0;
  const themesWidth = sideBySide
    ? Math.max(20, innerContentW - previewWidth - 1)
    : innerContentW;

  useInput((input, key) => {
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
    const zones: Array<
      | { kind: "motion"; topRow: number; bottomRow: number; leftCol: number; rightCol: number }
      | {
          kind: "theme";
          themeIndex: number;
          topRow: number;
          bottomRow: number;
          leftCol: number;
          rightCol: number;
        }
    > = [];
    if (headerHeight === 0 || motionHeight === 0) return zones;

    const motionTop = 2 + headerHeight;
    zones.push({
      kind: "motion",
      topRow: motionTop,
      bottomRow: motionTop + motionHeight - 1,
      leftCol: 2,
      rightCol: Math.max(2, 2 + innerContentW - 1)
    });

    const themesPanelTop = motionTop + motionHeight;
    const themesContentTop = themesPanelTop + PANEL_CONTENT_TOP_OFFSET;
    const themesLeftCol = 2;
    const themesRightCol = themesLeftCol + themesWidth - 1;
    for (let i = 0; i < visible.length; i += 1) {
      const row = themesContentTop + i;
      zones.push({
        kind: "theme",
        themeIndex: windowStart + i,
        topRow: row,
        bottomRow: row,
        leftCol: themesLeftCol,
        rightCol: themesRightCol
      });
    }
    return zones;
  }, [
    headerHeight,
    motionHeight,
    visible.length,
    windowStart,
    innerContentW,
    themesWidth
  ]);

  const themesScrollBounds = useMemo(() => {
    if (headerHeight === 0 || motionHeight === 0) return null;
    const top = 2 + headerHeight + motionHeight;
    const themesContentRows = visible.length;
    const bottom =
      top + PANEL_CONTENT_TOP_OFFSET + themesContentRows + PANEL_CONTENT_BOTTOM_OFFSET - 1;
    const left = 2;
    const right = left + themesWidth - 1;
    return { top, bottom, left, right };
  }, [headerHeight, motionHeight, visible.length, themesWidth]);

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
            if (zone.kind === "motion") {
              onToggleReducedMotion?.();
              lastThemeClickRef.current = null;
            } else {
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
            }
            return;
          }
        }
      },
      [hitZones, themesScrollBounds, onPickTheme, onToggleReducedMotion]
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

        <Box ref={motionPanelRef} flexDirection="column">
          <Panel title="preferences" paddingY={0}>
            <Box flexDirection="row" justifyContent="space-between">
              <Text color={previewTheme.colors.foreground}>
                <Text bold>m</Text> reduced motion · quiets stars, wiggle, wander, transitions
              </Text>
              <Text color={reducedMotion ? previewTheme.colors.success : previewTheme.colors.mutedForeground}>
                {reducedMotion ? "● on" : "○ off"}
              </Text>
            </Box>
            <Box flexDirection="row" justifyContent="space-between">
              <Text color={previewTheme.colors.foreground}>
                <Text bold>u</Text> usage bar · reads Claude/Codex CLI credentials locally
              </Text>
              <Text color={usageBarDisabled ? previewTheme.colors.mutedForeground : previewTheme.colors.success}>
                {usageBarDisabled ? "○ off" : "● on"}
              </Text>
            </Box>
            <Box flexDirection="row" justifyContent="space-between">
              <Text color={previewTheme.colors.foreground}>
                <Text bold>o</Text> observer · live-watches .git for commits + new repos
              </Text>
              <Text color={observerEnabled ? previewTheme.colors.success : previewTheme.colors.mutedForeground}>
                {observerEnabled ? "● on" : "○ off"}
              </Text>
            </Box>
            <Box flexDirection="row" justifyContent="space-between">
              <Text color={previewTheme.colors.foreground}>
                <Text bold>p</Text> pagination · off shows every creature on one screen
              </Text>
              <Text color={gardenPaginate ? previewTheme.colors.success : previewTheme.colors.mutedForeground}>
                {gardenPaginate ? "● on" : "○ off"}
              </Text>
            </Box>
            <Box flexDirection="row" justifyContent="space-between">
              <Text color={previewTheme.colors.foreground}>
                <Text bold>g</Text> density · how packed garden + shelf feel
              </Text>
              <Text color={previewTheme.colors.success}>
                {gardenDensity}
              </Text>
            </Box>
          </Panel>
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

        <Box paddingTop={1} flexDirection="column">
          <Text dimColor color={previewTheme.colors.mutedForeground} wrap="truncate-end">
            showing {windowStart + 1}–{windowStart + visible.length} of {themeCatalogue.length}
            {focused ? `  ·  focused: ${focused.label}` : ""}
          </Text>
          <Box flexDirection="row" justifyContent="space-between">
            <Text dimColor color={previewTheme.colors.mutedForeground}>
              click preview · dbl-click/enter apply · ↑/↓ pick · m motion · u usage · o observer · p paginate · g density · esc back
            </Text>
            <Credit />
          </Box>
        </Box>
      </Box>
    </ThemeProvider>
  );
};
