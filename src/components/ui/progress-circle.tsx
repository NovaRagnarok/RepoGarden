import { Box, Text } from "ink";

import { useTheme } from "@/components/ui/theme-provider";

export type ProgressCircleSize = "sm" | "md" | "lg";

export interface ProgressCircleProps {
  value: number;
  size?: ProgressCircleSize;
  color?: string;
  label?: string;
  showPercent?: boolean;
}

const FILL_CHARS = ["○", "◔", "◑", "◕", "●"];

const getSmChar = (value: number): string => {
  const clamped = Math.max(0, Math.min(100, value));
  const step = Math.floor((clamped / 100) * (FILL_CHARS.length - 1));
  return FILL_CHARS[step];
};

export const ProgressCircle = ({
  value,
  size = "sm",
  color,
  label,
  showPercent = false,
}: ProgressCircleProps) => {
  const theme = useTheme();
  const clamped = Math.max(0, Math.min(100, value));
  const resolvedColor = color ?? theme.colors.primary;
  const percentLabel = `${Math.round(clamped)}%`;

  if (size === "sm") {
    const char = getSmChar(clamped);
    return (
      <Box flexDirection="row" gap={1}>
        <Text color={resolvedColor}>{char}</Text>
        {showPercent && (
          <Text color={theme.colors.mutedForeground}>{percentLabel}</Text>
        )}
        {label && <Text color={theme.colors.mutedForeground}>{label}</Text>}
      </Box>
    );
  }

  if (size === "md") {
    return (
      <Box flexDirection="column" alignItems="flex-start">
        <Box flexDirection="row">
          <Text color={resolvedColor}>⟨</Text>
          <Text color={resolvedColor} bold>
            {percentLabel}
          </Text>
          <Text color={resolvedColor}>⟩</Text>
        </Box>
        {label && <Text color={theme.colors.mutedForeground}>{label}</Text>}
      </Box>
    );
  }

  const fillLevel = clamped / 100;
  const topArc = " ▄█▄";
  const midLeft = "█";
  const midRight = "█";
  const midInner = fillLevel >= 0.5 ? "███" : "   ";
  const botArc = " ▀█▀";

  return (
    <Box flexDirection="column" alignItems="flex-start">
      <Text color={resolvedColor}>{topArc}</Text>
      <Box flexDirection="row">
        <Text color={resolvedColor}>{midLeft}</Text>
        <Text color={fillLevel > 0 ? resolvedColor : theme.colors.muted}>
          {midInner}
        </Text>
        <Text color={resolvedColor}>{midRight}</Text>
      </Box>
      <Text color={resolvedColor}>{botArc}</Text>
      {showPercent && (
        <Text color={theme.colors.mutedForeground}>{percentLabel}</Text>
      )}
      {label && <Text color={theme.colors.mutedForeground}>{label}</Text>}
    </Box>
  );
};
