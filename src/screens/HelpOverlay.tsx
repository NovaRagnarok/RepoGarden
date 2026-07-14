import { Box, Text } from "ink";
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
  { key: "↑↓", description: "move focus", category: "garden" },
  { key: "↵", description: "open workbench", category: "garden" },
  { key: "/", description: "filter (or search summaries in journal)", category: "garden" },
  { key: "g", description: "cycle garden / shelf / journal", category: "garden" },
  { key: "[ / ]", description: "previous / next garden page (when crowded)", category: "garden" },
  { key: "o", description: "open folder", category: "garden" },
  { key: "h", description: "hide / unhide", category: "garden" },
  { key: "c", description: "toggle focus card", category: "garden" },
  { key: "x", description: "export habitat as animated GIF (~/Downloads)", category: "garden" },
  { key: "t / T", description: "copy habitat as text — small (≤2000 chars, Discord-ready) / big (full canvas)", category: "garden" },
  { key: "r", description: "rescan roots", category: "garden" },
  { key: "p", description: "edit scan paths", category: "garden" },
  { key: "↑↓ / jk", description: "journal: scroll focused pane (events or sidebar)", category: "garden" },
  { key: "↵", description: "journal: drill into event pane from the sidebar", category: "garden" },
  { key: "esc", description: "journal: clear filter, else back to sidebar / toggle pane", category: "garden" },
  { key: "f / F", description: "journal: type filter", category: "garden" },
  { key: "t / T", description: "journal: time range", category: "garden" },
  { key: "d", description: "journal: toggle event details", category: "garden" },
  { key: "ctrl+1 / ctrl+2", description: "switch portrait / notes mode", category: "workbench" },
  { key: "1-6 / ←→", description: "portrait: change section", category: "workbench" },
  { key: "PgUp / PgDn", description: "portrait: scroll list section", category: "workbench" },
  { key: "a / v", description: "portrait: actions / overview", category: "workbench" },
  { key: "↵ / d", description: "portrait: inspect action / toggle details", category: "workbench" },
  { key: "n", description: "portrait: open notes", category: "workbench" },
  { key: "c / p / r", description: "portrait: copy summary / path / refresh", category: "workbench" },
  { key: "ctrl+n / ctrl+r / ctrl+d", description: "notes: new / rename / delete", category: "workbench" },
  { key: "ctrl+← / ctrl+→", description: "notes: switch", category: "workbench" },
  { key: "ctrl+s / ctrl+↵", description: "notes: save", category: "workbench" },
  { key: "ctrl+p", description: "notes: command palette", category: "workbench" },
  { key: "s", description: "settings", category: "anywhere" },
  { key: "m", description: "mask names + sensitive content", category: "anywhere" },
  { key: "U", description: "claude / codex usage details", category: "anywhere" },
  { key: "?", description: "this help", category: "anywhere" },
  { key: "esc", description: "back / close", category: "anywhere" },
  { key: "q", description: "quit", category: "anywhere" },
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
    "garden  ↑↓ pick · ↵ open · / filter · g view · h hide · [/] page",
    "share  x gif · t small text · T big text",
    "journal  ↑↓/jk scroll · ↵ enter pane · esc back · f/F type · t/T time · d details",
    "workbench  1-6 section · n notes · ctrl+1/2 mode",
    "notes  ctrl+n new · ctrl+p palette · ctrl+s save",
    "anywhere  r rescan · p roots · s settings · m mask · ? help · q quit",
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
