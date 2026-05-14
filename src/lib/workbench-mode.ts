/**
 * Pure helpers for WorkbenchScreen's NOTES/PORTRAIT mode gates.
 *
 * Issue #23: flipping ctrl+1 ↔ ctrl+2 previously unmounted the editor's
 * TextArea, dropping its local cursorLine/cursorCol/scrollOffset state. The
 * fix renders the TextArea always and toggles visibility via Ink's
 * `display` prop on the parent Box, keeping React state intact. These
 * predicates compute (a) whether the editor subtree should be visible at
 * all, and (b) whether the TextArea should be active (consume keystrokes,
 * paint a caret). The active gate ANDs visibility with the usual edit/status
 * uiMode check so a hidden editor never steals input.
 */
export interface WorkbenchVisibilityInput {
  workbenchMode: "portrait" | "notes";
  paletteOpen: boolean;
}

export const isEditorVisible = (input: WorkbenchVisibilityInput): boolean =>
  input.workbenchMode === "notes" && !input.paletteOpen;

export interface WorkbenchActiveInput extends WorkbenchVisibilityInput {
  uiModeKind: string;
}

export const isEditorActive = (input: WorkbenchActiveInput): boolean =>
  isEditorVisible(input) &&
  (input.uiModeKind === "edit" || input.uiModeKind === "status");
