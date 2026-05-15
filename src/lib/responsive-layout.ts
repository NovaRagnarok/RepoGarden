export type TerminalLayoutTier = "too-small" | "compact" | "rich";

export interface TerminalLayout {
  tier: TerminalLayoutTier;
  columns: number;
  rows: number;
  contentWidth: number;
  contentHeight: number;
  showRichChrome: boolean;
  showSidebar: boolean;
  showOverlayCard: boolean;
  showUsageFooter: boolean;
  showBigBranding: boolean;
}

export interface OverlayCardSlot {
  reserved: boolean;
  visible: boolean;
  width: number;
  height: number;
  offsetTop: number;
  offsetLeft: number;
  deadZone?: { width: number; height: number };
}

export const MIN_COLUMNS = 80;
export const MIN_ROWS = 24;
export const RICH_COLUMNS = 100;
export const RICH_ROWS = 30;
export const OVERLAY_CARD_MIN_COLUMNS = 120;
export const OVERLAY_CARD_MIN_ROWS = 40;

export const getTerminalLayout = (columns: number, rows: number): TerminalLayout => {
  const safeColumns = Math.max(1, Math.floor(columns));
  const safeRows = Math.max(1, Math.floor(rows));
  const tier: TerminalLayoutTier =
    safeColumns < MIN_COLUMNS || safeRows < MIN_ROWS
      ? "too-small"
      : safeColumns >= RICH_COLUMNS && safeRows >= RICH_ROWS
        ? "rich"
        : "compact";
  const showSidebar = tier === "rich" && safeColumns >= OVERLAY_CARD_MIN_COLUMNS;

  return {
    tier,
    columns: safeColumns,
    rows: safeRows,
    contentWidth: Math.max(20, safeColumns - 2),
    contentHeight: Math.max(8, safeRows - 1),
    showRichChrome: tier === "rich",
    showSidebar,
    showOverlayCard:
      tier === "rich" &&
      safeColumns >= OVERLAY_CARD_MIN_COLUMNS &&
      safeRows >= OVERLAY_CARD_MIN_ROWS,
    showUsageFooter: tier === "rich",
    showBigBranding: tier === "rich"
  };
};

export const computeOverlayCardSlot = ({
  canReserve,
  cardVisible,
  gardenWidth,
  gardenHeight
}: {
  canReserve: boolean;
  cardVisible: boolean;
  gardenWidth: number;
  gardenHeight: number;
}): OverlayCardSlot => {
  const width = Math.max(30, Math.min(46, Math.floor(gardenWidth * 0.35)));
  const height = 10;
  const offsetTop = Math.max(0, gardenHeight - height - 1);
  const offsetLeft = Math.max(0, gardenWidth - width - 1);
  // Slot is only "active" when the layout can host the card AND the
  // user has it toggled on. When the user dismisses the card with
  // `c`, the bottom-right corner returns to the garden: stars render
  // there, creatures can wander or be dragged into it, and no
  // placeholder Box paints over the canvas.
  const active = canReserve && cardVisible;

  return {
    reserved: active,
    visible: active,
    width,
    height,
    offsetTop,
    offsetLeft,
    deadZone: active ? { width, height } : undefined
  };
};
