import { Box, Text } from "ink";
import React, { useState } from "react";

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
  onScan: (path: string) => void;
  onCancel?: () => void;
  scanStatus?: { kind: "idle" | "scanning" | "error" | "ok"; message: string };
  /** When true, shows "edit roots" copy instead of first-run copy. */
  editing?: boolean;
}

export const OnboardingScreen = ({
  initialPath = "",
  onScan,
  onCancel,
  scanStatus,
  editing = false
}: OnboardingScreenProps) => {
  const theme = useTheme();
  const { columns, rows } = useTerminalSize();
  const responsive = getTerminalLayout(columns, rows);
  const mode = layoutMode(columns);
  const [value, setValue] = useState(initialPath);
  // Keep outputHeight strictly under stdout.rows so transitions away from
  // and back to this screen stay on Ink's log-update path. See
  // WorkbenchScreen for the underlying Ink quirk.
  const containerHeight = Math.max(8, rows - 1);

  useInput((input, key) => {
    if (key.return) {
      const trimmed = value.trim();
      if (trimmed) {
        onScan(trimmed);
      }
      return;
    }
    if (key.backspace || key.delete) {
      setValue((current) => current.slice(0, -1));
      return;
    }
    if (key.escape) {
      onCancel?.();
      return;
    }
    if (key.upArrow || key.downArrow || key.tab) {
      return;
    }
    if (input && !key.ctrl && !key.meta) {
      setValue((current) => current + input);
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
            {editing ? "EDIT ROOTS" : "FIRST RUN"}
          </Badge>
        </Box>
      </Box>
      <Box paddingBottom={1} paddingTop={1}>
        <Text wrap="truncate-end">
          {editing
            ? "swap or add scan roots — one per path. Enter rescans, esc cancels."
            : "open app → see repo creatures → remember the smallest next move."}
        </Text>
      </Box>

      <Panel title={editing ? "scan roots" : "choose where your repos live"} paddingY={1}>
        {!editing && responsive.showRichChrome ? (
          <>
            <Box flexDirection="column" paddingBottom={1}>
              <Text>RepoGarden turns local git repos into little creatures.</Text>
              <Text>sleepy, blocked, or noisy creatures are the ones asking for attention.</Text>
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
          </>
        ) : null}

        <Box flexDirection="column" paddingBottom={1}>
          <Text dimColor color={theme.colors.mutedForeground}>
            one or more folders, comma-separated — Enter to {editing ? "rescan" : "scan"}
          </Text>
          <Box
            borderStyle={theme.border.style}
            borderColor={theme.border.focusColor}
            paddingX={1}
          >
            <Text color={theme.colors.primary}>{"> "}</Text>
            <Text color={theme.colors.foreground} wrap="truncate-end">{value || " "}</Text>
            <Text color={theme.colors.focusRing}>█</Text>
          </Box>
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
          {editing ? "enter rescan · esc cancel" : "enter scan · esc quit"}
        </Text>
        <Credit />
      </Box>
    </Box>
  );
};
