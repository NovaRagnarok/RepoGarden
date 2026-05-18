import { Box, Text } from "ink";

import { useTheme } from "@/components/ui/theme-provider";

export interface ScrollBarProps {
  /** Total number of rows the viewport spans (track height in terminal rows). */
  rows: number;
  /** Total number of content rows the consumer is paging through. */
  total: number;
  /** Current top-of-viewport offset, in content rows. */
  offset: number;
  /**
   * When false, the thumb renders in the muted foreground instead of the
   * theme primary. Defaults to true. The scrollbar is always visible (when
   * content overflows) — `active` only tints the thumb, since the focus
   * indicator lives on the pane border, not the bar itself.
   */
  active?: boolean;
}

/**
 * Thumb-on-track scrollbar lifted from the workbench notes editor pattern.
 * Renders nothing when content fits in one viewport. The track is always
 * `│` and the thumb is `█`; thumb size is proportional to `rows / total`
 * and its position interpolates `offset` over the available track.
 */
export const ScrollBar = ({ rows, total, offset, active = true }: ScrollBarProps) => {
  const theme = useTheme();
  const safeRows = Math.max(1, Math.floor(rows));
  if (total <= safeRows) return null;

  const maxScroll = Math.max(0, total - safeRows);
  const clampedOffset = Math.max(0, Math.min(maxScroll, offset));
  const thumbSize = Math.max(1, Math.round((safeRows / total) * safeRows));
  const thumbPosition =
    maxScroll === 0 ? 0 : Math.round((clampedOffset / maxScroll) * (safeRows - thumbSize));
  const thumbColor = active ? theme.colors.primary : theme.colors.mutedForeground;

  return (
    <Box width={1} flexDirection="column" flexShrink={0}>
      {Array.from({ length: safeRows }, (_, i) => {
        const isThumb = i >= thumbPosition && i < thumbPosition + thumbSize;
        return (
          <Text key={i} color={isThumb ? thumbColor : theme.colors.mutedForeground}>
            {isThumb ? "█" : "│"}
          </Text>
        );
      })}
    </Box>
  );
};
