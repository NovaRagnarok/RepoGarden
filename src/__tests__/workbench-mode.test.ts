import test from "node:test";
import assert from "node:assert/strict";

import { isEditorActive, isEditorVisible } from "../lib/workbench-mode";

/**
 * Issue #23 — flipping ctrl+1 (PORTRAIT) ↔ ctrl+2 (NOTES) used to unmount
 * the TextArea, dropping its local cursor + scroll state. The fix renders
 * the editor subtree always and toggles `display` on its parent Box. These
 * predicates drive both the visibility gate and the `isActive` prop passed
 * to TextArea — testing them pins down the truth-table that the fix relies
 * on so a future refactor can't accidentally re-introduce the unmount.
 *
 * Unit-testing the full screen would require ink-testing-library which
 * isn't in this repo's deps; the helpers here are pure functions of the
 * same inputs the screen feeds them, so they exercise the meaningful
 * logic without spinning up a renderer.
 */

test("isEditorVisible is true only in NOTES mode with the palette closed", () => {
  assert.equal(
    isEditorVisible({ workbenchMode: "notes", paletteOpen: false }),
    true
  );
  assert.equal(
    isEditorVisible({ workbenchMode: "notes", paletteOpen: true }),
    false,
    "command palette overlays the editor and should hide it"
  );
  assert.equal(
    isEditorVisible({ workbenchMode: "portrait", paletteOpen: false }),
    false,
    "PORTRAIT mode hides the editor so it has no surface to paint on"
  );
  assert.equal(
    isEditorVisible({ workbenchMode: "portrait", paletteOpen: true }),
    false
  );
});

test("isEditorActive ANDs visibility with edit/status uiMode kinds", () => {
  // The happy path: visible + an editing-capable uiMode → active.
  assert.equal(
    isEditorActive({
      workbenchMode: "notes",
      paletteOpen: false,
      uiModeKind: "edit",
    }),
    true
  );
  assert.equal(
    isEditorActive({
      workbenchMode: "notes",
      paletteOpen: false,
      uiModeKind: "status",
    }),
    true,
    "transient status toasts shouldn't yank focus from the caret"
  );

  // Visible but in a non-editing uiMode (naming/search/goto-line) → inactive.
  for (const uiModeKind of ["naming", "search", "goto-line", "confirm-pull"]) {
    assert.equal(
      isEditorActive({
        workbenchMode: "notes",
        paletteOpen: false,
        uiModeKind,
      }),
      false,
      `uiMode=${uiModeKind} owns its own input — editor must not also consume keys`
    );
  }
});

test("hidden editor never reports active (the keystroke-stealing fix)", () => {
  // This is the core invariant the fix relies on: when display:none hides
  // the editor subtree, isActive must be false so useInput/useFocus stop
  // consuming keystrokes that PORTRAIT mode should receive.
  for (const uiModeKind of ["edit", "status", "naming", "search", "goto-line"]) {
    assert.equal(
      isEditorActive({
        workbenchMode: "portrait",
        paletteOpen: false,
        uiModeKind,
      }),
      false,
      `PORTRAIT + uiMode=${uiModeKind} must leave the hidden editor inactive`
    );
    assert.equal(
      isEditorActive({
        workbenchMode: "notes",
        paletteOpen: true,
        uiModeKind,
      }),
      false,
      `palette open + uiMode=${uiModeKind} must leave the hidden editor inactive`
    );
  }
});
