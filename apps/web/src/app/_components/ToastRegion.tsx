'use client';

import { AnimatePresence, motion } from 'framer-motion';

export type ToastKind = 'success' | 'error' | 'info';

export type ToastItem = {
  id: string;
  kind: ToastKind;
  message: string;
};

const KIND_STYLES: Record<ToastKind, string> = {
  success: 'bg-background text-foreground border-border/60',
  error: 'bg-background text-red-500 border-red-500/20',
  info: 'bg-background text-foreground border-border/60',
};

const ICONS: Record<ToastKind, React.ReactNode> = {
  success: (
    <div className="w-4 h-4 rounded-full bg-emerald-500/10 text-emerald-500 flex items-center justify-center shrink-0">
      <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="3">
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
      </svg>
    </div>
  ),
  error: (
    <div className="w-4 h-4 rounded-full bg-red-500/10 text-red-500 flex items-center justify-center shrink-0">
      <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="3">
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
      </svg>
    </div>
  ),
  info: (
    <div className="w-4 h-4 rounded-full bg-blue-500/10 text-blue-500 flex items-center justify-center shrink-0">
      <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="3">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
      </svg>
    </div>
  ),
};

export function ToastRegion({
  toasts,
  onDismiss,
}: {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
}) {
  return (
    <div
      role="region"
      aria-label="Notifications"
      className="pointer-events-none fixed top-6 left-1/2 -translate-x-1/2 z-[100] flex w-max max-w-[90vw] flex-col items-center gap-2"
    >
      <AnimatePresence mode="popLayout">
        {toasts.map((toast) => (
          <motion.div
            key={toast.id}
            layout
            role={toast.kind === 'error' ? 'alert' : 'status'}
            initial={{ opacity: 0, y: -20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.15 } }}
            className={`pointer-events-auto rounded-full border px-4 py-2.5 shadow-[0_4px_12px_rgb(0,0,0,0.05)] dark:shadow-[0_4px_12px_rgb(0,0,0,0.2)] flex items-center gap-2.5 ${KIND_STYLES[toast.kind]}`}
          >
            {ICONS[toast.kind]}
            <p className="text-[13px] font-medium tracking-tight pr-1">
              {toast.message}
            </p>
            <button
              type="button"
              onClick={() => onDismiss(toast.id)}
              className="shrink-0 text-muted-foreground/50 hover:text-foreground transition-colors ml-1"
              aria-label="Dismiss notification"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
