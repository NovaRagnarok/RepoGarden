import { Box, Text } from "ink";
import { BigText } from "@/components/ui/big-text";
import { ProgressBar } from "@/components/ui/progress-bar";
import {
  useMotion,
  useTheme,
  useUnicode
} from "@/components/ui/theme-provider";
import { ResizePrompt } from "@/components/ResizePrompt";
import { useAnimation } from "@/hooks/use-animation";
import { useTerminalSize } from "@/hooks/use-terminal-size";
import { getTerminalLayout } from "@/lib/responsive-layout";
import type { RootProgress } from "@/lib/scanner";

export interface BootScreenProps {
  message?: string;
  errored?: boolean;
  scanProgress?: { done: number; total: number };
  scanProgressByRoot?: RootProgress[];
}

interface SceneRow {
  text: string;
  color: string;
  accents?: Array<{ col: number; color: string; bold?: boolean }>;
  beamCol?: number;
  beamChar?: string;
  beamColor?: string;
  bold?: boolean;
}

const hashCell = (x: number, y: number, salt: number): number => {
  let h = 2166136261;
  h = Math.imul(h ^ (x + 31), 16777619);
  h = Math.imul(h ^ (y + 73), 16777619);
  h = Math.imul(h ^ salt, 16777619);
  h ^= h >>> 16;
  return h >>> 0;
};

const replaceAt = (text: string, index: number, char: string): string => {
  if (index < 0 || index >= text.length) return text;
  return text.slice(0, index) + char + text.slice(index + 1);
};

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const statusLine = (
  errored: boolean | undefined,
  scanProgress: BootScreenProps["scanProgress"]
): string => {
  if (errored) return "habitat paused";
  if (!scanProgress || scanProgress.total === 0) return "warming local state";
  return `scanning repositories ${scanProgress.done}/${scanProgress.total}`;
};

const progressPercent = (
  scanProgress: BootScreenProps["scanProgress"],
  frame: number,
  frozen: boolean,
  errored: boolean
): number => {
  if (errored) return 0;
  if (scanProgress && scanProgress.total > 0) {
    return clamp(Math.round((scanProgress.done / scanProgress.total) * 100), 2, 100);
  }
  if (frozen) return 42;
  return 18 + ((frame * 3) % 68);
};

const trimMiddle = (text: string, maxLength: number): string => {
  if (text.length <= maxLength) return text;
  if (maxLength <= 3) return text.slice(0, maxLength);
  const left = Math.ceil((maxLength - 1) / 2);
  const right = Math.floor((maxLength - 1) / 2);
  return `${text.slice(0, left)}…${text.slice(text.length - right)}`;
};

const makeSkyLine = (
  width: number,
  row: number,
  frame: number,
  unicode: boolean,
  frozen: boolean
): string => {
  const chars = Array.from({ length: width }, () => " ");
  const starGlyphs = unicode ? ["·", "⋆", "+", "✦", "✧"] : [".", "*", "+"];
  const density = row === 0 ? 13 : 18;

  for (let x = 0; x < width; x += 1) {
    const h = hashCell(x, row, 0x9e37);
    if (h % density !== 0) continue;
    const twinkle = frozen ? 0 : Math.floor(frame / 2) % 4;
    const pick = (h + row + twinkle) % starGlyphs.length;
    chars[x] = starGlyphs[pick];
  }

  return chars.join("");
};

const skyAccentsForLine = (
  line: string,
  row: number,
  theme: ReturnType<typeof useTheme>
): SceneRow["accents"] => {
  const accents: NonNullable<SceneRow["accents"]> = [];
  for (let col = 0; col < line.length; col += 1) {
    const glyph = line[col];
    if (glyph === " " || glyph === "·" || glyph === ".") continue;
    const h = hashCell(col, row, 0xcafe);
    if (glyph === "✦" || glyph === "*") {
      accents.push({
        col,
        color: h % 2 === 0 ? theme.colors.primary : theme.colors.info,
        bold: true
      });
      continue;
    }
    if (glyph === "✧" || glyph === "+") {
      accents.push({
        col,
        color: theme.colors.info,
        bold: true
      });
      continue;
    }
    if (glyph === "⋆" && h % 4 === 0) {
      accents.push({
        col,
        color: theme.colors.info
      });
    }
  }
  return accents;
};

const paintCreature = (
  line: string,
  x: number,
  frame: number,
  unicode: boolean,
  frozen: boolean
): string => {
  const poses = unicode
    ? ["◖▀◗", "◟▄◞", "◖▄◗", "◟▀◞"]
    : ["{^}", "{_}", "{-}", "{_}"];
  const pose = poses[frozen ? 0 : Math.floor(frame / 3 + x) % poses.length];
  let next = line;
  for (let i = 0; i < pose.length; i += 1) {
    next = replaceAt(next, x + i, pose[i]);
  }
  return next;
};

const buildHabitatRows = ({
  width,
  height,
  frame,
  unicode,
  frozen,
  theme
}: {
  width: number;
  height: number;
  frame: number;
  unicode: boolean;
  frozen: boolean;
  theme: ReturnType<typeof useTheme>;
}): SceneRow[] => {
  const rows: SceneRow[] = [];
  const beamTravel = Math.max(1, width + height);
  const beamCol = frozen ? Math.floor(width * 0.72) : (frame * 2) % beamTravel;
  const skyRows = Math.max(3, height - 4);

  for (let y = 0; y < skyRows; y += 1) {
    const line = makeSkyLine(width, y, frame, unicode, frozen);
    const col = beamCol - Math.floor(y * 0.7);
    rows.push({
      text: line,
      color: theme.colors.mutedForeground,
      accents: frozen ? undefined : skyAccentsForLine(line, y, theme),
      beamCol: col >= 0 && col < width ? col : undefined,
      beamChar: unicode ? "╱" : "/",
      beamColor: frozen ? theme.colors.error : theme.colors.primary
    });
  }

  const horizon = unicode ? "─" : "-";
  const ridge = unicode ? "▁" : "_";
  const soil = unicode ? "░" : ".";
  let creatureLine = Array.from({ length: width }, (_, x) =>
    x % 11 === 0 ? ridge : " "
  ).join("");
  const creatureSlots = [
    Math.floor(width * 0.16),
    Math.floor(width * 0.34),
    Math.floor(width * 0.57),
    Math.floor(width * 0.78)
  ].filter((x, index, all) => x >= 1 && x < width - 4 && all.indexOf(x) === index);
  for (const x of creatureSlots) {
    creatureLine = paintCreature(creatureLine, x, frame, unicode, frozen);
  }
  const creaturePalette = [
    theme.colors.primary,
    theme.colors.accent,
    theme.colors.success
  ];
  const creatureAccents = creatureSlots.flatMap((x, index) =>
    Array.from({ length: 3 }, (_, offset) => ({
      col: x + offset,
      color: frozen ? theme.colors.error : creaturePalette[index % creaturePalette.length],
      bold: true
    }))
  );

  rows.push({
    text: horizon.repeat(width),
    color: frozen ? theme.colors.error : theme.colors.info,
    beamCol: beamCol >= 0 && beamCol < width ? beamCol : undefined,
    beamChar: unicode ? "┼" : "+",
    beamColor: frozen ? theme.colors.error : theme.colors.primary,
    bold: true
  });
  rows.push({
    text: creatureLine,
    color: frozen ? theme.colors.error : theme.colors.mutedForeground,
    accents: creatureAccents,
    beamCol: beamCol >= 0 && beamCol < width ? beamCol : undefined,
    beamChar: unicode ? "│" : "|",
    beamColor: frozen ? theme.colors.error : theme.colors.accent,
    bold: true
  });
  rows.push({
    text: soil.repeat(width),
    color: frozen ? theme.colors.mutedForeground : theme.colors.success
  });

  return rows.slice(0, height);
};

const SceneText = ({ row }: { row: SceneRow }) => {
  const accents = new Map((row.accents ?? []).map((accent) => [accent.col, accent]));
  const parts: Array<{ text: string; color: string; bold?: boolean }> = [];
  let current: { text: string; color: string; bold?: boolean } | undefined;

  for (let col = 0; col < row.text.length; col += 1) {
    const isBeam = row.beamCol === col;
    const accent = accents.get(col);
    const char = isBeam ? (row.beamChar ?? row.text[col]) : row.text[col];
    const color = isBeam
      ? row.beamColor ?? row.color
      : accent?.color ?? row.color;
    const bold = isBeam ? true : accent?.bold ?? row.bold;

    if (current && current.color === color && current.bold === bold) {
      current.text += char;
      continue;
    }
    current = { text: char, color, bold };
    parts.push(current);
  }

  return (
    <Text>
      {parts.map((part, index) => (
        <Text key={index} color={part.color} bold={part.bold}>
          {part.text}
        </Text>
      ))}
    </Text>
  );
};

const LogoFlash = ({
  width,
  frame,
  frozen
}: {
  width: number;
  frame: number;
  frozen: boolean;
}) => {
  const theme = useTheme();
  const unicode = useUnicode();
  const flashPalette = [
    theme.colors.primary,
    theme.colors.accent,
    theme.colors.warning
  ];
  const phase = frozen ? 2 : Math.min(5, Math.floor(frame / 2));
  const flashWidth = Math.max(18, Math.min(width, 44));
  const lit = phase <= 3 ? Math.max(6, flashWidth - phase * 9) : 6;
  const left = Math.max(0, Math.floor((flashWidth - lit) / 2));
  const right = Math.min(flashWidth, left + lit);
  const glyph = unicode ? "━" : "=";

  return (
    <Box flexDirection="row" width={flashWidth}>
      {Array.from({ length: flashWidth }, (_, index) => {
        const active = index >= left && index < right;
        const color = active ? flashPalette[phase % flashPalette.length] : theme.colors.mutedForeground;
        return (
          <Text key={index} color={color} bold={active}>
            {active ? glyph : unicode ? "·" : "."}
          </Text>
        );
      })}
    </Box>
  );
};

const RootProgressList = ({
  progress,
  width
}: {
  progress?: RootProgress[];
  width: number;
}) => {
  const theme = useTheme();
  if (!progress || progress.length === 0) return null;

  const visible = progress.slice(0, 3);
  const nameWidth = Math.max(14, Math.min(34, width - 16));

  return (
    <Box flexDirection="column" marginTop={1}>
      {visible.map((entry) => (
        <Box key={entry.root} flexDirection="row">
          <Text color={theme.colors.mutedForeground}>
            {trimMiddle(entry.root, nameWidth).padEnd(nameWidth, " ")}
          </Text>
          <Text color={theme.colors.foreground}>
            {" "}
            {String(entry.done).padStart(2, " ")}/{String(entry.total).padStart(2, " ")}
          </Text>
        </Box>
      ))}
    </Box>
  );
};

export const BootScreen = ({
  message,
  errored,
  scanProgress,
  scanProgressByRoot
}: BootScreenProps) => {
  const theme = useTheme();
  const { reduced } = useMotion();
  const unicode = useUnicode();
  const { columns, rows } = useTerminalSize();
  const responsive = getTerminalLayout(columns, rows);
  const frame = useAnimation({ intervalMs: 90 });

  const frozen = Boolean(errored || reduced);
  const tick = frozen ? 0 : frame;
  const body = message ?? (errored ? "could not reach habitat state." : "waking up local state");
  // First screen of the session; stay below terminal height to avoid Ink's
  // clear-terminal fallback during the transition into the main shell.
  const containerHeight = Math.max(8, rows - 1);
  const innerWidth = Math.max(20, columns - 2);
  const sceneWidth = Math.min(innerWidth, responsive.tier === "rich" ? 96 : 76);
  const sceneHeight = responsive.tier === "rich" ? 13 : 8;
  const percent = progressPercent(scanProgress, tick, frozen, Boolean(errored));
  const status = errored ? "BOOT ERROR" : "HABITAT WAKEUP";
  const statusColor = errored ? theme.colors.error : theme.colors.primary;
  const rowsToRender = buildHabitatRows({
    width: sceneWidth,
    height: sceneHeight,
    frame: tick,
    unicode,
    frozen,
    theme
  });

  if (responsive.tier === "too-small") {
    return <ResizePrompt columns={columns} rows={rows} />;
  }

  return (
    <Box
      flexDirection="column"
      paddingX={1}
      paddingY={1}
      height={containerHeight}
      width={columns}
      alignItems="center"
      overflow="hidden"
    >
      <Box flexDirection="row" justifyContent="space-between" width={sceneWidth}>
        <Text color={theme.colors.mutedForeground}>
          a little local habitat is waking up
        </Text>
        <Text color={statusColor} bold>
          {status}
        </Text>
      </Box>

      <Box marginTop={1} flexDirection="column" width={sceneWidth} alignItems="center">
        {responsive.showBigBranding ? (
          <>
            <BigText font="block" color={tick < 6 && !errored ? theme.colors.warning : statusColor}>
              repogarden
            </BigText>
            <LogoFlash width={sceneWidth} frame={tick} frozen={frozen} />
          </>
        ) : (
          <>
            <Text color={tick < 6 && !errored ? theme.colors.warning : statusColor} bold>
              REPOGARDEN
            </Text>
            <LogoFlash width={sceneWidth} frame={tick} frozen={frozen} />
          </>
        )}
      </Box>

      <Box
        flexDirection="column"
        marginTop={responsive.showBigBranding ? 0 : 1}
        width={sceneWidth}
      >
        {rowsToRender.map((row, index) => (
          <SceneText key={index} row={row} />
        ))}
      </Box>

      <Box marginTop={1} flexDirection="column" width={sceneWidth} alignItems="center">
        <Text color={theme.colors.foreground}>{body}</Text>
        <Text color={theme.colors.mutedForeground}>
          {statusLine(errored, scanProgress)}
        </Text>
        <ProgressBar
          value={percent}
          total={100}
          width={Math.max(18, Math.min(42, sceneWidth - 12))}
          showCount={false}
          color={statusColor}
          fillChar={unicode ? "█" : "#"}
          emptyChar={unicode ? "░" : "."}
        />
        {responsive.tier === "rich" ? (
          <RootProgressList progress={scanProgressByRoot} width={sceneWidth} />
        ) : null}
      </Box>
    </Box>
  );
};
