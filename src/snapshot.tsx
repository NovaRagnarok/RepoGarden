#!/usr/bin/env node
/**
 * Render every shell screen once at the current terminal size, then exit.
 * Use SNAPSHOT=<screen> to pick which to render; pair with `script` + COLUMNS
 * env to drive arbitrary widths.
 */
import { render } from "ink";
import React from "react";

import { ThemeProvider } from "@/components/ui/theme-provider";
import { BootScreen } from "@/screens/BootScreen";
import { OnboardingScreen } from "@/screens/OnboardingScreen";
import { ReadyShell } from "@/screens/ReadyShell";
import { SettingsScreen } from "@/screens/SettingsScreen";
import { WorkbenchScreen } from "@/screens/WorkbenchScreen";
import { HelpOverlay } from "@/screens/HelpOverlay";
import type { RepoCreature } from "@/lib/creature";
import { computeActivity } from "@/lib/vibe";
import { themeById, defaultThemeId } from "@/themes";

const sampleCreatures: RepoCreature[] = [
  {
    id: "rg",
    scan: {
      id: "rg",
      path: "/home/dev/repos/RepoGarden",
      name: "RepoGarden",
      branch: "tui-rebuild",
      isDirty: true,
      ahead: 2,
      lastCommitSubject: "Add scanner + creature pipeline",
      lastCommitSha: "abcd123",
      lastCommitAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
      primaryLanguage: "TypeScript",
      commitCount: 142,
      recentCommitDays: [
        0, 1, 0, 0, 2, 3, 1, 0, 0, 1, 2, 4, 5, 2, 1,
        0, 0, 1, 3, 6, 4, 2, 1, 0, 2, 3, 5, 4, 2, 1
      ],
      recentCommits: [
        { sha: "abcd1234567890", shortSha: "abcd123", subject: "Add scanner + creature pipeline", committedAt: new Date(Date.now() - 2 * 86_400_000).toISOString(), author: "you" },
        { sha: "ef019283746", shortSha: "ef01928", subject: "Wire workbench into save flow", committedAt: new Date(Date.now() - 3 * 86_400_000).toISOString(), author: "you" },
        { sha: "1234abc7654", shortSha: "1234abc", subject: "Make shell responsive", committedAt: new Date(Date.now() - 4 * 86_400_000).toISOString(), author: "you" }
      ]
    },
    memory: {},
    vibe: { vibe: "noisy", reason: "uncommitted changes · 2 unpushed commits", daysSinceCommit: 2, activity: computeActivity(2) }
  },
  {
    id: "cc",
    scan: {
      id: "cc",
      path: "/home/dev/repos/pixel-lab",
      name: "pixel-lab",
      branch: "main",
      isDirty: false,
      lastCommitSubject: "site: tweak landing copy",
      lastCommitAt: new Date(Date.now() - 30 * 86_400_000).toISOString(),
      primaryLanguage: "Rust"
    },
    memory: {},
    vibe: { vibe: "sleepy", reason: "quiet for 30 days.", daysSinceCommit: 30, activity: computeActivity(30) }
  },
  {
    id: "th",
    scan: {
      id: "th",
      path: "/home/dev/repos/Beacon",
      name: "Beacon",
      branch: "main",
      isDirty: false,
      lastCommitAt: new Date(Date.now() - 5 * 86_400_000).toISOString(),
      primaryLanguage: "Python"
    },
    memory: { currentBlocker: "worker queue red on staging" },
    vibe: { vibe: "blocked", reason: "blocker: worker queue red on staging", daysSinceCommit: 5, activity: computeActivity(5) }
  },
  {
    id: "gn",
    scan: {
      id: "gn",
      path: "/home/dev/repos/garden-notes",
      name: "garden-notes",
      branch: "draft",
      isDirty: false,
      lastCommitAt: new Date(Date.now() - 1 * 86_400_000).toISOString(),
      primaryLanguage: "Markdown"
    },
    memory: {},
    vibe: { vibe: "happy", reason: "last commit 1d ago, clean.", daysSinceCommit: 1, activity: computeActivity(1) }
  }
];

const screen = process.env.SNAPSHOT ?? "ready";
const themeId = process.env.THEME ?? defaultThemeId;
const choice = themeById(themeId) ?? themeById(defaultThemeId)!;

const node = (() => {
  switch (screen) {
    case "boot":
      return <BootScreen />;
    case "boot-error":
      return <BootScreen errored message="recovery: app data folder is missing." />;
    case "onboarding":
      return <OnboardingScreen initialPath="~/repos" onScan={() => undefined} />;
    case "settings":
      return <SettingsScreen currentThemeId={themeId} onPickTheme={() => undefined} onClose={() => undefined} />;
    case "workbench":
      return <WorkbenchScreen creature={sampleCreatures[0]} onClose={() => undefined} />;
    case "garden":
      return (
        <ReadyShell
          creatures={sampleCreatures}
          rootsLabel="~/repos"
          view="garden"
          onOpenSettings={() => undefined}
          onOpenWorkbench={() => undefined}
          onRescan={() => undefined}
          onQuit={() => undefined}
        />
      );
    case "help":
      return <HelpOverlay onClose={() => undefined} />;
    case "ready":
    default:
      return (
        <ReadyShell
          creatures={sampleCreatures}
          rootsLabel="~/repos"
          onOpenSettings={() => undefined}
          onOpenWorkbench={() => undefined}
          onRescan={() => undefined}
          onQuit={() => undefined}
        />
      );
  }
})();

const { unmount } = render(
  <ThemeProvider theme={choice.theme}>{node}</ThemeProvider>,
  { exitOnCtrlC: false, patchConsole: false }
);

setTimeout(() => {
  unmount();
  process.exit(0);
}, 250);
