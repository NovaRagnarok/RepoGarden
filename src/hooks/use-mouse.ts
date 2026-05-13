import { useEffect } from "react";

import { subscribeMouse, type MouseEvent } from "@/lib/mouse";

export type MouseHandler = (event: MouseEvent) => void;

export const useMouse = (
  handler: MouseHandler,
  options?: { isActive?: boolean }
): void => {
  const isActive = options?.isActive ?? true;
  useEffect(() => {
    if (!isActive) return;
    const unsubscribe = subscribeMouse(handler);
    return () => {
      unsubscribe();
    };
  }, [handler, isActive]);
};
