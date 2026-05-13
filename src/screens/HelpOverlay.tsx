import { Box, Text } from "ink";
import React from "react";

import { Credit } from "@/components/Credit";
import { KeyboardShortcuts, type Shortcut } from "@/components/ui/keyboard-shortcuts";
import { Panel } from "@/components/ui/panel";
import { ResizePrompt } from "@/components/ResizePrompt";
import { useTheme } from "@/components/ui/theme-provider";
import { useInput } from "@/hooks/use-input";
import { useTerminalSize } from "@/hooks/use-terminal-size";
import { getTerminalLayout } from "@/lib/responsive-layout";

export interface HelpOverlayProps {
  onClose: () => void;
}

const shortcuts: Shortcut[] = [
  { key: "↑↓ / jk", description: "move focus", category: "garden" },
  { key: "/", description: "filter (names in garden/shelf; summaries in journal)", category: "garden" },
  { key: "↵", description: "open workbench for focused repo", category: "garden" },
  { key: "o", description: "open folder", category: "garden" },
  { key: "h", description: "hide / unhide", category: "garden" },
  { key: "c", description: "toggle focus overlay card (garden/shelf)", category: "garden" },
  { key: "g", description: "cycle garden / shelf / journal view", category: "garden" },
  { key: "PgUp / PgDn", description: "journal: page through entries", category: "garden" },
  { key: "Home / End", description: "journal: jump to first / last entry", category: "garden" },
  { key: "f / F", description: "journal: next / previous event type", category: "garden" },
  { key: "t / T", description: "journal: next / previous time range", category: "garden" },
  { key: "d", description: "journal: toggle selected event details", category: "garden" },
  { key: "jk", description: "journal: scroll events (↑↓ moves sidebar)", category: "garden" },
  { key: "r", description: "rescan roots", category: "garden" },
  { key: "p", description: "edit scan paths", category: "garden" },
  { key: "q", description: "quit", category: "garden" },
  { key: "click PORTRAIT / NOTES", description: "switch workbench mode", category: "workbench" },
  { key: "ctrl+1 / ctrl+2", description: "switch portrait / notes", category: "workbench" },
  { key: "1-6 / j/k / ←→", description: "portrait: change section", category: "workbench" },
  { key: "a / v", description: "portrait: jump to actions / overview", category: "workbench" },
  { key: "enter / d", description: "portrait: follow action / toggle details", category: "workbench" },
  { key: "n", description: "portrait: open notes", category: "workbench" },
  { key: "c / p / r", description: "portrait: copy summary / copy path / refresh", category: "workbench" },
  { key: "ctrl+← / ctrl+→", description: "notes: switch notes", category: "workbench" },
  { key: "tab / shift+tab", description: "notes: indent / outdent", category: "workbench" },
  { key: "ctrl+n / ctrl+r / ctrl+d", description: "notes: new / rename / delete", category: "workbench" },
  { key: "ctrl+s / ctrl+↵", description: "save note (notes mode)", category: "workbench" },
  { key: "ctrl+v / ctrl+x / ctrl+z", description: "notes: paste / cut / undo", category: "workbench" },
  { key: "ctrl+p", description: "command palette (notes mode)", category: "workbench" },
  { key: "s", description: "settings", category: "anywhere" },
  { key: "?", description: "this help", category: "anywhere" },
  { key: "esc", description: "back / close", category: "anywhere" },
];

export const HelpOverlay = ({ onClose }: HelpOverlayProps) => {
  const theme = useTheme();
  const { columns, rows } = useTerminalSize();
  const responsive = getTerminalLayout(columns, rows);
  const fullWidth = Math.max(20, columns - 2);
  // See WorkbenchScreen for the rationale: keep outputHeight strictly under
  // stdout.rows so Ink stays on the log-update path between screen
  // transitions. At small terminal heights this clips the bottom rows of
  // the shortcut list, which is better than the half-screen artifact you
  // get when Ink falls back to its clearTerminal branch.
  const containerHeight = Math.max(8, rows - 1);

  useInput((input, key) => {
    if (key.escape || input === "?" || input === "q") {
      onClose();
    }
  });

  if (responsive.tier === "too-small") {
    return <ResizePrompt columns={columns} rows={rows} title="HELP" />;
  }

  const compactRows = [
    "garden: ↑↓/jk pick · ↵ workbench · o folder · h hide · / filter",
    "views: g cycles garden/shelf/journal · r rescan · p roots · s settings",
    "journal: ↑↓ repo · jk events · f/F type · t/T time · d details",
    "workbench: 1-6 section · enter details/action · n notes · ctrl+1/2 mode",
    "notes: ctrl+n new · ctrl+f find · ctrl+p palette · auto-save",
    "anywhere: ? help · esc back · q quit",
  ];

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1} height={containerHeight} overflow="hidden">
      <Box flexDirection="column" paddingBottom={1}>
        <Text dimColor color={theme.colors.mutedForeground}>
          help
        </Text>
        <Text bold color={theme.colors.primary}>
          keyboard shortcuts
        </Text>
      </Box>

      <Panel title="shortcuts" paddingY={1} width={fullWidth}>
        {responsive.tier === "compact" ? (
          <Box flexDirection="column">
            {compactRows.map((row) => (
              <Text key={row} wrap="truncate-end">
                {row}
              </Text>
            ))}
          </Box>
        ) : (
          <KeyboardShortcuts
            shortcuts={shortcuts}
            columns={columns >= 100 ? 2 : 1}
          />
        )}
      </Panel>

      <Box paddingTop={1} flexDirection="row" justifyContent="space-between">
        <Text dimColor color={theme.colors.mutedForeground}>
          esc / ? close
        </Text>
        <Credit />
      </Box>
    </Box>
  );
};
