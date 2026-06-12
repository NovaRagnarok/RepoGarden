// Ink-level integration tests for ReadyShell: real screen, fake TTY streams,
// real keyboard input through Ink's parser. See helpers/ink-harness.tsx for
// the stream contract and helpers/test-env.ts for the env/HOME isolation.
//
// The harness import MUST stay first so its env guards evaluate before any
// app module.
import { renderScreen, waitFor, type InkHarness } from "./helpers/ink-harness";

import test from "node:test";
import assert from "node:assert/strict";

import { useState } from "react";

import { buildDemoCreatures } from "../lib/demo-roster";
import { appendEvent } from "../lib/events";
import { ReadyShell, type ReadyView } from "../screens/ReadyShell";
import type { RepoCreature } from "../lib/creature";

// Synthetic roster (same fixtures the demo uses) — no real repos scanned.
// The full roster spans all four vibes, which the rooms-view test relies on.
const ROSTER = buildDemoCreatures();
const FIRST_NAME = ROSTER[0].scan.name;

// Layout cheat sheet (src/lib/responsive-layout.ts):
// - sidebar needs tier "rich" AND columns >= 120 → 120×40 has it, 100×30 not.
// - rooms view falls back to its compact single-vibe mode when the canvas is
//   short (gardenInnerHeight < 2*ROOM_COMPACT_TRIGGER_H = 32 with 3+ vibes),
//   so the divider-label test uses a 140×50 terminal to get real dividers.
// - 80×24 is the "compact" floor (one cell smaller is the resize prompt).
const WIDE = { columns: 120, rows: 40 };
const ROOMS_SIZE = { columns: 140, rows: 50 };
const SMALL = { columns: 80, rows: 24 };

interface ShellHostProps {
  creatures?: RepoCreature[];
  initialView?: ReadyView;
  onViewChange?: (view: ReadyView) => void;
  onQuit?: () => void;
}

// ReadyShell's `view` is controlled by the parent (pressing `g` only calls
// onSetView) — mirror the App component in cli-main.tsx with a tiny stateful
// wrapper that owns the view state.
const ShellHost = ({ creatures = ROSTER, initialView = "garden", onViewChange, onQuit }: ShellHostProps) => {
  const [view, setView] = useState<ReadyView>(initialView);
  return (
    <ReadyShell
      creatures={creatures}
      rootsLabel="~/work"
      view={view}
      onSetView={(next) => {
        onViewChange?.(next);
        setView(next);
      }}
      onQuit={onQuit}
      usageBarDisabled
    />
  );
};

const mountedFrame = (harness: InkHarness): Promise<void> =>
  waitFor(() => harness.lastFrame().includes("REPOGARDEN"), {
    onTimeout: () => harness.lastFrame()
  });

test("ReadyShell mounts in garden view with chrome, view badges, and sidebar repo names", async () => {
  const harness = renderScreen(<ShellHost />, WIDE);
  try {
    await mountedFrame(harness);
    await waitFor(() => harness.lastFrame().includes(FIRST_NAME), {
      onTimeout: () => harness.lastFrame()
    });

    const frame = harness.lastFrame();
    // Header chrome.
    assert.match(frame, /a little local habitat/);
    assert.match(frame, /where your repos live/);
    // View toggle badges (GARDEN active styling is color-only and stripped,
    // but all three labels must be present).
    assert.match(frame, /GARDEN/);
    assert.match(frame, /ROOMS/);
    assert.match(frame, /JOURNAL/);
    // Sidebar: panel title with the roster count + the home row + repo names.
    assert.match(frame, new RegExp(`creatures · ${ROSTER.length}`));
    assert.match(frame, /⌂ home/);
    assert.ok(frame.includes(FIRST_NAME), `sidebar should list ${FIRST_NAME}`);
    // Garden footer hint.
    assert.match(frame, /↑↓ move · ↵ open/);
  } finally {
    harness.unmount();
  }
});

test("pressing g cycles view garden → rooms → journal → github → garden", async () => {
  const seen: ReadyView[] = [];
  const harness = renderScreen(<ShellHost onViewChange={(v) => seen.push(v)} />, WIDE);
  try {
    await mountedFrame(harness);

    // garden → rooms. Rooms keeps the garden-style footer, so key off the
    // recorded onSetView call plus the frame staying alive.
    harness.press("g");
    await waitFor(() => seen.length === 1, { onTimeout: () => harness.lastFrame() });
    assert.equal(seen[0], "rooms");

    // rooms → journal. Journal swaps the footer hint line.
    harness.press("g");
    await waitFor(() => harness.lastFrame().includes("↵ enter journal"), {
      onTimeout: () => harness.lastFrame()
    });
    assert.deepEqual(seen, ["rooms", "journal"]);

    // journal → github. Catalog footer exposes GitHub actions.
    harness.press("g");
    await waitFor(() => harness.lastFrame().includes("↵ clone"), {
      onTimeout: () => harness.lastFrame()
    });
    assert.deepEqual(seen, ["rooms", "journal", "github"]);

    // github → garden. Footer reverts to the garden hint.
    harness.press("g");
    await waitFor(
      () => {
        const frame = harness.lastFrame();
        return frame.includes("↑↓ move · ↵ open") && !frame.includes("enter journal");
      },
      { onTimeout: () => harness.lastFrame() }
    );
    assert.deepEqual(seen, ["rooms", "journal", "github", "garden"]);
  } finally {
    harness.unmount();
  }
});

test("rooms view paints vibe divider labels with counts", async () => {
  const harness = renderScreen(<ShellHost initialView="rooms" />, ROOMS_SIZE);
  try {
    await mountedFrame(harness);

    // The chrome's vibe summary row (Ink-rendered) shows per-vibe counts.
    const byVibe = new Map<string, number>();
    for (const creature of ROSTER) {
      byVibe.set(creature.vibe.vibe, (byVibe.get(creature.vibe.vibe) ?? 0) + 1);
    }
    assert.ok(byVibe.size >= 2, "fixture roster should span multiple vibes");
    for (const [vibe, count] of byVibe) {
      await waitFor(() => harness.lastFrame().includes(`${count} ${vibe}`), {
        onTimeout: () => harness.lastFrame()
      });
    }

    // The room dividers themselves are painted by the garden engine's
    // direct-stdout painter (src/garden/engine.ts), NOT by Ink — they never
    // appear in lastFrame(). The engine writes to the harness's fake stdout
    // though, so assert against the combined output(). Divider label format:
    // "<vibe> · <descriptor> · <count>" (long) or "<vibe> · <count>" (short),
    // optionally with a " · page/pages" suffix — see formatShelfDividerLabel
    // in src/lib/garden-layout.ts.
    for (const [vibe, count] of byVibe) {
      const divider = new RegExp(`${vibe} · (?:[a-z ]+ · )?${count}`);
      await waitFor(() => divider.test(harness.output()), {
        onTimeout: () => harness.lastFrame()
      });
    }
  } finally {
    harness.unmount();
  }
});

test("journal view: Esc toggles two-pane focus between event pane and sidebar", async () => {
  // Seed the (HOME-isolated) journal store: with zero events JournalView
  // renders only its empty-state panel, whose pane-focus indication is
  // border-color-only and invisible after ANSI stripping. With events
  // present, the header's controls row spells the focus owner out in text.
  appendEvent({
    ts: new Date(Date.now() - 60_000).toISOString(),
    repoId: ROSTER[0].id,
    repoName: FIRST_NAME,
    kind: "commit",
    payload: { subject: "seeded test commit" }
  });
  appendEvent({
    ts: new Date().toISOString(),
    repoId: ROSTER[1].id,
    repoName: ROSTER[1].scan.name,
    kind: "note-created",
    payload: { name: "scratch" }
  });

  const harness = renderScreen(<ShellHost initialView="journal" />, WIDE);
  try {
    await mountedFrame(harness);

    // The event timeline pane renders the seeded events.
    await waitFor(() => harness.lastFrame().includes("2 events"), {
      onTimeout: () => harness.lastFrame()
    });

    // Two-pane focus model (CHANGELOG 0.9.1): the focus owner is announced
    // by JournalView's OWN hint row — "↑↓/jk events" when the event pane has
    // the keyboard, "↑↓/jk repo" when the sidebar does. (ReadyShell's static
    // journal footer mentions both "enter journal" and "esc back to sidebar"
    // regardless of focus, so it can't be used as the signal.)
    const paneFocused = () => harness.lastFrame().includes("↑↓/jk events");
    const sidebarFocused = () => harness.lastFrame().includes("↑↓/jk repo");

    // Pane focus + the virtual "home" sidebar row are applied by an effect
    // on journal entry, one frame after first paint — wait for both.
    await waitFor(() => paneFocused(), { onTimeout: () => harness.lastFrame() });
    await waitFor(() => /›\s*⌂\s*home/.test(harness.lastFrame()), {
      onTimeout: () => harness.lastFrame()
    });

    // While the PANE owns focus, ↓ must not move the sidebar cursor.
    harness.press("down");
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.match(harness.lastFrame(), /›\s*⌂\s*home/);
    assert.ok(paneFocused());

    // Esc flips keyboard focus to the sidebar.
    harness.press("escape");
    await waitFor(() => sidebarFocused(), { onTimeout: () => harness.lastFrame() });

    // Now ↓ walks the sidebar: home → first creature gets the focus cursor.
    // (Use .some(): once the selection lands, the journal panel title also
    // mentions the repo name — "journal · <repo>" — without a cursor.)
    harness.press("down");
    await waitFor(
      () =>
        harness
          .lastFrame()
          .split("\n")
          .some((row) => row.includes(FIRST_NAME) && row.includes("›")),
      { onTimeout: () => harness.lastFrame() }
    );
    // Scoping followed the sidebar selection.
    assert.match(harness.lastFrame(), new RegExp(`journal · ${FIRST_NAME}`));

    // Esc again hands focus back to the event pane.
    harness.press("escape");
    await waitFor(() => paneFocused(), { onTimeout: () => harness.lastFrame() });
  } finally {
    harness.unmount();
  }
});

test("q calls onQuit", async () => {
  let quits = 0;
  const harness = renderScreen(<ShellHost onQuit={() => (quits += 1)} />, WIDE);
  try {
    await mountedFrame(harness);
    harness.press("q");
    await waitFor(() => quits === 1, { onTimeout: () => harness.lastFrame() });
    assert.equal(quits, 1);
  } finally {
    harness.unmount();
  }
});

test("small terminal (80×24): ReadyShell renders without throwing and keeps chrome labels", async () => {
  const seen: ReadyView[] = [];
  const harness = renderScreen(<ShellHost onViewChange={(v) => seen.push(v)} />, SMALL);
  try {
    await mountedFrame(harness);
    const frame = harness.lastFrame();
    // Compact tier: no sidebar, but the chrome must survive the squeeze
    // (regression class: flexShrink collapsing labels, 0.9.1).
    assert.match(frame, /REPOGARDEN/);
    assert.match(frame, /GARDEN/);
    assert.match(frame, /ROOMS/);
    assert.match(frame, /JOURNAL/);
    assert.match(frame, /↑↓ move · ↵ open/);
    // Sanity: no rendered line exceeds the terminal width.
    for (const line of frame.split("\n")) {
      assert.ok(line.length <= SMALL.columns, `line wider than terminal: ${JSON.stringify(line)}`);
    }
    // Keyboard input still routes in the compact layout.
    harness.press("g");
    await waitFor(() => seen.length === 1, { onTimeout: () => harness.lastFrame() });
    assert.deepEqual(seen, ["rooms"]);
  } finally {
    harness.unmount();
  }
});
