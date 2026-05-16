// Vibe vocabulary (in display order, liveliest -> quietest):
//   awake  - recent local changes (uncommitted edits or ahead of remote)
//   happy  - clean working tree, in sync with remote
//   stuck  - user has written a `currentBlocker` note
//   sleepy - no commits for SLEEPY_DAYS or more
export type Vibe = "awake" | "happy" | "stuck" | "sleepy";

// Mood is an advisory descriptor layered on top of Vibe. Vibe answers
// "which shelf does this creature stand on?"; Mood answers "what does it
// feel like right now?". Nothing branches on Mood; it is renderer-only.
export type Mood =
  | "curious"
  | "excited"
  | "proud"
  | "anxious"
  | "confused"
  | "lonely"
  | "content";
