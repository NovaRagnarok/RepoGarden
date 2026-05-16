export interface RecentCommit {
  sha: string;
  shortSha: string;
  subject: string;
  committedAt: string;
  author: string;
}

export type DirtyFileSkipReason = "too-large" | "binary" | "sensitive";

export interface DirtyFileChange {
  filename: string;
  oldText: string;
  newText: string;
  truncated: boolean;
  /** Set when the file's content was deliberately not loaded. Renderers
   *  should show a placeholder instead of a diff in that case. */
  skipped?: DirtyFileSkipReason;
}

export interface DirtyFileStatus {
  filename: string;
  code: string;
  label: string;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
  renamedFrom?: string;
}

export interface ScannedRepo {
  id: string;
  path: string;
  name: string;
  branch?: string;
  isDirty: boolean;
  ahead?: number;
  behind?: number;
  lastCommitSubject?: string;
  lastCommitSha?: string;
  lastCommitAt?: string;
  primaryLanguage?: string;
  recentCommits?: RecentCommit[];
  /** Daily commit counts for the last 30 days, oldest first. */
  recentCommitDays?: number[];
  commitCount?: number;
  /** Count of recognized source files under the repo (depth-limited walk,
   *  SKIP_DIRS + SKIP_FILE_PATTERNS applied). Drives creature size. */
  fileCount?: number;
  /** Total lines of code across those recognized source files (raw newline
   *  count — blank/comment lines included). Primary "mass" signal for
   *  creature size. LOC over byte size so a file padded with long base64
   *  blobs doesn't read as massive, and verbose-line languages don't get
   *  an unfair size boost. */
  sourceLines?: number;
  /** First few dirty files with HEAD vs working-tree text, for diff view. */
  dirtyChanges?: DirtyFileChange[];
  /** Porcelain-status inventory for dirty files, capped for display. */
  dirtyFiles?: DirtyFileStatus[];
  /** Total count of dirty files when dirtyChanges / dirtyFiles are truncated. */
  dirtyFileCount?: number;
  scanError?: string;
}

export interface RootProgress {
  root: string;
  done: number;
  total: number;
}
