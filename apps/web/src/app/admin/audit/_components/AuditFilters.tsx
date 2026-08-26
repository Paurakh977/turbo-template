'use client';

import { useEffect, useState, useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

type AuditActionOption = {
  key: string;
  label: string;
  emoji: string;
};

type AuditFiltersProps = {
  initialQuery: string;
  initialAction: string;
  actions: AuditActionOption[];
};

export function AuditFilters({
  initialQuery,
  initialAction,
  actions,
}: AuditFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const [query, setQuery] = useState(initialQuery);
  const [action, setAction] = useState(initialAction);

  const searchParamsString = searchParams.toString();

  useEffect(() => {
    const params = new URLSearchParams(searchParamsString);
    setQuery(params.get('q')?.trim() ?? '');
    setAction(params.get('action') ?? 'all');
  }, [searchParamsString]);

  useEffect(() => {
    const params = new URLSearchParams(searchParamsString);
    const currentQuery = params.get('q')?.trim() ?? '';
    const currentAction = params.get('action') ?? 'all';

    const nextQuery = query.trim();
    const nextAction = action || 'all';

    if (nextQuery === currentQuery && nextAction === currentAction) return;

    const timeout = setTimeout(() => {
      const nextParams = new URLSearchParams(searchParamsString);

      if (nextQuery) {
        nextParams.set('q', nextQuery);
      } else {
        nextParams.delete('q');
      }

      if (nextAction !== 'all') {
        nextParams.set('action', nextAction);
      } else {
        nextParams.delete('action');
      }

      nextParams.delete('page');

      const qs = nextParams.toString();
      startTransition(() => {
        router.replace(qs ? `${pathname}?${qs}` : pathname);
      });
    }, 350);

    return () => clearTimeout(timeout);
  }, [query, action, pathname, router, searchParamsString, startTransition]);

  return (
    <div className="rounded-2xl border border-border/60 bg-card p-4 flex flex-col sm:flex-row items-center gap-3 shadow-sm dark:bg-white/[0.01] dark:shadow-[0_4px_24px_rgba(0,0,0,0.2)]">
      <div className="relative flex-1 w-full">
        <svg
          className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>
        <input
          type="text"
          name="q"
          aria-label="Search audit events by user email, name, or ID"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by user email, name, or ID..."
          className="w-full pl-9 pr-4 py-2.5 bg-background border border-border/60 rounded-xl text-[14px] outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all placeholder:text-muted-foreground/50"
        />
      </div>

      <div className="w-full sm:w-auto flex items-center gap-3">
        <select
          name="action"
          aria-label="Filter audit events by action"
          value={action}
          onChange={(event) => setAction(event.target.value)}
          className="w-full sm:w-auto px-4 py-2.5 bg-background border border-border/60 rounded-xl text-[14px] outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all appearance-none cursor-pointer"
        >
          <option value="all">All Events</option>
          {actions.map((act) => (
            <option key={act.key} value={act.key}>
              {act.emoji} {act.label}
            </option>
          ))}
        </select>

        <span className="w-full sm:w-auto px-4 py-2.5 text-center text-[12px] text-muted-foreground rounded-xl border border-border/60 bg-background/60">
          {isPending ? 'Filtering...' : 'Auto'}
        </span>
      </div>
    </div>
  );
}
