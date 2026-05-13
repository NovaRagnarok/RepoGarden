import { Box, Text } from "ink";
import React, { useMemo } from "react";

import { useTheme } from "@/components/ui/theme-provider";
import type { RepoCreature } from "@/lib/creature";
import {
  creatureCharSize,
  generateCreature,
  pickSpriteColors,
  quadrantChar
} from "@/lib/sprite";

export interface CreatureSpriteProps {
  creature: RepoCreature;
  /** Override character width. Falls back to creatureCharSize(repo). */
  charW?: number;
  /** Override character height. Falls back to creatureCharSize(repo). */
  charH?: number;
  /** When true, draw a faint frame around the sprite (used to mark focus). */
  framed?: boolean;
}

export const CreatureSprite = ({
  creature,
  charW,
  charH,
  framed = false
}: CreatureSpriteProps) => {
  const theme = useTheme();
  const sized = useMemo(() => creatureCharSize(creature.scan), [creature.scan]);
  const w = charW ?? sized.charW;
  const h = charH ?? sized.charH;
  const frame = useMemo(
    () => generateCreature(creature.scan.path || creature.id, w, h),
    [creature.scan.path, creature.id, w, h]
  );
  const { body } = pickSpriteColors(creature.scan.path || creature.id, {
    primary: theme.colors.primary,
    accent: theme.colors.accent,
    success: theme.colors.success,
    warning: theme.colors.warning,
    error: theme.colors.error,
    info: theme.colors.info
  });

  const lines: string[] = [];
  for (let cy = 0; cy < h; cy += 1) {
    let line = "";
    const top = cy * 2;
    const bottom = cy * 2 + 1;
    for (let cx = 0; cx < w; cx += 1) {
      const left = cx * 2;
      const right = cx * 2 + 1;
      const tl = frame[top]?.[left] === 1;
      const tr = frame[top]?.[right] === 1;
      const bl = frame[bottom]?.[left] === 1;
      const br = frame[bottom]?.[right] === 1;
      line += quadrantChar(tl, tr, bl, br);
    }
    lines.push(line);
  }

  return (
    <Box flexDirection="column">
      {lines.map((line, idx) => {
        if (!framed) {
          return (
            <Text key={idx} color={body}>
              {line}
            </Text>
          );
        }
        const leftCap = idx === 0 ? "╭" : idx === lines.length - 1 ? "╰" : "│";
        const rightCap = idx === 0 ? "╮" : idx === lines.length - 1 ? "╯" : "│";
        return (
          <Box key={idx} flexDirection="row">
            <Text color={theme.colors.primary}>{leftCap}</Text>
            <Text color={body}>{line}</Text>
            <Text color={theme.colors.primary}>{rightCap}</Text>
          </Box>
        );
      })}
    </Box>
  );
};
