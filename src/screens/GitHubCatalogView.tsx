import { Box, Text } from "ink";

import { Badge } from "@/components/ui/badge";
import { Panel } from "@/components/ui/panel";
import { useTheme } from "@/components/ui/theme-provider";
import type { GitHubCatalogResult } from "@/lib/github";
import type { GitHubRepoSnapshot } from "@/lib/scanner-types";

export interface GitHubCatalogViewProps {
  repos: GitHubRepoSnapshot[];
  focusIndex: number;
  width: number;
  height: number;
  status?: GitHubCatalogResult;
  cloningFullNames?: readonly string[];
}

const formatDate = (value: string | undefined): string => {
  if (!value) return "never pushed";
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return "unknown";
  const days = Math.max(0, Math.floor((Date.now() - time) / 86_400_000));
  if (days === 0) return "pushed today";
  if (days === 1) return "pushed 1d ago";
  return `pushed ${days}d ago`;
};

export const GitHubCatalogView = ({
  repos,
  focusIndex,
  width,
  height,
  status,
  cloningFullNames = []
}: GitHubCatalogViewProps) => {
  const theme = useTheme();
  const contentRows = Math.max(1, height - 5);
  const safeFocus = repos.length === 0 ? 0 : Math.min(Math.max(0, focusIndex), repos.length - 1);
  const start = Math.max(
    0,
    Math.min(safeFocus - Math.floor(contentRows / 2), Math.max(0, repos.length - contentRows))
  );
  const visible = repos.slice(start, start + contentRows);
  const title = `github · ${repos.length} uncloned`;

  return (
    <Panel title={title} paddingY={0} width={width} height={height}>
      {status?.error ? (
        <Text color={status.fromCache ? theme.colors.warning : theme.colors.error} wrap="truncate-end">
          {status.fromCache ? "cached · " : ""}{status.error}
        </Text>
      ) : status ? (
        <Text dimColor color={theme.colors.mutedForeground} wrap="truncate-end">
          {status.fromCache ? "cached" : "fresh"}
          {status.fetchedAt ? ` · ${new Date(status.fetchedAt).toLocaleString()}` : ""}
        </Text>
      ) : null}

      {repos.length === 0 ? (
        <Box flexDirection="column" paddingTop={1}>
          <Text color={theme.colors.foreground}>
            no unmatched GitHub repos.
          </Text>
          <Text dimColor color={theme.colors.mutedForeground}>
            matched repos stay in the garden; new GitHub repos appear here after refresh.
          </Text>
        </Box>
      ) : (
        <Box flexDirection="column" paddingTop={1}>
          {start > 0 ? (
            <Text dimColor color={theme.colors.mutedForeground}>
              ↑{start} above
            </Text>
          ) : null}
          {visible.map((repo, offset) => {
            const index = start + offset;
            const focused = index === safeFocus;
            const cloning = cloningFullNames.includes(repo.fullName);
            return (
              <Box key={repo.fullName} flexDirection="row">
                <Text color={focused ? theme.colors.primary : theme.colors.mutedForeground}>
                  {focused ? "›" : " "}
                </Text>
                <Box flexShrink={1} flexGrow={1}>
                  <Text
                    color={focused ? theme.colors.primary : theme.colors.foreground}
                    bold={focused}
                    wrap="truncate-end"
                  >
                    {" "}{repo.fullName}
                  </Text>
                </Box>
                <Box flexShrink={0} marginLeft={1} flexDirection="row" gap={1}>
                  {cloning ? (
                    <Badge color={theme.colors.info}>cloning…</Badge>
                  ) : null}
                  {repo.private ? (
                    <Badge color={theme.colors.warning}>private</Badge>
                  ) : null}
                  {repo.archived ? (
                    <Badge color={theme.colors.mutedForeground}>archived</Badge>
                  ) : null}
                  {repo.fork ? (
                    <Badge color={theme.colors.info}>fork</Badge>
                  ) : null}
                  <Text dimColor color={theme.colors.mutedForeground}>
                    {repo.language ?? formatDate(repo.pushedAt)}
                  </Text>
                </Box>
              </Box>
            );
          })}
          {start + visible.length < repos.length ? (
            <Text dimColor color={theme.colors.mutedForeground}>
              +{repos.length - (start + visible.length)} more…
            </Text>
          ) : null}
        </Box>
      )}
    </Panel>
  );
};
