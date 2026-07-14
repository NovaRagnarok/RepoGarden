import { Box, Text } from "ink";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { Toast, type ToastVariant } from "@/components/ui/toast";
import { useTheme } from "@/components/ui/theme-provider";

interface ActiveToast {
  id: number;
  message: string;
  variant: ToastVariant;
  duration: number;
  stickyKey?: string;
}

interface LatestStatus {
  message: string;
  variant: ToastVariant;
  stickyKey?: string;
}

interface StickyStatus extends LatestStatus {
  stickyKey: string;
}

interface ToastApi {
  push: (message: string, variant?: ToastVariant, duration?: number) => void;
  setSticky: (
    key: string,
    message: string,
    variant?: ToastVariant,
    duration?: number
  ) => void;
  clearSticky: (key: string) => void;
  latest: LatestStatus | null;
  sticky: StickyStatus | null;
  active: ActiveToast[];
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export const ToastProvider = ({ children }: { children: ReactNode }) => {
  const [active, setActive] = useState<ActiveToast[]>([]);
  const [latest, setLatest] = useState<LatestStatus | null>(null);
  const [sticky, setStickyStatus] = useState<StickyStatus | null>(null);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setActive((current) => current.filter((entry) => entry.id !== id));
  }, []);

  const push = useCallback(
    (message: string, variant: ToastVariant = "info", duration = 3000) => {
      const id = nextId.current++;
      setActive((current) => [...current, { id, message, variant, duration }]);
      setLatest({ message, variant });
    },
    []
  );

  const setSticky = useCallback(
    (key: string, message: string, variant: ToastVariant = "warning", duration = 6000) => {
      const id = nextId.current++;
      const status = { stickyKey: key, message, variant };
      setActive((current) => [
        ...current.filter((entry) => entry.stickyKey !== key),
        { id, message, variant, duration, stickyKey: key },
      ]);
      setLatest(status);
      setStickyStatus(status);
    },
    []
  );

  const clearSticky = useCallback((key: string) => {
    setActive((current) => current.filter((entry) => entry.stickyKey !== key));
    setLatest((current) => (current?.stickyKey === key ? null : current));
    setStickyStatus((current) => (current?.stickyKey === key ? null : current));
  }, []);

  const value = useMemo<ToastApi>(
    () => ({ push, setSticky, clearSticky, latest, sticky, active, dismiss }),
    [push, setSticky, clearSticky, latest, sticky, active, dismiss]
  );

  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
};

export const useToasts = (): ToastApi => {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    return {
      push: () => {},
      setSticky: () => {},
      clearSticky: () => {},
      latest: null,
      sticky: null,
      active: [],
      dismiss: () => {},
    };
  }
  return ctx;
};

export const StickyStatusLine = () => {
  const { sticky } = useToasts();
  const theme = useTheme();
  if (!sticky) return null;

  const color = (() => {
    switch (sticky.variant) {
      case "success":
        return theme.colors.success;
      case "error":
        return theme.colors.error;
      case "warning":
        return theme.colors.warning;
      default:
        return theme.colors.info;
    }
  })();
  const icon =
    sticky.variant === "success"
      ? "✓"
      : sticky.variant === "error"
        ? "✗"
        : sticky.variant === "warning"
          ? "⚠"
          : "ℹ";

  return (
    <Box paddingBottom={1}>
      <Text color={color} wrap="truncate-end">
        {icon} {sticky.message}
      </Text>
    </Box>
  );
};

export const Toaster = ({ max = 3 }: { max?: number }) => {
  const { active, dismiss } = useToasts();
  if (active.length === 0) return null;

  const visible = active.slice(-max);

  return (
    <Box flexDirection="column" alignSelf="flex-end">
      {visible.map((entry) => (
        <Toast
          key={entry.id}
          message={entry.message}
          variant={entry.variant}
          duration={entry.duration}
          showProgress={false}
          onDismiss={() => dismiss(entry.id)}
        />
      ))}
    </Box>
  );
};
