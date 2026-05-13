import { Box } from "ink";
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

interface ActiveToast {
  id: number;
  message: string;
  variant: ToastVariant;
  duration: number;
}

interface LatestStatus {
  message: string;
  variant: ToastVariant;
}

interface ToastApi {
  push: (message: string, variant?: ToastVariant, duration?: number) => void;
  latest: LatestStatus | null;
  active: ActiveToast[];
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export const ToastProvider = ({ children }: { children: ReactNode }) => {
  const [active, setActive] = useState<ActiveToast[]>([]);
  const [latest, setLatest] = useState<LatestStatus | null>(null);
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

  const value = useMemo<ToastApi>(
    () => ({ push, latest, active, dismiss }),
    [push, latest, active, dismiss]
  );

  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
};

export const useToasts = (): ToastApi => {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    return {
      push: () => {},
      latest: null,
      active: [],
      dismiss: () => {},
    };
  }
  return ctx;
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
