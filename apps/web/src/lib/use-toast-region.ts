'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ToastItem, ToastKind } from '../app/_components/ToastRegion';

const TOAST_DURATION_MS = 3500;

export function useToastRegion() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  // Per-id timers so adding a new toast does not reset existing toast timers.
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );

  const dismissToast = useCallback((id: string) => {
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
      // Full-length randomUUID avoids same-millisecond collisions that
      // Date.now()+random could produce (duplicate React keys / dismissing
      // the wrong toast). No truncation: an int32 hash of 8 hex chars would
      // reintroduce birthday-collision risk. The template fallback covers
      // non-secure contexts where randomUUID is undefined.
      const id =
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
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
