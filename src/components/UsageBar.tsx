import { Box, Text } from "ink";
import React from "react";

import { useTheme } from "@/components/ui/theme-provider";
import type { ProviderUsage, UsageStatus, UsageWindow } from "@/lib/usage";

interface UsageBarProps {
  items: ProviderUsage[];
  /**
   * When set, hide bar glyphs (just label + percent) so the row fits inside
   * very narrow terminals.
   */
  dense?: boolean;
  /**
   * How many cells to render for the bar glyph. 10 = decile resolution; 20 =
   * 5% per cell. Ignored when `dense` is set.
   */
  barCells?: number;
  /**
   * "column" (default) stacks providers vertically with a blank row between.
   * "row" lays them out side-by-side — each provider is still a 7d/5h stack,
   * but the next provider starts to the right with a column gap.
   */
  direction?: "column" | "row";
  /**
   * Footer-friendly form: each provider is a 2-row stack (7d on top, 5h
   * below) with the provider name only on the 7d row. Providers sit
   * side-by-side, divided by a 2-row `│`. Wins over `dense`/`direction`/
   * `barCells` when set.
   */
  inline?: boolean;
}

// Default bar resolution when the caller doesn't pass `barCells`. 10 cells =
// 1 decile per cell, a sensible middle ground.
const DEFAULT_BAR_CELLS = 10;

const miniBar = (percent: number, cells: number): string => {
  const pct = Math.max(0, Math.min(100, percent));
  const filled = Math.round((pct / 100) * cells);
  return "█".repeat(filled) + "░".repeat(cells - filled);
};

// Green/yellow/red against remaining %. The whole block is dimmed at render
// time (see `calm` in WindowRow), so these tokens read as muted tints rather
// than full-saturation alerts.
const colorForPercent = (
  percent: number | null,
  theme: ReturnType<typeof useTheme>
): string => {
  if (percent === null) return theme.colors.mutedForeground;
  if (percent < 25) return theme.colors.error;
  if (percent < 50) return theme.colors.warning;
  return theme.colors.success;
};

const formatReset = (date: Date | null, now: number = Date.now()): string | null => {
  if (!date) return null;
  const ms = date.getTime() - now;
  if (!Number.isFinite(ms) || ms <= 0) return "now";
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (ms >= day) return `${Math.floor(ms / day)}d`;
  if (ms >= hour) return `${Math.floor(ms / hour)}h`;
  return `${Math.max(1, Math.floor(ms / minute))}m`;
};

// Right-justify percent to 4 chars ("100%", " 87%", "  9%") so columns line up
// when the values cross order-of-magnitude boundaries.
const formatPercentCell = (percent: number): string =>
  `${Math.round(percent)}%`.padStart(4);

// Reset countdowns rendered with tight parens, then padded out to 5 chars
// on the right so the bar column to the right stays aligned across rows.
// Padding sits OUTSIDE the parens — "(3d) " not "(3d )" — so short values
// don't look like they're holding a blank inside.
const RESET_CELL_WIDTH = 5;
const formatResetCell = (date: Date | null): string => {
  const reset = formatReset(date);
  if (!reset) return " ".repeat(RESET_CELL_WIDTH);
  return `(${reset})`.padEnd(RESET_CELL_WIDTH);
};

const statusBadge = (status: UsageStatus): { label: string; tone: "warn" | "error" } | null => {
  if (status === "ok") return null;
  if (status === "stale") return { label: "stale", tone: "warn" };
  if (status === "auth") return { label: "auth", tone: "error" };
  return { label: "err", tone: "error" };
};

// All labels render at fixed widths so the bar/percent/reset columns line up
// vertically across every row regardless of provider or window.
const PROVIDER_WIDTH = 6; // "codex " / "claude"
const WINDOW_WIDTH = 2;   // "7d" / "5h" — right-aligned
const padLeft = (s: string, width: number): string =>
  s.length >= width ? s : s + " ".repeat(width - s.length);
const padRight = (s: string, width: number): string =>
  s.length >= width ? s : " ".repeat(width - s.length) + s;

export const UsageBar = ({
  items,
  dense = false,
  barCells = DEFAULT_BAR_CELLS,
  direction = "column",
  inline = false,
}: UsageBarProps) => {
  const theme = useTheme();
  if (items.length === 0) return null;
  if (inline) {
    return (
      <Box flexDirection="row" columnGap={1}>
        {items.flatMap((u, i) => {
          const node = <InlineProviderCells key={u.source} usage={u} theme={theme} />;
          if (i === items.length - 1) return [node];
          return [
            node,
            <InlineProviderSeparator key={`sep-${u.source}`} theme={theme} />,
          ];
        })}
      </Box>
    );
  }
  const isRow = direction === "row";
  return (
    <Box flexDirection={direction} columnGap={isRow ? 2 : 0}>
      {items.flatMap((u, i) => {
        const node = (
          <ProviderBlock
            key={u.source}
            usage={u}
            dense={dense}
            barCells={barCells}
            theme={theme}
            spaceAfter={!isRow && i < items.length - 1}
            labelOnTop={isRow}
          />
        );
        if (!isRow || i === items.length - 1) return [node];
        return [
          node,
          <ProviderSeparator key={`sep-${u.source}`} theme={theme} />,
        ];
      })}
    </Box>
  );
};

// Footer form: per provider, a 2-row stack — 7d on top, 5h underneath.
// Provider name + status badge sit inline on the 7d row; the 5h row leaves
// the provider column blank so the 7d/5h labels and percent cells align
// vertically. Reset countdown `(3d)`/`(2h)` lives at the right of each row.
const InlineProviderCells = ({
  usage,
  theme,
}: {
  usage: ProviderUsage;
  theme: ReturnType<typeof useTheme>;
}) => {
  const badge = statusBadge(usage.status);
  const badgeColor =
    badge?.tone === "error" ? theme.colors.error : theme.colors.warning;
  const renderRow = (
    leadingProvider: React.ReactNode,
    label: string,
    win: UsageWindow | null,
    trailing?: React.ReactNode
  ) => {
    const hasData = win && win.percent !== null;
    const tone = hasData
      ? colorForPercent(win.percent, theme)
      : theme.colors.mutedForeground;
    const percentText = hasData ? formatPercentCell(win.percent!) : "  —%";
    const resetText = formatResetCell(win?.resetsAt ?? null);
    return (
      <Box flexDirection="row" columnGap={1}>
        {leadingProvider}
        <Text color={theme.colors.mutedForeground}>
          {padRight(label, WINDOW_WIDTH)}
        </Text>
        <Text dimColor color={theme.colors.border}>
          {resetText}
        </Text>
        <Text dimColor color={tone}>
          {percentText}
        </Text>
        {trailing ?? null}
      </Box>
    );
  };
  return (
    <Box flexDirection="column">
      {renderRow(
        <Text italic dimColor color={theme.colors.mutedForeground}>
          {padLeft(usage.source, PROVIDER_WIDTH)}
        </Text>,
        "7d",
        usage.weekly,
        badge ? (
          <Text bold color={badgeColor}>
            {badge.label}
          </Text>
        ) : null
      )}
      {renderRow(<Text>{BLANK_PROVIDER}</Text>, "5h", usage.fiveHour)}
    </Box>
  );
};

// Empty 2-row block matching `<UsageBar inline />`'s footprint. Used to
// reserve the footer's vertical space while `useUsage` is still resolving
// (its initial value is `[]`, which would otherwise render nothing and let
// the garden Panel grow into the gap until the data arrived).
export const UsageBarPlaceholder = () => (
  <Box flexDirection="column">
    <Text> </Text>
    <Text> </Text>
  </Box>
);

const InlineProviderSeparator = ({
  theme,
}: {
  theme: ReturnType<typeof useTheme>;
}) => (
  <Box flexDirection="column">
    {[0, 1].map((row) => (
      <Text key={row} dimColor color={theme.colors.border}>
        │
      </Text>
    ))}
  </Box>
);

const ProviderSeparator = ({
  theme,
}: {
  theme: ReturnType<typeof useTheme>;
}) => (
  <Box flexDirection="column">
    {/* 4-row rule matching the bar block: name / 7d / gap / 5h. */}
    {[0, 1, 2, 3].map((row) => (
      <Text key={row} dimColor color={theme.colors.mutedForeground}>
        │
      </Text>
    ))}
  </Box>
);

interface ProviderBlockProps {
  usage: ProviderUsage;
  dense: boolean;
  barCells: number;
  theme: ReturnType<typeof useTheme>;
  /** Leave one blank row below this provider for visual separation. */
  spaceAfter: boolean;
  /**
   * Render the provider name (and status badge) as a header row above the
   * 7d/5h rows, leaving the provider column blank inside each WindowRow.
   * Used in horizontal layouts where the inline label would waste width.
   */
  labelOnTop: boolean;
}

// One provider renders as a stacked pair: weekly first, then 5h. With
// `labelOnTop`, the provider name + status sit on a header row above the
// pair; otherwise the label appears inline on the 7d row and the 5h row
// leaves the provider cell blank.
const ProviderBlock = ({
  usage,
  dense,
  barCells,
  theme,
  spaceAfter,
  labelOnTop,
}: ProviderBlockProps) => {
  const badge = statusBadge(usage.status);
  const badgeColor =
    badge?.tone === "error" ? theme.colors.error : theme.colors.warning;
  if (labelOnTop) {
    return (
      <Box flexDirection="column" marginBottom={spaceAfter ? 1 : 0}>
        {/* Provider name floats above the bars, left-aligned to the first
            bar cell. The bar now sits at:
              windowLabel(2) + gap(1) + reset(5) + gap(0) = 8 cols in. */}
        <Box
          flexDirection="row"
          columnGap={1}
          paddingLeft={WINDOW_WIDTH + 1 + RESET_CELL_WIDTH}
        >
          <Text italic color={theme.colors.mutedForeground}>
            {usage.source}
          </Text>
          {badge ? (
            <Text bold color={badgeColor}>
              {badge.label}
            </Text>
          ) : null}
        </Box>
        <WindowRow
          provider={usage.source}
          showProvider={false}
          hideProviderColumn
          windowLabel="7d"
          win={usage.weekly}
          status={usage.status}
          showStatus={false}
          dense={dense}
          barCells={barCells}
          theme={theme}
        />
        <Box marginTop={1}>
          <WindowRow
            provider={usage.source}
            showProvider={false}
            hideProviderColumn
            windowLabel="5h"
            win={usage.fiveHour}
            status={usage.status}
            showStatus={false}
            dense={dense}
            barCells={barCells}
            theme={theme}
          />
        </Box>
      </Box>
    );
  }
  return (
    <Box flexDirection="column" marginBottom={spaceAfter ? 1 : 0}>
      <WindowRow
        provider={usage.source}
        showProvider
        windowLabel="7d"
        win={usage.weekly}
        status={usage.status}
        showStatus
        dense={dense}
        barCells={barCells}
        theme={theme}
      />
      <WindowRow
        provider={usage.source}
        showProvider={false}
        windowLabel="5h"
        win={usage.fiveHour}
        status={usage.status}
        showStatus={false}
        dense={dense}
        barCells={barCells}
        theme={theme}
      />
    </Box>
  );
};


interface WindowRowProps {
  provider: ProviderUsage["source"];
  showProvider: boolean;
  /** Omit the provider column entirely (label is rendered elsewhere). */
  hideProviderColumn?: boolean;
  windowLabel: string;
  win: UsageWindow | null;
  status: UsageStatus;
  showStatus: boolean;
  dense: boolean;
  barCells: number;
  theme: ReturnType<typeof useTheme>;
}

const BLANK_PROVIDER = " ".repeat(PROVIDER_WIDTH);

const WindowRow = ({
  provider,
  showProvider,
  hideProviderColumn = false,
  windowLabel,
  win,
  status,
  showStatus,
  dense,
  barCells,
  theme,
}: WindowRowProps) => {
  const hasData = win && win.percent !== null;
  const tone = hasData
    ? colorForPercent(win.percent, theme)
    : theme.colors.mutedForeground;
  // The whole usage block reads as ambient context — it sits in the header
  // alongside the page title and should not compete with primary content
  // for attention. Layer ANSI dim across the bar+percent regardless of
  // window or tone; the colour still differentiates green/yellow/red.
  const calm = true;
  const barGlyphs = hasData ? miniBar(win.percent!, barCells) : "░".repeat(barCells);
  const percentText = hasData ? formatPercentCell(win.percent!) : "  —%";
  const resetText = formatResetCell(win?.resetsAt ?? null);
  const badge = showStatus ? statusBadge(status) : null;
  const badgeColor =
    badge?.tone === "error" ? theme.colors.error : theme.colors.warning;
  return (
    <Box flexDirection="row" columnGap={1}>
      {hideProviderColumn ? null : (
        <Text bold={!calm} dimColor={calm} color={theme.colors.accent}>
          {showProvider ? padLeft(provider, PROVIDER_WIDTH) : BLANK_PROVIDER}
        </Text>
      )}
      {/* Window label is the row's "name" — slightly more prominent than the
          reset cell so the eye can scan rows by the unit. Plain muted at full
          intensity (no dimColor). */}
      <Text color={theme.colors.mutedForeground}>
        {padRight(windowLabel, WINDOW_WIDTH)}
      </Text>
      {/* Reset cell and bar are siblings in their own row with columnGap=0 so
          the bar sits flush against the closing paren (long resets like
          "(30d)" touch the bar; short resets like "(3d) " carry their own
          trailing pad-space). Keeps the bar column stable across rows. */}
      <Box flexDirection="row" columnGap={0}>
        {/* Reset uses the border colour + dim — a noticeably softer grey
            than mutedForeground so it reads as supplementary detail next to
            the row's primary "7d"/"5h" label. */}
        <Text dimColor color={theme.colors.border}>{resetText}</Text>
        {/* Bar glyphs + percent share the bar tone and sit flush — the
            percent hugs the right edge of the bar, same colour as the fill. */}
        <Text dimColor={calm} color={tone}>
          {dense ? percentText : `${barGlyphs}${percentText}`}
        </Text>
      </Box>
      {badge ? (
        <Text bold color={badgeColor}>
          {badge.label}
        </Text>
      ) : null}
    </Box>
  );
};
