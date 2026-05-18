'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ToastItem, ToastKind } from '../app/_components/ToastRegion';

const TOAST_DURATION_MS = 3500;

export function useToastRegion() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  // Per-id timers so adding a new toast does not reset existing toast timers.
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(
    new Map(),
  );

  const dismissToast = useCallback((id: number) => {
    const timers = timersRef.current;
    const handle = timers.get(id);
    if (handle) {
      clearTimeout(handle);
      timers.delete(id);
    }
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const pushToast = useCallback(
    (kind: ToastKind, message: string) => {
      const id = Date.now() + Math.floor(Math.random() * 1000);
      setToasts((prev) => [...prev, { id, kind, message }]);
      const handle = setTimeout(() => {
        dismissToast(id);
      }, TOAST_DURATION_MS);
      timersRef.current.set(id, handle);
    },
    [dismissToast],
  );

  // Cleanup all pending timers on unmount.
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const handle of timers.values()) {
        clearTimeout(handle);
      }
      timers.clear();
    };
  }, []);

  return {
    toasts,
    pushToast,
    dismissToast,
  };
}
