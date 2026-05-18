import { Box, Text } from "ink";

import { useTheme } from "@/components/ui/theme-provider";

export interface Shortcut {
  key: string;
  description: string;
  category?: string;
}

export interface KeyboardShortcutsProps {
  shortcuts: Shortcut[];
  columns?: number;
  title?: string;
}

// flexShrink={0} keeps the bordered key at its natural 3-row height. The
// HelpOverlay container sets overflow="hidden" with a finite height, and
// without this Yoga collapses each KeyLabel to 2 rows under pressure — the
// missing third row is the bottom border, which then visually fuses with
// the next ShortcutRow above the description. See manual-qa B4.
const KeyLabel = ({ label, color }: { label: string; color: string }) => (
  <Box
    borderStyle="single"
    borderColor={color}
    paddingX={1}
    flexShrink={0}
  >
    <Text color={color} bold>
      {label}
    </Text>
  </Box>
);

// flexShrink={0} pins each row's natural height to max(KeyLabel=3, Text=1)
// so the column-stacked grid spaces rows correctly. alignItems="center"
// then centers the description against the 3-row key box. Without
// flexShrink={0} the row's effective height is capped at 1 and adjacent
// rows render on top of each other — manual-qa B4.
const ShortcutRow = ({
  shortcut,
  keyColor,
  descColor,
}: {
  shortcut: Shortcut;
  keyColor: string;
  descColor: string;
}) => (
  <Box gap={1} alignItems="center" flexShrink={0}>
    <KeyLabel label={shortcut.key} color={keyColor} />
    <Text color={descColor}>{shortcut.description}</Text>
  </Box>
);

const ShortcutGrid = ({
  items,
  columns,
  theme,
}: {
  items: Shortcut[];
  columns: number;
  theme: ReturnType<typeof useTheme>;
}) => {
  const rows: Shortcut[][] = [];
  for (let i = 0; i < items.length; i += columns) {
    rows.push(items.slice(i, i + columns));
  }

  // flexShrink={0} cascades down: the outer column, each grid-row, and
  // each ShortcutRow all decline to be shrunk. Otherwise, when the help
  // overlay's height-pressed container starts trimming rows, Yoga
  // compresses the grid rows back to 1 cell tall and the bordered
  // KeyLabels overlap the next row's content. See manual-qa B4.
  return (
    <Box flexDirection="column" gap={0} flexShrink={0}>
      {rows.map((row, ri) => (
        <Box key={ri} gap={3} flexShrink={0}>
          {row.map((s, ci) => (
            <ShortcutRow
              key={ci}
              shortcut={s}
              keyColor={theme.colors.primary}
              descColor={theme.colors.foreground}
            />
          ))}
        </Box>
      ))}
    </Box>
  );
};

export const KeyboardShortcuts = ({
  shortcuts,
  columns = 1,
  title,
}: KeyboardShortcutsProps) => {
  const theme = useTheme();

  const hasCategories = shortcuts.some((s) => s.category);

  if (hasCategories) {
    const grouped: Record<string, Shortcut[]> = {
      /* noop */
    };
    for (const s of shortcuts) {
      const cat = s.category ?? "General";
      if (!grouped[cat]) {
        grouped[cat] = [];
      }
      grouped[cat].push(s);
    }

    return (
      <Box flexDirection="column" gap={1} flexShrink={0}>
        {title && (
          <Text color={theme.colors.primary} bold>
            ⌨ {title}
          </Text>
        )}
        {Object.entries(grouped).map(([category, items]) => (
          <Box key={category} flexDirection="column" gap={0} flexShrink={0}>
            <Text color={theme.colors.mutedForeground} bold underline>
              {category}
            </Text>
            {columns > 1 ? (
              <ShortcutGrid items={items} columns={columns} theme={theme} />
            ) : (
              items.map((s, i) => (
                <ShortcutRow
                  key={i}
                  shortcut={s}
                  keyColor={theme.colors.primary}
                  descColor={theme.colors.foreground}
                />
              ))
            )}
          </Box>
        ))}
      </Box>
    );
  }

  return (
    <Box flexDirection="column" gap={1} flexShrink={0}>
      {title && (
        <Text color={theme.colors.primary} bold>
          ⌨ {title}
        </Text>
      )}
      {columns > 1 ? (
        <ShortcutGrid items={shortcuts} columns={columns} theme={theme} />
      ) : (
        shortcuts.map((s, i) => (
          <ShortcutRow
            key={i}
            shortcut={s}
            keyColor={theme.colors.primary}
            descColor={theme.colors.foreground}
          />
        ))
      )}
    </Box>
  );
};
