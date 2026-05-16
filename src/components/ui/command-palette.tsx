import { Box, Text } from "ink";
import { useMemo, useState } from "react";

import { TextInput } from "@/components/ui/text-input";
import { useTheme } from "@/components/ui/theme-provider";
import { useInput } from "@/hooks/use-input";

export interface CommandPaletteItem {
  key: string;
  label: string;
  hint?: string;
  onSelect: () => void;
}

export interface CommandPaletteProps {
  title?: string;
  placeholder?: string;
  items: CommandPaletteItem[];
  onClose: () => void;
  width?: number;
}

export const CommandPalette = ({
  title = "command palette",
  placeholder = "type to filter…",
  items,
  onClose,
  width = 60,
}: CommandPaletteProps) => {
  const theme = useTheme();
  const [filter, setFilter] = useState("");
  const [focusIdx, setFocusIdx] = useState(0);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) => item.label.toLowerCase().includes(q));
  }, [items, filter]);

  // Bound the focused index against the filtered list so a freshly-narrowed
  // list doesn't briefly highlight nothing while the user is mid-type.
  const safeFocusIdx = Math.min(focusIdx, Math.max(0, filtered.length - 1));

  useInput((_input, key) => {
    if (key.escape) {
      onClose();
      return;
    }
    if (key.upArrow) {
      setFocusIdx((idx) => Math.max(0, idx - 1));
      return;
    }
    if (key.downArrow) {
      setFocusIdx((idx) => Math.min(Math.max(0, filtered.length - 1), idx + 1));
      return;
    }
    if (key.return) {
      const item = filtered[safeFocusIdx];
      if (item) {
        // Close first so React tears the palette down before the action's
        // setState calls hit — keeps focus handoff predictable when the
        // action toggles workbench mode (e.g. rename → naming).
        onClose();
        item.onSelect();
      }
    }
  });

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.colors.focusRing}
      paddingX={1}
      paddingY={0}
      width={width}
    >
      <Text bold color={theme.colors.primary}>
        {title}
      </Text>
      <TextInput
        value={filter}
        onChange={(v) => {
          setFilter(v);
          setFocusIdx(0);
        }}
        placeholder={placeholder}
        width={Math.max(20, width - 4)}
        autoFocus
        bordered
      />
      <Box flexDirection="column" paddingTop={1}>
        {filtered.length === 0 ? (
          <Text dimColor color={theme.colors.mutedForeground}>
            no matches.
          </Text>
        ) : (
          filtered.map((item, idx) => {
            const isFocused = idx === safeFocusIdx;
            return (
              <Box key={item.key} flexDirection="row" justifyContent="space-between">
                <Box flexDirection="row">
                  <Text color={isFocused ? theme.colors.primary : "transparent"}>
                    {isFocused ? "›" : " "}
                  </Text>
                  <Text
                    color={isFocused ? theme.colors.primary : theme.colors.foreground}
                    bold={isFocused}
                  >
                    {" "}
                    {item.label}
                  </Text>
                </Box>
                {item.hint ? (
                  <Text dimColor color={theme.colors.mutedForeground}>
                    {item.hint}
                  </Text>
                ) : null}
              </Box>
            );
          })
        )}
      </Box>
      <Box paddingTop={1}>
        <Text dimColor color={theme.colors.mutedForeground}>
          ↑↓ navigate · enter select · esc close
        </Text>
      </Box>
    </Box>
  );
};
