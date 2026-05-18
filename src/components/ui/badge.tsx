import { Box, Text } from "ink";

import { useTheme } from "@/components/ui/theme-provider";

export type BadgeVariant =
  | "default"
  | "success"
  | "warning"
  | "error"
  | "info"
  | "secondary";

export interface BadgeProps {
  children: string;
  variant?: BadgeVariant;
  color?: string;
  bold?: boolean;
  bordered?: boolean;
  borderStyle?:
    | "single"
    | "double"
    | "round"
    | "bold"
    | "singleDouble"
    | "doubleSingle"
    | "classic";
  paddingX?: number;
}

export const Badge = ({
  children,
  variant = "default",
  color,
  bold = false,
  bordered = true,
  borderStyle = "round",
  paddingX = 1,
}: BadgeProps) => {
  const theme = useTheme();

  const variantColor =
    color ??
    (() => {
      switch (variant) {
        case "success": {
          return theme.colors.success;
        }
        case "warning": {
          return theme.colors.warning;
        }
        case "error": {
          return theme.colors.error;
        }
        case "info": {
          return theme.colors.info;
        }
        case "secondary": {
          return theme.colors.secondary;
        }
        default: {
          return theme.colors.primary;
        }
      }
    })();

  if (!bordered) {
    return (
      <Text color={variantColor} bold={bold}>
        {children}
      </Text>
    );
  }

  // flexShrink={0} keeps the bordered badge at its natural 3-row height even
  // when a constrained-height parent (workbench, overlays) runs out of
  // vertical space. Without it Yoga shrinks the box to 2 rows and the
  // bottom border fuses with the next sibling row — see manual-qa B3 where
  // the section tabs' bottom border collided with the alert text below.
  return (
    <Box
      borderStyle={borderStyle}
      borderColor={variantColor}
      paddingX={paddingX}
      flexShrink={0}
    >
      <Text color={variantColor} bold={bold}>
        {children}
      </Text>
    </Box>
  );
};
