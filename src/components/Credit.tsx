import { Box, Text } from "ink";
import React from "react";

import { Link } from "@/components/ui/link";
import { useTheme } from "@/components/ui/theme-provider";

export const Credit = () => {
  const theme = useTheme();
  return (
    <Box flexDirection="row">
      <Text dimColor color={theme.colors.mutedForeground}>
        created by{" "}
      </Text>
      <Link href="https://github.com/NovaRagnarok/" color={theme.colors.mutedForeground}>
        Outsideheaven
      </Link>
    </Box>
  );
};
