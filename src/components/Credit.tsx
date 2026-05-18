import { Box } from "ink";
import { Link } from "@/components/ui/link";
import { useTheme } from "@/components/ui/theme-provider";

export const Credit = () => {
  const theme = useTheme();
  // fallback={false} suppresses the " (https://…)" inline URL on terminals
  // without OSC-8 hyperlink support. The URL was tipping the footer past the
  // hotbar's reserved width on narrow screens (Settings et al), wrapping the
  // tail onto a second line and leaving stale chars from the previous frame
  // visible (manual-qa-report B6). The brand mark still reads, and on
  // hyperlink-capable terminals the OSC-8 escape keeps the link clickable.
  return (
    <Box flexDirection="row" flexShrink={0}>
      <Link
        href="https://github.com/NovaRagnarok/RepoGarden"
        color={theme.colors.mutedForeground}
        fallback={false}
      >
        ★ RepoGarden
      </Link>
    </Box>
  );
};
