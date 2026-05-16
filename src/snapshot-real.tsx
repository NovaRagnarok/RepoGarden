#!/usr/bin/env node
import { render } from "ink";
import { ThemeProvider } from "@/components/ui/theme-provider";
import { ReadyShell } from "@/screens/ReadyShell";
import { themeById } from "@/themes";
import { scanRoots } from "@/lib/scanner";
import { enrichScans } from "@/lib/creature";

const root = process.env.REPOGARDEN_SNAPSHOT_ROOT ?? process.cwd();
const result = scanRoots([root], 4);
const creatures = enrichScans(result.repos);
const choice = themeById(process.env.THEME ?? "high-contrast")!;

const { unmount } = render(
  <ThemeProvider theme={choice.theme}>
    <ReadyShell
      creatures={creatures}
      view={(process.env.VIEW as "garden" | "journal") ?? "garden"}
      rootsLabel={root}
    />
  </ThemeProvider>,
  { exitOnCtrlC: false, patchConsole: false }
);
setTimeout(() => {
  unmount();
  process.exit(0);
}, 500);
