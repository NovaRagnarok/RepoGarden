import { Box } from "ink";
import React from "react";

import { Link } from "@/components/ui/link";
import { useTheme } from "@/components/ui/theme-provider";

export const Credit = () => {
  const theme = useTheme();
  return (
    <Box flexDirection="row">
      <Link href="https://github.com/NovaRagnarok/RepoGarden" color={theme.colors.mutedForeground}>
        ★ RepoGarden
      </Link>
    </Box>
  );
};
