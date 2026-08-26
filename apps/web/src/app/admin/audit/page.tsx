import { headers } from 'next/headers';
import { requireAdmin } from '../../../lib/require-admin';
import { formatDistanceToNow } from 'date-fns';
import { THEME_GRANT_NAME, LABS_GRANT_NAME } from '@repo/auth/permissions';
import { parseRoles } from '@repo/auth/roles';
import { callInternalApi } from '../../../lib/server/internal-api';
import { isAPIError } from 'better-auth/api';

type AuditListingResponse = {
  logs: Array<{
    id: string;
    userId: string | null;
    action: string;
    actor: string | null;
    ipAddress: string | null;
    userAgent: string | null;
    metadata: unknown;
    createdAt: string;
  }>;
  total: number;
  page: number;
  totalPages: number;
  usersById: Record<
    string,
    { id: string; name: string | null; email: string }
  >;
};
import { AuditFilters } from './_components/AuditFilters';

export const dynamic = 'force-dynamic';

const ACTION_CONFIG: Record<
  string,
  { label: string; emoji: string; color: string }
> = {
  user_signed_up: { emoji: '🆕', label: 'Signed up', color: 'text-green-400' },
  session_created: { emoji: '🔑', label: 'Signed in', color: 'text-blue-400' },
  user_signed_out: {
    emoji: '🚪',
    label: 'Signed out',
    color: 'text-orange-400',
  },
  session_revoked: {
    emoji: '🔒',
    label: 'Session revoked',
    color: 'text-red-400',
  },
  sessions_revoked: {
    emoji: '🔒',
    label: 'Sessions revoked',
    color: 'text-red-400',
  },
  role_changed: {
    emoji: '🎭',
    label: 'Role changed',
    color: 'text-purple-400',
  },
  user_banned: { emoji: '🚫', label: 'Banned', color: 'text-red-500' },
  user_unbanned: { emoji: '✅', label: 'Unbanned', color: 'text-green-400' },
  user_impersonated: {
    emoji: '👤',
    label: 'Impersonated',
    color: 'text-yellow-400',
  },
  user_impersonation_started: {
    emoji: '👤',
    label: 'Started impersonation',
    color: 'text-yellow-400',
  },
  user_deleted: { emoji: '🗑️', label: 'Deleted', color: 'text-red-600' },
  email_changed: {
    emoji: '📧',
    label: 'Email changed',
    color: 'text-amber-400',
  },
  user_stop_impersonating: {
    emoji: '👤',
    label: 'Stopped impersonating',
    color: 'text-yellow-400',
  },
  user_impersonation_stopped: {
    emoji: '👤',
    label: 'Stopped impersonating',
    color: 'text-yellow-400',
  },
  note_created: { emoji: '📝', label: 'Note created', color: 'text-green-400' },
  note_updated: { emoji: '✏️', label: 'Note updated', color: 'text-blue-400' },
  note_deleted: { emoji: '🗑️', label: 'Note deleted', color: 'text-red-400' },
  profile_updated: {
    emoji: '👤',
    label: 'Profile updated',
    color: 'text-blue-400',
  },
  password_reset_requested: {
    emoji: '🔑',
    label: 'Password reset requested',
    color: 'text-amber-400',
  },
  account_deleted: {
    emoji: '💀',
    label: 'Account deleted',
    color: 'text-red-600',
  },
  theme_changed: {
    emoji: '🎨',
    label: 'Theme changed',
    color: 'text-purple-400',
  },
  labs_toggled: {
    emoji: '🧪',
    label: 'Labs toggled',
    color: 'text-fuchsia-400',
  },
};

function humanizeActionLabel(action: string): string {
  return action
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatAction(action: string) {
  const config = ACTION_CONFIG[action];
  if (!config)
    return {
      label: humanizeActionLabel(action),
      emoji: '📝',
      color: 'text-muted-foreground',
    };
  return config;
}

type MetadataUserMap = Map<string, { name: string | null; email: string }>;

function resolveUserId(
  value: unknown,
  userMap: MetadataUserMap,
): string | null {
  if (typeof value !== 'string') return null;
  const user = userMap.get(value);
  if (user) {
    const display = user.name || user.email || value.slice(0, 8);
    return user.email ? `${display} (${user.email})` : display;
  }
  return null;
}

function formatMetadata(metadata: unknown, userMap?: MetadataUserMap) {
  if (!metadata || typeof metadata !== 'object') return null;

  const entries = Object.entries(metadata as Record<string, unknown>);
  if (entries.length === 0) return null;

  const formatRoleList = (value: unknown) => {
    const tokens = parseRoles(value as string | string[] | null | undefined);

    return tokens
      .map((r) => {
        if (r === THEME_GRANT_NAME) return 'grant:theme';
        if (r === LABS_GRANT_NAME) return 'grant:labs';
        return r;
      })
      .join(' + ');
  };

  const formatValue = (value: unknown): string => {
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';
    if (typeof value === 'string') return value;
    if (
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      typeof value === 'bigint'
    ) {
      return String(value);
    }
    if (Array.isArray(value)) {
      return value.map((item) => formatValue(item)).join(', ');
    }
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  };

  const summary = entries
    .map(([key, value]) => {
      if (key === 'performedViaImpersonation') {
        return value === true ? 'via impersonation' : null;
      }
      if (key === 'impersonatedBy') {
        if (userMap) {
          const resolved = resolveUserId(value, userMap);
          if (resolved) return `by ${resolved}`;
        }
        return null;
      }
      if (key === 'noteId') return null;
      if (key === 'from' || key === 'to')
        return `${key === 'from' ? 'from' : 'to'} ${formatRoleList(value)}`;
      if (key === 'reason') return `reason: ${value}`;
      if (key === 'oldEmail') return `old: ${value}`;
      if (key === 'email') return `email: ${value}`;
      if (key === 'name') return `name: ${value}`;
      return `${key}: ${formatValue(value)}`;
    })
    .filter((value): value is string => Boolean(value))
    .join(', ');

  return summary || null;
}

function getPrimaryIp(ipAddress: string | null): string | null {
  if (!ipAddress) return null;
  return (
    ipAddress
      .split(',')
      .map((part) => part.trim())
      .find(Boolean) ?? null
  );
}

function formatUserDisplay(
  user: { name: string | null; email: string } | undefined,
  id: string,
) {
  if (!user) {
    return { name: id.slice(0, 8), email: null, isPartial: true };
  }
  const displayName = user.name || user.email || id.slice(0, 8);
  return { name: displayName, email: user.email, isPartial: false };
}

const USER_ACTIONS_WITHOUT_ACTOR = new Set([
  'session_created',
  'user_signed_out',
  'user_signed_up',
  'email_changed',
  'note_created',
  'note_updated',
  'note_deleted',
  'profile_updated',
  'password_reset_requested',
  'theme_changed',
  'labs_toggled',
  'account_deleted',
]);

type Props = {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

export default async function AuditLogPage(props: Props) {
  await requireAdmin();

  const searchParams = await props.searchParams;
  const requestedPage =
    typeof searchParams.page === 'string'
      ? Number.parseInt(searchParams.page, 10)
      : 1;
  const page =
    Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const q = typeof searchParams.q === 'string' ? searchParams.q.trim() : '';
  const filterAction =
    typeof searchParams.action === 'string' ? searchParams.action : 'all';

  const take = 50;

  // Architecture B: the listing (user search, OR clauses, pagination and
  // identity resolution) is computed by the API tier in one call.
  // Rate limiting is per-IP, so heavy multi-tab use shares one bucket - a
  // 429 here is transient and must render guidance, not a crash boundary.
  let listing: Awaited<
    ReturnType<typeof callInternalApi<AuditListingResponse>>
  >;
  try {
    listing = await callInternalApi<AuditListingResponse>('/api/admin/audit-logs', {
      requestHeaders: await headers(),
      query: {
        q: q || undefined,
        action: filterAction,
        page,
      },
      timeoutMs: 10_000,
    });
  } catch (error) {
    if (isAPIError(error) && error.status === 429) {
      return (
        <div className="min-h-[60vh] flex items-center justify-center px-4">
          <div className="max-w-md w-full rounded-2xl border border-border/70 bg-card/70 p-6 shadow-sm text-center">
            <h2 className="text-lg font-semibold tracking-tight">
              Slow down a little
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Too many requests from your connection right now. Wait a few
              seconds and reload.
            </p>
          </div>
        </div>
      );
    }
    throw error;
  }

  const { logs, total, page: currentPage, totalPages, usersById } = listing;

  const userMap = new Map(Object.entries(usersById));

  // Row window for the "showing X–Y of Z" footer (currentPage is the
  // API-clamped page).
  const skip = (currentPage - 1) * take;

  const getUserDisplay = (id: string | null) => {
    if (!id) return null;
    return formatUserDisplay(userMap.get(id) ?? undefined, id);
  };

  const allActions = Object.entries(ACTION_CONFIG).map(([key, cfg]) => ({
    key,
    label: cfg.label,
    emoji: cfg.emoji,
  }));

  const selectedActionMissing =
    filterAction !== 'all' &&
    !allActions.some((entry) => entry.key === filterAction);
  const actionOptions = selectedActionMissing
    ? [
        {
          key: filterAction,
          label: formatAction(filterAction).label,
          emoji: formatAction(filterAction).emoji,
        },
        ...allActions,
      ]
    : allActions;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Audit Log</h1>
          <p className="text-muted-foreground text-[14px] mt-1">
            Track security and administrative events across the platform.
          </p>
        </div>
      </div>

      <AuditFilters
        initialQuery={q}
        initialAction={filterAction}
        actions={actionOptions}
      />

      <div className="rounded-2xl border border-border/60 bg-card shadow-sm overflow-hidden dark:bg-white/[0.01] dark:shadow-[0_4px_24px_rgba(0,0,0,0.2)]">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/40 bg-muted/20">
                <th className="text-left px-5 py-4 font-semibold uppercase tracking-widest text-muted-foreground text-[11px]">
                  Event
                </th>
                <th className="text-left px-5 py-4 font-semibold uppercase tracking-widest text-muted-foreground text-[11px]">
                  Target User
                </th>
                <th className="text-left px-5 py-4 font-semibold uppercase tracking-widest text-muted-foreground text-[11px]">
                  Performed By
                </th>
                <th className="text-left px-5 py-4 font-semibold uppercase tracking-widest text-muted-foreground text-[11px]">
                  Details
                </th>
                <th className="text-left px-5 py-4 font-semibold uppercase tracking-widest text-muted-foreground text-[11px]">
                  IP Address
                </th>
                <th className="text-left px-5 py-4 font-semibold uppercase tracking-widest text-muted-foreground text-[11px]">
                  Time
                </th>
              </tr>
            </thead>
            <tbody>
              {logs.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-5 py-12 text-center text-muted-foreground text-[14px]"
                  >
                    No audit logs found matching your criteria.
                  </td>
                </tr>
              ) : (
                logs.map((log) => {
                  const action = formatAction(log.action);
                  const userDisplay = getUserDisplay(log.userId);
                  const actorDisplay = getUserDisplay(log.actor);
                  const isUserAction =
                    !log.actor &&
                    Boolean(log.userId) &&
                    USER_ACTIONS_WITHOUT_ACTOR.has(log.action);
                  const actedViaImpersonation =
                    Boolean(log.metadata) &&
                    typeof log.metadata === 'object' &&
                    (log.metadata as Record<string, unknown>)
                      .performedViaImpersonation === true;
                  const primaryIp = getPrimaryIp(log.ipAddress);
                  const metadataText = formatMetadata(log.metadata, userMap);

                  return (
                    <tr
                      key={log.id}
                      className="border-b border-border/30 last:border-0 hover:bg-muted/30 transition-colors"
                    >
                      <td className="px-5 py-3.5">
                        <div
                          className={`inline-flex items-center gap-1.5 font-medium px-2 py-1 rounded-md bg-secondary ${action.color}`}
                        >
                          <span>{action.emoji}</span>
                          <span className="text-[12px]">{action.label}</span>
                        </div>
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex flex-col">
                          <span
                            className={`text-[13px] font-medium ${
                              userDisplay?.isPartial
                                ? 'text-amber-500'
                                : 'text-foreground'
                            }`}
                          >
                            {userDisplay?.name ?? '—'}
                          </span>
                          {userDisplay?.email && (
                            <span className="text-[12px] text-muted-foreground">
                              {userDisplay.email}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-5 py-3.5">
                        {log.actor && actorDisplay ? (
                          <div className="flex flex-col gap-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span
                                className={`text-[13px] font-medium ${
                                  actorDisplay.isPartial
                                    ? 'text-amber-500'
                                    : 'text-foreground'
                                }`}
                              >
                                {actorDisplay.name}
                              </span>
                              {actedViaImpersonation && (
                                <span className="text-[11px] font-medium text-amber-500/90 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
                                  Impersonated
                                </span>
                              )}
                            </div>
                            {actorDisplay.email && (
                              <span className="text-[12px] text-muted-foreground">
                                {actorDisplay.email}
                              </span>
                            )}
                          </div>
                        ) : isUserAction ? (
                          <span className="text-[12px] font-medium text-emerald-500/90 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                            Self
                          </span>
                        ) : (
                          <span className="text-[13px] text-muted-foreground">
                            —
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3.5">
                        {metadataText ? (
                          <span
                            title={metadataText}
                            className="text-[12px] text-muted-foreground font-mono bg-muted/50 px-2 py-1 rounded break-words line-clamp-2"
                          >
                            {metadataText}
                          </span>
                        ) : (
                          <span className="text-[13px] text-muted-foreground">
                            —
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3.5 text-[12px] text-muted-foreground font-mono">
                        {primaryIp ?? '—'}
                      </td>
                      <td className="px-5 py-3.5 text-[12px] text-muted-foreground whitespace-nowrap">
                        {formatDistanceToNow(new Date(log.createdAt), {
                          addSuffix: true,
                        })}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="border-t border-border/50 bg-muted/10 px-5 py-3 flex flex-col sm:flex-row items-center justify-between gap-3">
          <span className="text-[13px] text-muted-foreground">
            Showing{' '}
            <span className="font-medium text-foreground">
              {total === 0 ? 0 : skip + 1}
            </span>{' '}
            to{' '}
            <span className="font-medium text-foreground">
              {Math.min(skip + take, total)}
            </span>{' '}
            of <span className="font-medium text-foreground">{total}</span>{' '}
            entries
          </span>
          {totalPages > 1 && (
            <div className="flex items-center gap-2">
              <a
                href={`?q=${encodeURIComponent(q)}&action=${encodeURIComponent(filterAction)}&page=${Math.max(1, currentPage - 1)}`}
                className={`px-3 py-1.5 text-[13px] font-medium rounded-lg border ${
                  currentPage <= 1
                    ? 'border-border/30 text-muted-foreground/50 pointer-events-none'
                    : 'border-border/60 text-foreground hover:bg-background transition-colors'
                }`}
                aria-disabled={currentPage <= 1}
                tabIndex={currentPage <= 1 ? -1 : undefined}
              >
                Previous
              </a>
              <span className="text-[13px] font-medium px-2">
                {currentPage} / {totalPages}
              </span>
              <a
                href={`?q=${encodeURIComponent(q)}&action=${encodeURIComponent(filterAction)}&page=${Math.min(totalPages, currentPage + 1)}`}
                className={`px-3 py-1.5 text-[13px] font-medium rounded-lg border ${
                  currentPage >= totalPages
                    ? 'border-border/30 text-muted-foreground/50 pointer-events-none'
                    : 'border-border/60 text-foreground hover:bg-background transition-colors'
                }`}
                aria-disabled={currentPage >= totalPages}
                tabIndex={currentPage >= totalPages ? -1 : undefined}
              >
                Next
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
