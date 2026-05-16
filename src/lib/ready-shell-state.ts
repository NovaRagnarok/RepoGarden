import { paginateCreatures } from "@/lib/garden-layout";

export interface ReadyPaginationState<T> {
  pages: T[][];
  pageCount: number;
  safePageIndex: number;
  pageItems: T[];
}

export const resolveReadyPagination = <T>({
  items,
  isGardenView,
  paginate,
  capacity,
  pageIndex
}: {
  items: T[];
  isGardenView: boolean;
  paginate: boolean;
  capacity: number;
  pageIndex: number;
}): ReadyPaginationState<T> => {
  const pages = isGardenView && paginate ? paginateCreatures(items, capacity) : [items];
  const pageCount = Math.max(1, pages.length);
  const safePageIndex = Math.min(Math.max(0, pageIndex), pageCount - 1);
  return {
    pages,
    pageCount,
    safePageIndex,
    pageItems: pages[safePageIndex] ?? []
  };
};

export const buildReadyFocusList = <T>(visible: T[], hidden: T[]): T[] => [
  ...visible,
  ...hidden
];

export const clampReadyFocusIndex = (index: number, length: number): number => {
  if (length <= 0) return 0;
  return Math.max(0, Math.min(length - 1, index));
};

export const focusedGardenIndex = ({
  homeSelected,
  focusIndex,
  visibleCount
}: {
  homeSelected: boolean;
  focusIndex: number;
  visibleCount: number;
}): number => (homeSelected || focusIndex >= visibleCount ? -1 : focusIndex);

export const followVisibleItemAfterUnhide = ({
  globalIndex,
  capacity
}: {
  globalIndex: number;
  capacity: number;
}): { pageIndex: number; focusIndex: number } | null => {
  if (globalIndex < 0 || capacity <= 0) return null;
  return {
    pageIndex: Math.floor(globalIndex / capacity),
    focusIndex: globalIndex % capacity
  };
};
