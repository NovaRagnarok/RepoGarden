import { Box, Text } from "ink";
import { useTheme } from "@/components/ui/theme-provider";

export interface PaginationProps {
  /** Total number of pages. Component renders nothing when total <= 1. */
  total: number;
  /** 1-indexed active page. */
  current: number;
  /** Number of pages to show on each side of the active page before
   *  collapsing to ellipses. Only used when total > 7. */
  siblings?: number;
}

// Adapted from termcn's Ink pagination component (shadcn-labs/termcn) — same
// visual treatment (numbered with [N] bracket on active, ‹ › chevrons,
// ellipses for large ranges) but stripped of the internal useInput so the
// host owns its own keybindings. Page changes happen via parent state; this
// component only renders the indicator.
const buildPages = (total: number, current: number, siblings: number): (number | "...")[] => {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  const pages: (number | "...")[] = [1];
  const leftSibling = Math.max(2, current - siblings);
  const rightSibling = Math.min(total - 1, current + siblings);
  if (leftSibling > 2) pages.push("...");
  for (let i = leftSibling; i <= rightSibling; i += 1) pages.push(i);
  if (rightSibling < total - 1) pages.push("...");
  pages.push(total);
  return pages;
};

export const Pagination = ({ total, current, siblings = 1 }: PaginationProps) => {
  const theme = useTheme();
  if (total <= 1) return null;
  const clamped = Math.min(Math.max(1, current), total);
  const pages = buildPages(total, clamped, siblings);
  const atFirst = clamped === 1;
  const atLast = clamped === total;
  return (
    <Box flexDirection="row" alignItems="center" gap={1}>
      <Text color={atFirst ? theme.colors.mutedForeground : theme.colors.primary} dimColor={atFirst}>
        ‹
      </Text>
      {pages.map((p, idx) => {
        if (p === "...") {
          return (
            <Text key={`ellipsis-${idx}`} color={theme.colors.mutedForeground}>
              …
            </Text>
          );
        }
        const isActive = p === clamped;
        return (
          <Text
            key={p}
            color={isActive ? theme.colors.primary : theme.colors.mutedForeground}
            bold={isActive}
          >
            {isActive ? `[${p}]` : `${p}`}
          </Text>
        );
      })}
      <Text color={atLast ? theme.colors.mutedForeground : theme.colors.primary} dimColor={atLast}>
        ›
      </Text>
    </Box>
  );
};
