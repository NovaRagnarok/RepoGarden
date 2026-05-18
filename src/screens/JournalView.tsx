/**
 * JournalView.tsx — actionable, filterable timeline of JournalEvents.
 *
 * The journal is no longer just a passive log: it can scope across one repo or
 * every repo, filter by event kind and time range, inspect the selected event,
 * and jump straight into the related workbench.
 */

import { Box, Text } from "ink";
import { useEffect, useMemo, useState } from "react";

import { Sparkline } from "@/components/ui/sparkline";
import { Panel } from "@/components/ui/panel";
import { ScrollBar } from "@/components/ui/scroll-bar";
import { useTheme } from "@/components/ui/theme-provider";
import { useInput } from "@/hooks/use-input";
import { eventSummary } from "@/lib/event-summary";
import type { JournalEvent } from "@/lib/events";
import {
  JOURNAL_KIND_FILTERS,
  JOURNAL_RANGE_FILTERS,
  buildActivityBuckets,
  clampJournalIndex,
  computeJournalStats,
  dayLabel,
  filterJournalEvents,
  formatEventTime,
  journalDetailRows,
  journalKindLabel,
  journalRangeLabel,
  localDateKey,
  type JournalKindFilter,
  type JournalRangeId,
  type JournalScopeMode,
} from "@/lib/journal";
import type { RepoCreature } from "@/lib/creature";
import { vibeColor, vibeGlyph } from "@/lib/vibe";
import type { Vibe } from "@/lib/vibe";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface JournalViewProps {
  creatures: RepoCreature[];
  events: JournalEvent[];
  width: number;
  height: number;
  /**
   * The currently picked repo from the parent's sidebar. Undefined means the
   * sidebar cursor is on the "everything" row — journal renders globally.
   * The parent owns scope selection; JournalView derives scope from this.
   */
  selectedRepoId?: string;
  filter?: string;
  isActive?: boolean;
  /**
   * Two-pane focus model (see `ReadyShell.tsx`): the journal pane and the
   * sidebar share a focus zone toggled by Esc. When true (default), the
   * pane owns ↑↓/jk for event scrolling and renders a focus-ring border.
   * When false, the sidebar owns ↑↓/jk and this pane's border falls back
   * to the default. Filter keys (f/F, t/T, d) and Enter still work in
   * either zone — Enter targets the sidebar selection regardless of which
   * pane has keyboard focus, so the parent handles that.
   */
  paneFocused?: boolean;
  /**
   * Called when the journal wants the parent to change the sidebar selection.
   * `null` requests the "everything" row; a string id requests that creature.
   */
  onSelectRepo?: (id: string | null) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const EVENT_CAP = 500;

const padTrunc = (s: string, len: number): string => {
  if (len <= 0) return "";
  if (s.length > len) return len === 1 ? "…" : s.slice(0, len - 1) + "…";
  return s.padEnd(len, " ");
};

const truncate = (s: string, len: number): string => {
  if (len <= 0) return "";
  if (s.length <= len) return s;
  return len === 1 ? "…" : s.slice(0, len - 1) + "…";
};

const nextInCycle = <T,>(items: readonly T[], current: T): T => {
  const idx = items.indexOf(current);
  return items[(idx + 1) % items.length] ?? items[0];
};

const prevInCycle = <T,>(items: readonly T[], current: T): T => {
  const idx = items.indexOf(current);
  return items[(idx - 1 + items.length) % items.length] ?? items[0];
};

// ---------------------------------------------------------------------------
// Glyph + color for each event kind
// ---------------------------------------------------------------------------

interface GlyphDef {
  glyph: string;
  colorKey: "error" | "success" | "info" | "warning" | "mutedForeground" | "vibe";
  vibeTarget?: Vibe;
}

const glyphFor = (event: JournalEvent): GlyphDef => {
  switch (event.kind) {
    case "commit":
      return { glyph: "▸", colorKey: "mutedForeground" };
    case "blocker-added":
      return { glyph: "⚑", colorKey: "error" };
    case "blocker-cleared":
      return { glyph: "✓", colorKey: "success" };
    case "note-created":
    case "note-edited":
    case "note-renamed":
      return { glyph: "✎", colorKey: "mutedForeground" };
    case "note-deleted":
      return { glyph: "⌫", colorKey: "warning" };
    case "vibe-changed": {
      const v = event.payload.to as Vibe;
      return { glyph: vibeGlyph(v), colorKey: "vibe", vibeTarget: v };
    }
    case "repo-added":
      return { glyph: "✦", colorKey: "info" };
    case "branch-switched":
      return { glyph: "⎇", colorKey: "mutedForeground" };
    default:
      return { glyph: "·", colorKey: "mutedForeground" };
  }
};

// ---------------------------------------------------------------------------
// Row types for the flat render list
// ---------------------------------------------------------------------------

type DayHeaderRow = { kind: "day-header"; label: string; key: string };
type EventRow = { kind: "event"; event: JournalEvent; eventIndex: number };
type TrailingRow = { kind: "trailing"; count: number };

type RenderRow = DayHeaderRow | EventRow | TrailingRow;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const JournalView = ({
  creatures,
  events,
  width,
  height,
  selectedRepoId,
  filter,
  isActive = true,
  paneFocused = true,
}: JournalViewProps) => {
  const theme = useTheme();
  const [scrollOffset, setScrollOffset] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [kindFilter, setKindFilter] = useState<JournalKindFilter>("all");
  const [rangeFilter, setRangeFilter] = useState<JournalRangeId>("all");
  const [detailsOpen, setDetailsOpen] = useState(true);

  const selectedCreature = useMemo(
    () => creatures.find((c) => c.id === selectedRepoId),
    [creatures, selectedRepoId]
  );

  // Scope is fully derived from the parent's sidebar selection. Undefined
  // selectedRepoId means the sidebar is on the "everything" row → all events.
  const activeScope: JournalScopeMode = selectedRepoId ? "focused" : "all";

  const now = useMemo(() => new Date(), [events.length, filter, selectedRepoId, kindFilter, rangeFilter]);

  const filteredEvents = useMemo(
    () =>
      filterJournalEvents(events, {
        scope: activeScope,
        repoId: selectedRepoId,
        query: filter,
        kind: kindFilter,
        range: rangeFilter,
        now,
      }),
    [events, activeScope, selectedRepoId, filter, kindFilter, rangeFilter, now]
  );

  const capped = useMemo(() => filteredEvents.slice(0, EVENT_CAP), [filteredEvents]);
  const hasTrailing = filteredEvents.length > EVENT_CAP;
  const trailingCount = filteredEvents.length - EVENT_CAP;

  const stats = useMemo(() => computeJournalStats(filteredEvents), [filteredEvents]);
  const activity = useMemo(
    () => buildActivityBuckets(filteredEvents, 14, now),
    [filteredEvents, now]
  );

  const renderRows = useMemo<RenderRow[]>(() => {
    if (capped.length === 0) return [];
    const rows: RenderRow[] = [];
    let lastDay = "";
    capped.forEach((event, eventIndex) => {
      const dayKey = localDateKey(event.ts);
      if (dayKey !== lastDay) {
        lastDay = dayKey;
        rows.push({ kind: "day-header", label: dayLabel(event.ts, now), key: dayKey });
      }
      rows.push({ kind: "event", event, eventIndex });
    });
    if (hasTrailing) rows.push({ kind: "trailing", count: trailingCount });
    return rows;
  }, [capped, hasTrailing, trailingCount, now]);

  const innerWidth = Math.max(20, width - 4);
  const contentRows = Math.max(4, height - 6);
  const summaryRows = 3;
  const selectedEvent = capped[selectedIndex];
  const detailRows = selectedEvent ? journalDetailRows(selectedEvent) : [];
  const canShowDetails = detailsOpen && selectedEvent !== undefined && contentRows >= 12;
  const detailBudget = canShowDetails
    ? Math.min(7, Math.max(4, Math.floor((contentRows - summaryRows) * 0.35)))
    : 0;
  const visibleRows = Math.max(3, contentRows - summaryRows - detailBudget);
  const maxEventIndex = capped.length - 1;

  useEffect(() => {
    setScrollOffset(0);
    setSelectedIndex(0);
  }, [filter, selectedRepoId, activeScope, kindFilter, rangeFilter]);

  useEffect(() => {
    setSelectedIndex((index) => clampJournalIndex(index, capped.length));
  }, [capped.length]);

  useEffect(() => {
    const maxScroll = Math.max(0, renderRows.length - visibleRows);
    setScrollOffset((offset) => Math.max(0, Math.min(maxScroll, offset)));
  }, [renderRows.length, visibleRows]);

  useEffect(() => {
    const selectedRowIdx = renderRows.findIndex(
      (r) => r.kind === "event" && r.eventIndex === selectedIndex
    );
    if (selectedRowIdx < 0) return;
    const maxScroll = Math.max(0, renderRows.length - visibleRows);
    if (selectedRowIdx < scrollOffset) {
      setScrollOffset(Math.max(0, selectedRowIdx));
    } else if (selectedRowIdx >= scrollOffset + visibleRows) {
      setScrollOffset(Math.min(maxScroll, selectedRowIdx - visibleRows + 1));
    }
  }, [selectedIndex, renderRows, scrollOffset, visibleRows]);

  useInput(
    (input, key) => {
      const pageJump = Math.max(1, visibleRows - 2);

      if (input === "f") {
        setKindFilter((kind) => nextInCycle(JOURNAL_KIND_FILTERS, kind));
        return;
      }
      if (input === "F") {
        setKindFilter((kind) => prevInCycle(JOURNAL_KIND_FILTERS, kind));
        return;
      }
      if (input === "t") {
        setRangeFilter((range) => nextInCycle(JOURNAL_RANGE_FILTERS, range));
        return;
      }
      if (input === "T") {
        setRangeFilter((range) => prevInCycle(JOURNAL_RANGE_FILTERS, range));
        return;
      }
      if (input === "d") {
        setDetailsOpen((open) => !open);
        return;
      }

      if (capped.length === 0) return;

      // Two-pane focus model: when this pane is focused, ↑↓ and j/k both
      // scroll the event list (vim aliases mirror arrows). When the
      // sidebar is focused, ReadyShell owns arrows for the repo cursor
      // and JournalView ignores both. Esc-toggle is owned by ReadyShell.
      if (paneFocused && (input === "k" || key.upArrow)) {
        setSelectedIndex((i) => Math.max(0, i - 1));
        return;
      }
      if (paneFocused && (input === "j" || key.downArrow)) {
        setSelectedIndex((i) => Math.min(maxEventIndex, i + 1));
        return;
      }
      if (key.pageUp) {
        setSelectedIndex((i) => Math.max(0, i - pageJump));
        return;
      }
      if (key.pageDown) {
        setSelectedIndex((i) => Math.min(maxEventIndex, i + pageJump));
        return;
      }
      if (key.home) {
        setSelectedIndex(0);
        return;
      }
      if (key.end) {
        setSelectedIndex(maxEventIndex);
        return;
      }
    },
    { isActive }
  );

  const resolveGlyphColor = (def: GlyphDef): string => {
    switch (def.colorKey) {
      case "error":
        return theme.colors.error;
      case "success":
        return theme.colors.success;
      case "info":
        return theme.colors.info;
      case "warning":
        return theme.colors.warning;
      case "vibe":
        return def.vibeTarget
          ? vibeColor(def.vibeTarget, theme.colors)
          : theme.colors.mutedForeground;
      default:
        return theme.colors.mutedForeground;
    }
  };

  const scopeLabel =
    activeScope === "focused"
      ? selectedCreature?.scan.name ?? "focused repo"
      : "home";

  const statsText = [
    `${stats.total} ${stats.total === 1 ? "event" : "events"}`,
    `${stats.repoCount} ${stats.repoCount === 1 ? "repo" : "repos"}`,
    `${stats.commitCount} commits`,
    `${stats.noteCount} notes`,
    `${stats.blockerCount} blockers`,
  ].join(" · ");

  const topRepoText = stats.topRepo
    ? ` · busiest ${truncate(stats.topRepo.repoName, 18)} (${stats.topRepo.count})`
    : "";

  const controlsText = [
    paneFocused ? "↑↓/jk events" : "↑↓/jk repo",
    `f ${journalKindLabel(kindFilter)}`,
    `t ${journalRangeLabel(rangeFilter)}`,
    `d ${detailsOpen ? "details" : "compact"}`,
    paneFocused ? "esc back to sidebar" : "↵ enter journal",
  ].join(" · ");

  const title = `journal · ${scopeLabel}`;
  const filterText = filter?.trim() ?? "";

  const header = (
    <Box flexDirection="column">
      <Box flexDirection="row" justifyContent="space-between" columnGap={2}>
        <Text color={theme.colors.foreground} wrap="truncate-end">
          {truncate(`${statsText}${topRepoText}`, Math.max(8, innerWidth - 20))}
        </Text>
        <Box flexShrink={0}>
          <Sparkline data={activity} width={Math.min(16, Math.max(8, innerWidth - 4))} color={theme.colors.primary} />
        </Box>
      </Box>
      <Text dimColor color={theme.colors.mutedForeground} wrap="truncate-end">
        {truncate(controlsText, innerWidth)}
      </Text>
      {filterText ? (
        <Text color={theme.colors.accent} wrap="truncate-end">
          search: {truncate(filterText, Math.max(8, innerWidth - 8))}
        </Text>
      ) : (
        <Text dimColor color={theme.colors.mutedForeground}>
          {"─".repeat(Math.max(1, innerWidth))}
        </Text>
      )}
    </Box>
  );

  // Focus-ring border when the journal pane owns keyboard focus. Matches the
  // workbench notes-editor convention (`theme.colors.focusRing` for the
  // active surface) so the two-pane focus model reads instantly without
  // documentation.
  const panelBorderColor = paneFocused ? theme.colors.focusRing : theme.colors.border;

  if (events.length === 0) {
    return (
      <Panel title="journal" width={width} height={height} paddingY={1} borderColor={panelBorderColor}>
        <Box flexGrow={1} alignItems="center" justifyContent="center" flexDirection="column">
          <Text dimColor color={theme.colors.mutedForeground}>
            the journal fills in as your repos change.
          </Text>
          <Text dimColor color={theme.colors.mutedForeground}>
            commits, notes, blockers, branches, and vibe shifts will appear here.
          </Text>
        </Box>
      </Panel>
    );
  }

  if (filteredEvents.length === 0) {
    return (
      <Panel title={title} width={width} height={height} paddingY={1} borderColor={panelBorderColor}>
        {header}
        <Box flexGrow={1} alignItems="center" justifyContent="center" flexDirection="column">
          <Text dimColor color={theme.colors.mutedForeground}>
            no journal entries match this view.
          </Text>
          <Text dimColor color={theme.colors.mutedForeground}>
            try ↑↓ to pick a repo, f/F for type, t/T for time, or / to clear search.
          </Text>
        </Box>
      </Panel>
    );
  }

  const GLYPH_W = 1;
  const TIME_W = 5;
  const REPO_W = Math.max(10, Math.min(18, Math.floor(innerWidth * 0.22)));
  const KIND_W = Math.max(6, Math.min(14, Math.floor(innerWidth * 0.18)));
  // Reserve one column for the right-edge scrollbar when the event list
  // overflows. The bar renders even when the pane is unfocused (the focus
  // indicator lives on the border, not the bar) but disappears when there's
  // nothing to scroll, so reclaim the column then.
  const scrollbarVisible = renderRows.length > visibleRows;
  const SCROLLBAR_W = scrollbarVisible ? 1 : 0;
  const FIXED_COLS = 1 + GLYPH_W + 1 + TIME_W + 1 + REPO_W + 1 + KIND_W + 1 + SCROLLBAR_W;
  const summaryWidth = Math.max(8, innerWidth - FIXED_COLS);
  const windowedRows = renderRows.slice(scrollOffset, scrollOffset + visibleRows);

  return (
    <Panel title={title} width={width} height={height} paddingY={1} borderColor={panelBorderColor}>
      {header}

      <Box flexDirection="row">
        <Box flexDirection="column" flexGrow={1}>
          {windowedRows.map((row, idx) => {
            if (row.kind === "day-header") {
              return (
                <Box key={`dh-${row.key}-${idx}`}>
                  <Text bold dimColor color={theme.colors.mutedForeground}>
                    {row.label}
                  </Text>
                </Box>
              );
            }

            if (row.kind === "trailing") {
              return (
                <Box key="trailing">
                  <Text dimColor color={theme.colors.mutedForeground}>
                    … {row.count} older {row.count === 1 ? "entry" : "entries"} hidden by the cap.
                  </Text>
                </Box>
              );
            }

            const { event, eventIndex } = row;
            const focused = eventIndex === selectedIndex;
            const glyphDef = glyphFor(event);
            const glyphColor = resolveGlyphColor(glyphDef);
            const timeStr = formatEventTime(event.ts);
            const repoStr = padTrunc(event.repoName, REPO_W);
            const kindStr = padTrunc(journalKindLabel(event.kind).replace(/^notes? /, "note "), KIND_W);
            // Pad to a fixed width so Ink's per-line diff always rewrites the full
            // column. With a bare `truncate` the rendered Text length contracts
            // between frames (e.g. a long previous-frame summary leaves residue
            // like `…"ences"` trailing a shorter current summary). Padding to
            // `summaryWidth` keeps the line's character count constant. See the
            // "loose end" entry in docs/manual-qa-report.md.
            const summary = padTrunc(eventSummary(event, summaryWidth), summaryWidth);

            return (
              <Box key={`ev-${event.ts}-${event.repoId}-${event.kind}-${eventIndex}-${idx}`} flexDirection="row">
                <Text color={focused ? theme.colors.primary : theme.colors.mutedForeground}>
                  {focused ? "▸" : " "}
                </Text>
                <Text color={glyphColor}>{glyphDef.glyph}</Text>
                <Text color={theme.colors.mutedForeground}> </Text>
                <Text dimColor color={theme.colors.mutedForeground}>{timeStr}</Text>
                <Text color={theme.colors.mutedForeground}> </Text>
                <Text color={focused ? theme.colors.primary : theme.colors.foreground} bold={focused}>
                  {repoStr}
                </Text>
                <Text color={theme.colors.mutedForeground}> </Text>
                <Text dimColor color={theme.colors.mutedForeground}>{kindStr}</Text>
                <Text color={theme.colors.mutedForeground}> </Text>
                <Text color={focused ? theme.colors.foreground : theme.colors.mutedForeground} wrap="truncate-end">
                  {summary}
                </Text>
              </Box>
            );
          })}
        </Box>
        {scrollbarVisible ? (
          <ScrollBar
            rows={visibleRows}
            total={renderRows.length}
            offset={scrollOffset}
            active={paneFocused}
          />
        ) : null}
      </Box>

      {canShowDetails && detailBudget > 0 ? (
        <Box flexDirection="column" borderStyle="single" borderColor={theme.colors.border} paddingX={1} marginTop={1}>
          <Text bold color={theme.colors.primary}>selected event</Text>
          {detailRows.slice(0, Math.max(0, detailBudget - 1)).map((row) => (
            <Box key={`${row.label}-${row.value}`} flexDirection="row">
              <Text dimColor color={theme.colors.mutedForeground}>
                {padTrunc(row.label, 9)}
              </Text>
              <Text color={theme.colors.foreground} wrap="truncate-end">
                {truncate(row.value, Math.max(8, innerWidth - 12))}
              </Text>
            </Box>
          ))}
        </Box>
      ) : null}
    </Panel>
  );
};
