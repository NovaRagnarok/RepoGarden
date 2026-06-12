import { Box, Text } from "ink";
import { useCallback, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { BigText } from "@/components/ui/big-text";
import { Credit } from "@/components/Credit";
import { Panel } from "@/components/ui/panel";
import { useTheme } from "@/components/ui/theme-provider";
import { useInput } from "@/hooks/use-input";
import { layoutMode, useTerminalSize } from "@/hooks/use-terminal-size";
import { ResizePrompt } from "@/components/ResizePrompt";
import { getTerminalLayout } from "@/lib/responsive-layout";

export interface OnboardingScreenProps {
  initialPath?: string;
  onScan: (path: string) => void | Promise<void>;
  onScanError?: (error: unknown) => void;
  onCancel?: () => void;
  /** Optional: when provided, the screen surfaces a demo-mode affordance
   *  (a one-line suggestion + the `d` hotkey). Used on first-run and on the
   *  contextual empty-state where the user just wants to preview the app. */
  onTryDemo?: () => void;
  /** Optional: when provided, the screen surfaces a settings affordance via
   *  the `s` hotkey. Wired by the contextual empty-state. */
  onOpenSettings?: () => void;
  scanStatus?: { kind: "idle" | "scanning" | "error" | "ok"; message: string };
  /** When true, shows "edit roots" copy instead of first-run copy. */
  editing?: boolean;
  /** Roots that produced the current scanStatus. When this is non-empty and
   *  scanStatus.kind === "error", the screen renders the contextual empty
   *  state ("we scanned X and found nothing") instead of the first-run hero. */
  scannedRoots?: string[];
}

export const OnboardingScreen = ({
  initialPath = "",
  onScan,
  onScanError,
  onCancel,
  onTryDemo,
  onOpenSettings,
  scanStatus,
  editing = false,
  scannedRoots
}: OnboardingScreenProps) => {
  const theme = useTheme();
  const { columns, rows } = useTerminalSize();
  const responsive = getTerminalLayout(columns, rows);
  const mode = layoutMode(columns);
  const [value, setValue] = useState(initialPath);
  // Track whether the user has touched the input. A pristine field (still
  // matching initialPath) lets the affordance hotkeys (d/s) fire even when
  // we seeded it with prior roots in the empty-state context. Once the user
  // edits a single character, the input wins and those keys append text.
  const [pristine, setPristine] = useState(true);
  // Keep outputHeight strictly under stdout.rows so transitions away from
  // and back to this screen stay on Ink's log-update path. See
  // WorkbenchScreen for the underlying Ink quirk.
  const containerHeight = Math.max(8, rows - 1);

  // The contextual empty-state kicks in when a scan finished but turned
  // up nothing (or errored) AND we know which paths got scanned. We drop
  // the hero copy for a "here's what happened, here's what to try" block.
  // editing always wins so the existing edit-roots flow keeps its current
  // affordances. We key off scanStatus rather than just root count so a
  // fresh launch with previously-saved roots still shows the hero until
  // the scan actually reports back.
  const showEmptyState =
    !editing && scanStatus?.kind === "error" && (scannedRoots?.length ?? 0) > 0;

  const reportScanError = useCallback(
    (error: unknown) => {
      try {
        onScanError?.(error);
      } catch {
        // Avoid converting an error-reporting failure into an unhandled scan rejection.
      }
    },
    [onScanError]
  );

  const submitScan = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed) return;
    try {
      void Promise.resolve(onScan(trimmed)).catch(reportScanError);
    } catch (error) {
      reportScanError(error);
    }
  }, [onScan, reportScanError, value]);

  useInput((input, key) => {
    if (key.return) {
      submitScan();
      return;
    }
    if (key.backspace || key.delete) {
      setValue((current) => current.slice(0, -1));
      setPristine(false);
      return;
    }
    if (key.escape) {
      onCancel?.();
      return;
    }
    if (key.upArrow || key.downArrow || key.tab) {
      return;
    }
    // Affordance hotkeys (d, s) only fire while the input is pristine —
    // either empty (first-run) or still matching the seed value the parent
    // pre-filled (post-empty-scan, where roots are echoed back so the user
    // can rescan without retyping). The instant the user types or deletes
    // anything, the input is "active" and `d`/`s` start appending text.
    if (!key.ctrl && !key.meta && pristine) {
      if (input === "d" && onTryDemo) {
        onTryDemo();
        return;
      }
      if (input === "s" && onOpenSettings) {
        onOpenSettings();
        return;
      }
    }
    if (input && !key.ctrl && !key.meta) {
      setValue((current) => current + input);
      setPristine(false);
    }
  });

  const isScanning = scanStatus?.kind === "scanning";

  if (responsive.tier === "too-small") {
    return <ResizePrompt columns={columns} rows={rows} />;
  }

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1} height={containerHeight} overflow="hidden">
      <Box flexDirection={mode === "narrow" ? "column" : "row"} justifyContent="space-between">
        <Box flexDirection="column">
          <Text dimColor color={theme.colors.mutedForeground}>
            a little local habitat
          </Text>
          {responsive.showBigBranding ? (
            <BigText font="slim" color={theme.colors.primary}>
              repogarden
            </BigText>
          ) : (
            <Text bold color={theme.colors.primary}>
              REPOGARDEN
            </Text>
          )}
        </Box>
        <Box marginTop={mode === "narrow" ? 1 : 0}>
          <Badge variant="default" bold>
            {editing ? "EDIT ROOTS" : showEmptyState ? "NO REPOS FOUND" : "FIRST RUN"}
          </Badge>
        </Box>
      </Box>
      <Box paddingBottom={1} paddingTop={1}>
        <Text wrap="truncate-end">
          {editing
            ? "swap or add scan roots — one per path. Enter rescans, esc cancels."
            : showEmptyState
              ? "nothing turned up in the folders you configured. a few ways forward."
              : "open app → see repo creatures → remember the smallest next move."}
        </Text>
      </Box>

      <Panel
        title={
          editing
            ? "scan roots"
            : showEmptyState
              ? "where to go from here"
              : "choose where your repos live"
        }
        paddingY={1}
      >
        {showEmptyState ? (
          <Box flexDirection="column" paddingBottom={1}>
            <Text dimColor color={theme.colors.mutedForeground}>
              scanned:
            </Text>
            {(scannedRoots ?? []).map((root) => (
              <Text key={root} color={theme.colors.foreground} wrap="truncate-end">
                {"  · "}
                {root}
              </Text>
            ))}
            <Box paddingTop={1} flexDirection="column">
              <Text>
                no git repos found there. typo, wrong path, or just no folders
                yet — any of these help:
              </Text>
              <Box paddingTop={1} flexDirection="column">
                {onTryDemo ? (
                  <Text>
                    <Text color={theme.colors.primary} bold>{"  d  "}</Text>
                    try demo mode — preview the garden with synthetic repos
                  </Text>
                ) : null}
                {onOpenSettings ? (
                  <Text>
                    <Text color={theme.colors.primary} bold>{"  s  "}</Text>
                    open settings — themes, observer, usage bar
                  </Text>
                ) : null}
                <Text>
                  <Text color={theme.colors.primary} bold>{"  ↵  "}</Text>
                  edit the path below and press enter to rescan
                </Text>
              </Box>
            </Box>
          </Box>
        ) : null}

        {!editing && !showEmptyState && responsive.showRichChrome ? (
          <>
            <Box flexDirection="column" paddingBottom={1}>
              <Text>RepoGarden turns local git repos into little creatures.</Text>
              <Text>awake, happy, stuck, and sleepy creatures show where each repo stands.</Text>
            </Box>

            <Box flexDirection="column" paddingBottom={1}>
              <Text bold color={theme.colors.primary}>
                the loop
              </Text>
              <Text>1. see your repos as creatures</Text>
              <Text>2. press one for where you left off</Text>
              <Text>3. open the folder and do one small thing</Text>
              <Text>4. come back later and pick up the trail</Text>
            </Box>

            <Box flexDirection="column" paddingBottom={1}>
              <Text dimColor color={theme.colors.mutedForeground}>
                stays local · reads only the folders you give it
              </Text>
              <Text dimColor color={theme.colors.mutedForeground}>
                app state lives in ~/.repogarden · safe to delete
              </Text>
            </Box>
          </>
        ) : null}

        <Box flexDirection="column" paddingBottom={1}>
          <Text dimColor color={theme.colors.mutedForeground}>
            one or more folders, comma-separated — Enter to {editing ? "rescan" : "scan"}
          </Text>
          {/* minHeight={3} pins this to top-border / content / bottom-border.
              Without it, Ink/Yoga occasionally collapses the inline-Text content
              row to height 0 under a height-constrained ancestor and the box
              renders as two adjacent border lines (manual-qa-report B7). */}
          <Box
            borderStyle={theme.border.style}
            borderColor={theme.border.focusColor}
            paddingX={1}
            minHeight={3}
          >
            <Text color={theme.colors.primary}>{"> "}</Text>
            <Text color={theme.colors.foreground} wrap="truncate-end">{value || " "}</Text>
            <Text color={theme.colors.focusRing}>█</Text>
          </Box>
          {!editing && !showEmptyState && onTryDemo ? (
            <Box paddingTop={1}>
              <Text dimColor color={theme.colors.mutedForeground} wrap="truncate-end">
                or press <Text color={theme.colors.primary} bold>d</Text>
                {" "}to preview the garden with synthetic repos first
              </Text>
            </Box>
          ) : null}
        </Box>

        {scanStatus ? (
          <Text
            color={
              scanStatus.kind === "error"
                ? theme.colors.error
                : scanStatus.kind === "ok"
                  ? theme.colors.success
                  : theme.colors.mutedForeground
            }
          >
            {isScanning ? "scanning… " : ""}
            {scanStatus.message}
          </Text>
        ) : null}
      </Panel>

      <Box paddingTop={1} flexDirection="row" justifyContent="space-between">
        <Text dimColor color={theme.colors.mutedForeground} wrap="truncate-end">
          {editing
            ? "enter rescan · esc cancel"
            : showEmptyState
              ? `${onTryDemo ? "d demo · " : ""}${onOpenSettings ? "s settings · " : ""}enter rescan · esc quit`
              : `enter scan${onTryDemo ? " · d demo" : ""} · esc quit`}
        </Text>
        <Credit />
      </Box>
    </Box>
  );
};
