import { Box, Text } from "ink";

import { Panel } from "@/components/ui/panel";
import { ResizePrompt } from "@/components/ResizePrompt";
import { useTheme } from "@/components/ui/theme-provider";
import { useInput } from "@/hooks/use-input";
import { useTerminalSize } from "@/hooks/use-terminal-size";
import { useUsage } from "@/hooks/use-usage";
import { getTerminalLayout } from "@/lib/responsive-layout";
import {
  isUsageFeatureDisabled,
  type ProviderUsage,
  type UsageStatus,
  type UsageWindow,
} from "@/lib/usage";

export interface UsageOverlayProps {
  onClose: () => void;
}

const BAR_CELLS = 24;
const PROVIDER_LABEL_WIDTH = 7;

const miniBar = (percent: number): string => {
  const pct = Math.max(0, Math.min(100, percent));
  const filled = Math.round((pct / 100) * BAR_CELLS);
  return "█".repeat(filled) + "░".repeat(BAR_CELLS - filled);
};

const colorForPercent = (
  percent: number | null,
  theme: ReturnType<typeof useTheme>
): string => {
  if (percent === null) return theme.colors.mutedForeground;
  if (percent < 25) return theme.colors.error;
  if (percent < 50) return theme.colors.warning;
  return theme.colors.success;
};

// Human-readable countdown — overlay has room for "2h 14m" rather than the
// chrome row's clipped "(2h)". `now` is injectable for tests.
const formatCountdown = (date: Date | null, now: number = Date.now()): string => {
  if (!date) return "—";
  const ms = date.getTime() - now;
  if (!Number.isFinite(ms)) return "—";
  if (ms <= 0) return "resets now";
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const days = Math.floor(ms / day);
  const hours = Math.floor((ms % day) / hour);
  const minutes = Math.floor((ms % hour) / minute);
  if (days > 0) return `resets in ${days}d ${hours}h`;
  if (hours > 0) return `resets in ${hours}h ${minutes}m`;
  return `resets in ${Math.max(1, minutes)}m`;
};

// "14:22 (2m ago)" — gives both an absolute clock and a relative feel, since
// either alone leaves an ambiguity ("2m ago from when?" / "14:22 — is that
// recent?").
const formatFetchedAt = (date: Date, now: number = Date.now()): string => {
  const hh = date.getHours().toString().padStart(2, "0");
  const mm = date.getMinutes().toString().padStart(2, "0");
  const ms = Math.max(0, now - date.getTime());
  const minute = 60_000;
  const hour = 60 * minute;
  let relative: string;
  if (ms < 5_000) relative = "just now";
  else if (ms < minute) relative = `${Math.floor(ms / 1000)}s ago`;
  else if (ms < hour) relative = `${Math.floor(ms / minute)}m ago`;
  else relative = `${Math.floor(ms / hour)}h ago`;
  return `${hh}:${mm} (${relative})`;
};

const statusLabel = (status: UsageStatus): string => {
  switch (status) {
    case "ok":
      return "ok";
    case "stale":
      return "stale (using cached values)";
    case "auth":
      return "auth required";
    case "error":
      return "error";
  }
};

const statusColor = (
  status: UsageStatus,
  theme: ReturnType<typeof useTheme>
): string => {
  if (status === "ok") return theme.colors.success;
  if (status === "stale") return theme.colors.warning;
  return theme.colors.error;
};

const padRight = (s: string, width: number): string =>
  s.length >= width ? s : s + " ".repeat(width - s.length);

const WindowLine = ({
  label,
  win,
}: {
  label: string;
  win: UsageWindow | null;
}) => {
  const theme = useTheme();
  const hasData = win && win.percent !== null;
  const tone = hasData ? colorForPercent(win!.percent, theme) : theme.colors.mutedForeground;
  const bar = hasData ? miniBar(win!.percent!) : "░".repeat(BAR_CELLS);
  const percent = hasData ? `${Math.round(win!.percent!)}%`.padStart(4) : "  —%";
  const countdown = formatCountdown(win?.resetsAt ?? null);
  return (
    <Box flexDirection="row" columnGap={2}>
      <Text color={theme.colors.mutedForeground}>{padRight(label, 6)}</Text>
      <Text color={tone}>{bar}</Text>
      <Text color={tone}>{percent}</Text>
      <Text dimColor color={theme.colors.mutedForeground}>
        {countdown}
      </Text>
    </Box>
  );
};

const ProviderBlock = ({ usage }: { usage: ProviderUsage }) => {
  const theme = useTheme();
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box flexDirection="row" columnGap={2}>
        <Text bold color={theme.colors.primary}>
          {padRight(usage.source, PROVIDER_LABEL_WIDTH)}
        </Text>
        <Text color={statusColor(usage.status, theme)}>
          {`status: ${statusLabel(usage.status)}`}
        </Text>
      </Box>
      {usage.error ? (
        <Box paddingLeft={PROVIDER_LABEL_WIDTH + 2}>
          <Text dimColor color={theme.colors.error} wrap="wrap">
            {usage.error}
          </Text>
        </Box>
      ) : null}
      <Box flexDirection="column" paddingLeft={2} paddingTop={1}>
        <WindowLine label="7-day" win={usage.weekly} />
        <WindowLine label="5-hour" win={usage.fiveHour} />
      </Box>
    </Box>
  );
};

export const UsageOverlay = ({ onClose }: UsageOverlayProps) => {
  const theme = useTheme();
  const { columns, rows } = useTerminalSize();
  const responsive = getTerminalLayout(columns, rows);
  const fullWidth = Math.max(20, columns - 2);
  const containerHeight = Math.max(8, rows - 1);

  // Opening the overlay is explicit consent — fetch regardless of the
  // persistent `usageBarDisabled` toggle. The env-level kill switch
  // (`REPOGARDEN_DISABLE_USAGE=1`) still wins; `useUsage` honours it inside.
  // `includeAll` keeps error/auth providers visible — the whole point of the
  // overlay is diagnostics.
  const usage = useUsage(120_000, { disabled: false, includeAll: true });
  const envDisabled = isUsageFeatureDisabled();

  useInput((input, key) => {
    if (key.escape || input === "q" || input === "U") {
      onClose();
    }
  });

  if (responsive.tier === "too-small") {
    return <ResizePrompt columns={columns} rows={rows} title="USAGE" />;
  }

  // Most recent fetchedAt across providers — they get stamped independently
  // but in practice both resolve within a render of each other.
  const latestFetchedAt = usage.reduce<Date | null>((acc, u) => {
    if (!acc) return u.fetchedAt;
    return u.fetchedAt > acc ? u.fetchedAt : acc;
  }, null);

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1} height={containerHeight} overflow="hidden">
      <Box flexDirection="column" paddingBottom={1}>
        <Text dimColor color={theme.colors.mutedForeground}>
          usage
        </Text>
        <Text bold color={theme.colors.primary}>
          claude / codex plan windows
        </Text>
      </Box>

      <Panel title="providers" paddingY={1} width={fullWidth}>
        {envDisabled ? (
          <Text dimColor color={theme.colors.mutedForeground}>
            REPOGARDEN_DISABLE_USAGE is set — no provider data will be fetched.
          </Text>
        ) : usage.length === 0 ? (
          <Text dimColor color={theme.colors.mutedForeground}>
            loading provider status…
          </Text>
        ) : (
          <Box flexDirection="column">
            {usage.map((u) => (
              <ProviderBlock key={u.source} usage={u} />
            ))}
          </Box>
        )}
      </Panel>

      <Box paddingTop={1} flexDirection="row" justifyContent="space-between">
        <Text dimColor color={theme.colors.mutedForeground}>
          {latestFetchedAt
            ? `last fetched: ${formatFetchedAt(latestFetchedAt)}`
            : ""}
        </Text>
        <Text dimColor color={theme.colors.mutedForeground}>
          esc · q · U close
        </Text>
      </Box>
    </Box>
  );
};

export const __testing__ = { formatCountdown, formatFetchedAt };
