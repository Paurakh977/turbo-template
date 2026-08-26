'use client';

import { useEffect, useRef } from 'react';

type ActionDialogProps = {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  pending?: boolean;
  onConfirm: () => void;
  onClose: () => void;
  children?: React.ReactNode;
};

const FOCUSABLE_SELECTOR =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export function ActionDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  pending = false,
  onConfirm,
  onClose,
  children,
}: ActionDialogProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const previousBodyOverflowRef = useRef('');
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Lifecycle effect: capture/restore focus and body scroll-lock ONLY on
  // open/close transitions. It must NOT depend on `pending` - otherwise the
  // cleanup would fire on every pending flip mid-request, releasing the
  // scroll lock and yanking focus back to the page behind an open dialog.
  useEffect(() => {
    if (!open) return;

    previouslyFocusedRef.current = document.activeElement as HTMLElement;
    previousBodyOverflowRef.current = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const container = containerRef.current;
    if (container) {
      const focusables =
        container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (focusables.length > 0) {
        focusables[0]!.focus();
      } else {
        container.focus();
      }
    }

    return () => {
      if (previouslyFocusedRef.current) {
        previouslyFocusedRef.current.focus();
      }
      document.body.style.overflow = previousBodyOverflowRef.current;
    };
  }, [open]);

  // Keyboard handling: re-armed when `pending` changes so Escape stays
  // blocked while a request is in flight.
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !pending) {
        onCloseRef.current();
        return;
      }

      if (event.key === 'Tab' && containerRef.current) {
        const focusables = Array.from(
          containerRef.current.querySelectorAll<HTMLElement>(
            FOCUSABLE_SELECTOR,
          ),
        );
        if (focusables.length === 0) {
          event.preventDefault();
          return;
        }

        const first = focusables[0]!;
        const last = focusables[focusables.length - 1]!;

        if (event.shiftKey) {
          if (document.activeElement === first) {
            last.focus();
            event.preventDefault();
          }
        } else {
          if (document.activeElement === last) {
            first.focus();
            event.preventDefault();
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, pending]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        aria-describedby={description ? 'dialog-desc' : undefined}
        tabIndex={-1}
        className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl border border-border/70 bg-card p-6 shadow-2xl outline-none"
      >
        <h3
          id="dialog-title"
          className="text-base font-semibold tracking-tight text-foreground"
        >
          {title}
        </h3>
        {description ? (
          <p
            id="dialog-desc"
            className="mt-2 text-sm leading-relaxed text-muted-foreground"
          >
            {description}
          </p>
        ) : null}

        {children ? <div className="mt-4">{children}</div> : null}

        <div className="mt-6 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="rounded-lg border border-border/70 bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-60"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-60 ${
              destructive
                ? 'bg-red-500 text-white hover:bg-red-500/90'
                : 'bg-foreground text-background hover:bg-foreground/90'
            }`}
          >
            {pending ? 'Working...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
