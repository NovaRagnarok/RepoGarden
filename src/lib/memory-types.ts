export interface ProjectMemory {
  currentBlocker?: string;
  noteToFutureSelf?: string;
  lastVisitedAt?: string;
  hidden?: boolean;
  gardenPlacement?: {
    offsetX: number;
    offsetY: number;
  };
}
