'use client';

import { createContext, useContext, ReactNode } from 'react';
import { useToastRegion } from './use-toast-region';
import { ToastRegion, type ToastKind } from '../app/_components/ToastRegion';

type ToastContextType = {
  pushToast: (kind: ToastKind, message: string) => void;
};

const ToastContext = createContext<ToastContextType | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const { toasts, pushToast, dismissToast } = useToastRegion();

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
