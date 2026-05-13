import { Box, Text } from "ink";

import { useMotion, useTheme } from "@/components/ui/theme-provider";
import { useAnimation } from "@/hooks/use-animation";

export interface SkeletonProps {
  width?: number;
  height?: number;
  animated?: boolean;
}

export const Skeleton = ({
  width = 20,
  height = 1,
  animated = true,
}: SkeletonProps) => {
  const theme = useTheme();
  const { reduced } = useMotion();
  const frame = useAnimation(4);

  // Reduced motion: render the static dots field with no traveling shimmer
  // band. Same shape, no movement.
  const motionActive = animated && !reduced;
  const offset = motionActive ? frame % (width + 6) : -1;

  const _buildRow = (): string => {
    let row = "";
    for (let i = 0; i < width; i += 1) {
      const inHighlight = i >= offset - 3 && i <= offset + 3;
      row += inHighlight ? "█" : "░";
    }
    return row;
  };

  const rows = Array.from({ length: height }, (_, rowIndex) => {
    const rowOffset = motionActive ? (frame + rowIndex * 2) % (width + 6) : -1;
    let row = "";
    for (let i = 0; i < width; i += 1) {
      const inHighlight = i >= rowOffset - 3 && i <= rowOffset + 3;
      row += inHighlight ? "█" : "░";
    }
    return row;
  });

  return (
    <Box flexDirection="column">
      {rows.map((row, i) => (
        <Text key={i}>
          {[...row].map((char, j) => (
            <Text
              key={j}
              color={
                char === "█" ? theme.colors.mutedForeground : theme.colors.muted
              }
            >
              {char}
            </Text>
          ))}
        </Text>
      ))}
    </Box>
  );
};
