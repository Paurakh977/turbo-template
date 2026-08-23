'use client';

import { createContext, useContext, ReactNode, useEffect } from 'react';
import { useToastRegion } from './use-toast-region';
import { ToastRegion, type ToastKind } from '../app/_components/ToastRegion';
import {
  AUTH_RATE_LIMIT_EVENT,
  AUTH_RATE_LIMIT_MESSAGE,
  type AuthRateLimitDetail,
} from './auth-rate-limit-event';

type ToastContextType = {
  pushToast: (kind: ToastKind, message: string) => void;
};

const ToastContext = createContext<ToastContextType | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const { toasts, pushToast, dismissToast } = useToastRegion();

  useEffect(() => {
    const onRateLimit = (event: Event) => {
      const customEvent = event as CustomEvent<AuthRateLimitDetail>;
      const { message, retryAfter } = customEvent.detail ?? {};
      const finalMessage =
        message ??
        (retryAfter
          ? `Too many requests. Please try again in ${retryAfter}s.`
          : AUTH_RATE_LIMIT_MESSAGE);
      pushToast('error', finalMessage);
    };

    window.addEventListener(AUTH_RATE_LIMIT_EVENT, onRateLimit);
    return () => {
      window.removeEventListener(AUTH_RATE_LIMIT_EVENT, onRateLimit);
    };
  }, [pushToast]);

  return (
    <ToastContext.Provider value={{ pushToast }}>
      {children}
      <ToastRegion toasts={toasts} onDismiss={dismissToast} />
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}
