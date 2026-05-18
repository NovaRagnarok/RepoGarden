import { Box, Text } from "ink";
import type { ReactNode } from "react";

import { useTheme } from "@/components/ui/theme-provider";

export interface PanelProps {
  title?: string;
  titleColor?: string;
  borderColor?: string;
  borderStyle?:
    | "single"
    | "double"
    | "round"
    | "bold"
    | "singleDouble"
    | "doubleSingle"
    | "classic";
  bordered?: boolean;
  width?: number;
  height?: number;
  paddingX?: number;
  paddingY?: number;
  children?: ReactNode;
}

export const Panel = ({
  title,
  titleColor,
  borderColor,
  borderStyle,
  bordered = true,
  width,
  height,
  paddingX = 1,
  paddingY = 0,
  children,
}: PanelProps) => {
  const theme = useTheme();

  const inner = (
    <>
      {title && (
        // flexShrink={0} keeps the title's bordered Box at its natural
        // 3-row height. Without it Yoga can collapse the title to 2 rows
        // when the enclosing screen is height-pressed, fusing its bottom
        // border with the panel's content below.
        <Box
          paddingX={paddingX}
          borderStyle="single"
          borderColor={borderColor ?? theme.colors.border}
          flexShrink={0}
        >
          <Text bold color={titleColor ?? theme.colors.primary}>
            {title}
          </Text>
        </Box>
      )}
      {/* flexGrow={1} so the content area fills the Panel's height when one
          is supplied. Children with their own flex spacers can then pin
          themselves to the bottom (e.g. the sidebar's status row). When no
          height is set, this still behaves like an unsized column. */}
      <Box
        flexDirection="column"
        paddingX={paddingX}
        paddingY={paddingY}
        flexGrow={1}
      >
        {children}
      </Box>
    </>
  );

  // flexShrink={0} on the outer Panel box is the load-bearing fix for the
  // manual-qa B3 family: at small terminal heights the workbench's
  // section-content Panel was being shrunk to ~3 rows (just the title
  // border) and its actual content escaped *below* the bottom border.
  // Pinning shrink to 0 preserves the natural height; the outer container
  // already owns overflow="hidden" so clipping (rather than collapse)
  // becomes the failure mode at very small sizes.
  if (!bordered) {
    return (
      <Box flexDirection="column" width={width} height={height} flexShrink={0}>
        {inner}
      </Box>
    );
  }

  return (
    <Box
      flexDirection="column"
      borderStyle={borderStyle ?? theme.border.style}
      borderColor={borderColor ?? theme.colors.border}
      width={width}
      height={height}
      flexShrink={0}
    >
      {inner}
    </Box>
  );
};
