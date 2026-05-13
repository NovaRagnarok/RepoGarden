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
import type { Vibe } from "@/lib/vibe";

export interface SettingsScreenProps {
  currentThemeId: string;
  reducedMotion?: boolean;
  onPickTheme: (id: string) => void;
  onToggleReducedMotion?: () => void;
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
  vibe: Vibe;
  x: number;
  y: number;
  charW: number;
  charH: number;
}

const buildPreviewSprites = (innerW: number, innerH: number): PreviewSprite[] => {
  const charW = 4;
  const charH = 3;
  const topY = Math.max(0, Math.floor((Math.min(4, innerH) - charH) / 2));
  const leftX = Math.max(1, Math.floor(innerW * 0.22) - Math.floor(charW / 2));
  const rightX = Math.max(leftX + charW + 2, Math.floor(innerW * 0.72) - Math.floor(charW / 2));
  return [
    { identity: "preview-bell", vibe: "happy", x: leftX, y: topY, charW, charH },
    { identity: "preview-moth", vibe: "sleepy", x: rightX, y: topY, charW, charH }
  ];
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

  const swatchRows = innerH >= 6 ? 2 : innerH >= 4 ? 1 : 0;
  const skyRows = Math.max(2, innerH - swatchRows - (swatchRows > 0 ? 1 : 0));

  const cells: PreviewCell[][] = [];
  for (let y = 0; y < skyRows; y += 1) {
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
  for (const { sprite, frameA, frameB, body, wiggle } of spriteFrames) {
    const useFrameB = !reducedMotion && wiggleFrameAt(wiggle, now) === 1;
    const frame = useFrameB ? frameB : frameA;
    for (let cy = 0; cy < sprite.charH; cy += 1) {
      for (let cx = 0; cx < sprite.charW; cx += 1) {
        const targetY = sprite.y + cy;
        const targetX = sprite.x + cx;
        if (targetY < 0 || targetY >= skyRows) continue;
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
  }

  const swatchPicks: { label: string; color: string }[][] = [
    [
      { label: "primary", color: theme.colors.primary },
      { label: "accent", color: theme.colors.accent },
      { label: "success", color: theme.colors.success },
      { label: "warning", color: theme.colors.warning }
    ],
    [
      { label: "error", color: theme.colors.error },
      { label: "info", color: theme.colors.info },
      { label: "fg", color: theme.colors.foreground },
      { label: "muted", color: theme.colors.mutedForeground }
    ]
  ];
  const swatchBlock = "███";
  if (swatchRows > 0) {
    cells.push(
      Array.from({ length: innerW }, () => ({ char: " ", fg: theme.colors.background }))
    );
    for (let r = 0; r < swatchRows; r += 1) {
      const picks = swatchPicks[r] ?? [];
      const row: PreviewCell[] = [];
      let consumedW = 0;
      const between = 1;
      for (const pick of picks) {
        const segment = `${pick.label} ${swatchBlock}`;
        if (consumedW + segment.length + (consumedW > 0 ? between : 0) > innerW) break;
        if (consumedW > 0) {
          for (let i = 0; i < between; i += 1) {
            row.push({ char: " ", fg: theme.colors.background });
          }
          consumedW += between;
        }
        for (const ch of `${pick.label} `) {
          row.push({ char: ch, fg: theme.colors.mutedForeground });
        }
        for (const ch of swatchBlock) {
          row.push({ char: ch, fg: pick.color });
        }
        consumedW += segment.length;
      }
      while (row.length < innerW) {
        row.push({ char: " ", fg: theme.colors.background });
      }
      cells.push(row);
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
  onPickTheme,
  onToggleReducedMotion,
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
          <Panel title="motion" paddingY={0}>
            <Box flexDirection="row" justifyContent="space-between">
              <Text color={previewTheme.colors.foreground}>
                reduced motion · quiets stars, wiggle, wander, transitions
              </Text>
              <Text color={reducedMotion ? previewTheme.colors.success : previewTheme.colors.mutedForeground}>
                {reducedMotion ? "● on" : "○ off"}
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
              click preview · dbl-click/enter apply · ↑/↓ pick · m motion · esc back
            </Text>
            <Credit />
          </Box>
        </Box>
      </Box>
    </ThemeProvider>
  );
};
