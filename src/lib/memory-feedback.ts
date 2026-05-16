export type MemoryNoteKind = "blocker" | "future-self" | "note";

export interface MemoryEditFeedback {
  kind: MemoryNoteKind;
  changed: boolean;
  previousText: string;
  nextText: string;
  previousTrimmed: string;
  nextTrimmed: string;
  charDelta: number;
  lineDelta: number;
  status: string;
  toast: string;
}

const CHARS_DELTA_HINT_THRESHOLD = 20;

const normalizeName = (name: string): string =>
  name
    .trim()
    .toLowerCase()
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ");

const normalizeText = (text: string): string =>
  text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

const lineCount = (text: string): number =>
  text.length === 0 ? 0 : text.split("\n").length;

const formatSigned = (value: number): string =>
  value > 0 ? `+${value}` : String(value);

const plural = (count: number, noun: string): string =>
  `${formatSigned(count)} ${noun}${Math.abs(count) === 1 ? "" : "s"}`;

const truncateName = (name: string): string => {
  const clean = name.trim() || "note";
  return clean.length > 28 ? `${clean.slice(0, 27)}…` : clean;
};

export const classifyMemoryNoteName = (name: string): MemoryNoteKind => {
  const normalized = normalizeName(name);
  if (normalized === "blocker") return "blocker";
  if (
    normalized === "note to future self" ||
    normalized === "future self" ||
    normalized === "future note" ||
    normalized === "note for future self"
  ) {
    return "future-self";
  }
  return "note";
};

export const describeMemoryEditDelta = (
  previousText: string,
  nextText: string
): { charDelta: number; lineDelta: number; label: string } => {
  const previous = normalizeText(previousText);
  const next = normalizeText(nextText);
  const charDelta = next.length - previous.length;
  const lineDelta = lineCount(next) - lineCount(previous);
  const parts: string[] = [];
  if (lineDelta !== 0) parts.push(plural(lineDelta, "line"));
  if (Math.abs(charDelta) >= CHARS_DELTA_HINT_THRESHOLD) {
    parts.push(plural(charDelta, "char"));
  }
  if (parts.length === 0 && charDelta !== 0) parts.push("small edit");
  if (parts.length === 0) parts.push("no text changes");
  return { charDelta, lineDelta, label: parts.join(" · ") };
};

export const buildMemoryEditFeedback = (
  noteName: string,
  previousText: string,
  nextText: string
): MemoryEditFeedback => {
  const previous = normalizeText(previousText);
  const next = normalizeText(nextText);
  const previousTrimmed = previous.trim();
  const nextTrimmed = next.trim();
  const changed = previous !== next;
  const kind = classifyMemoryNoteName(noteName);
  const delta = describeMemoryEditDelta(previous, next);
  const suffix = ` · ${delta.label}`;

  if (!changed) {
    return {
      kind,
      changed,
      previousText: previous,
      nextText: next,
      previousTrimmed,
      nextTrimmed,
      charDelta: delta.charDelta,
      lineDelta: delta.lineDelta,
      status: "saved · no text changes",
      toast: "saved · no text changes",
    };
  }

  if (kind === "blocker") {
    const verb = !previousTrimmed && nextTrimmed
      ? "set"
      : previousTrimmed && !nextTrimmed
        ? "cleared"
        : "updated";
    const shelfHint =
      verb === "set"
        ? " · shelf now stuck"
        : verb === "cleared"
          ? " · shelf can leave stuck"
          : "";
    return {
      kind,
      changed,
      previousText: previous,
      nextText: next,
      previousTrimmed,
      nextTrimmed,
      charDelta: delta.charDelta,
      lineDelta: delta.lineDelta,
      status: `blocker ${verb}${suffix}${shelfHint}`,
      toast: `blocker ${verb}${suffix}${shelfHint}`,
    };
  }

  if (kind === "future-self") {
    const verb = !previousTrimmed && nextTrimmed
      ? "set"
      : previousTrimmed && !nextTrimmed
        ? "cleared"
        : "updated";
    return {
      kind,
      changed,
      previousText: previous,
      nextText: next,
      previousTrimmed,
      nextTrimmed,
      charDelta: delta.charDelta,
      lineDelta: delta.lineDelta,
      status: `future-self note ${verb}${suffix}`,
      toast: `future-self note ${verb}${suffix}`,
    };
  }

  const verb = !previousTrimmed && nextTrimmed
    ? "started"
    : previousTrimmed && !nextTrimmed
      ? "cleared"
      : "updated";
  const subject = `note "${truncateName(noteName)}"`;
  return {
    kind,
    changed,
    previousText: previous,
    nextText: next,
    previousTrimmed,
    nextTrimmed,
    charDelta: delta.charDelta,
    lineDelta: delta.lineDelta,
    status: `${subject} ${verb}${suffix}`,
    toast: `${subject} ${verb}${suffix}`,
  };
};
