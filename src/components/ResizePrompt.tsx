import { Box, Text } from "ink";

import { useTheme } from "@/components/ui/theme-provider";
import { MIN_COLUMNS, MIN_ROWS } from "@/lib/responsive-layout";

export interface ResizePromptProps {
  columns: number;
  rows: number;
  title?: string;
}

export const ResizePrompt = ({ columns, rows, title = "REPOGARDEN" }: ResizePromptProps) => {
  const theme = useTheme();
  return (
    <Box flexDirection="column" paddingX={1} paddingY={1} height={Math.max(1, rows)} overflow="hidden">
      <Text bold color={theme.colors.primary}>{title}</Text>
      <Text color={theme.colors.warning}>terminal is too small</Text>
      <Text dimColor color={theme.colors.mutedForeground}>
        current {columns}x{rows} · minimum {MIN_COLUMNS}x{MIN_ROWS}
      </Text>
      <Box paddingTop={1}>
        <Text dimColor color={theme.colors.mutedForeground}>
          resize the terminal to keep RepoGarden readable.
        </Text>
      </Box>
    </Box>
  );
};

