import { Box, Text } from "ink";
import { useMemo } from "react";

import { useTheme } from "@/components/ui/theme-provider";
import type { RepoCreature } from "@/lib/creature";
import {
  creatureCharSize,
  generateCreature,
  pickSpriteColors,
  quadrantChar,
  type CreatureSizeCohort
} from "@/lib/sprite";

export interface CreatureSpriteProps {
  creature: RepoCreature;
  /** Override character width. Falls back to creatureCharSize(repo, …, cohort). */
  charW?: number;
  /** Override character height. Falls back to creatureCharSize(repo, …, cohort). */
  charH?: number;
  /** When true, draw a faint frame around the sprite (used to mark focus). */
  framed?: boolean;
  /** Cohort the creature belongs to. Without it, the sprite falls back to
   *  absolute-only sizing, which under rank-based scaling diverges sharply
   *  from the cohort-aware sizes used in the garden view. Pass the same
   *  cohort the parent built for the garden so the popup and workbench
   *  sprites match what the user just clicked on. */
  cohort?: CreatureSizeCohort;
}

export const CreatureSprite = ({
  creature,
  charW,
  charH,
  framed = false,
  cohort
}: CreatureSpriteProps) => {
  const theme = useTheme();
  const sized = useMemo(
    () => creatureCharSize(creature.scan, undefined, cohort),
    [creature.scan, cohort]
  );
  const w = charW ?? sized.charW;
  const h = charH ?? sized.charH;
  const frame = useMemo(
    () => generateCreature(creature.scan.path || creature.id, w, h),
    [creature.scan.path, creature.id, w, h]
  );
  const { body } = pickSpriteColors(
    creature.scan.path || creature.id,
    theme.creaturePalette
  );

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
