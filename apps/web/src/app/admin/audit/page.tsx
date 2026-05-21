import { db } from '@repo/database';
import { requireAdmin } from '../../../lib/require-admin';
import { formatDistanceToNow } from 'date-fns';
import { THEME_GRANT_NAME, LABS_GRANT_NAME } from '@repo/auth/permissions';
import { parseRoles } from '@repo/auth/roles';
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

function formatAction(action: string) {
  const config = ACTION_CONFIG[action];
  if (!config)
    return { label: action, emoji: '📝', color: 'text-muted-foreground' };
  return config;
}

function formatMetadata(metadata: unknown) {
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

  return entries
    .map(([key, value]) => {
      if (key === 'from' || key === 'to')
        return `${key === 'from' ? 'from' : 'to'} ${formatRoleList(value)}`;
      if (key === 'reason') return `reason: ${value}`;
      if (key === 'oldEmail') return `old: ${value}`;
      if (key === 'email') return `email: ${value}`;
      if (key === 'name') return `name: ${value}`;
      return `${key}: ${value}`;
    })
    .join(', ');
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
  const page = Math.max(1, Number(searchParams.page) || 1);
  const q = typeof searchParams.q === 'string' ? searchParams.q.trim() : '';
  const filterAction =
    typeof searchParams.action === 'string' ? searchParams.action : 'all';

  const take = 50;
  const skip = (page - 1) * take;

  const where: any = {};
  if (filterAction && filterAction !== 'all') {
    where.action = filterAction;
  }
  if (q) {
    const matchingUsers = await db.user.findMany({
      where: {
        OR: [
          { email: { contains: q, mode: 'insensitive' } },
          { name: { contains: q, mode: 'insensitive' } },
          { id: q },
        ],
      },
      select: { id: true },
    });
    const matchedIds = matchingUsers.map((u) => u.id);
    if (matchedIds.length > 0) {
      where.OR = [
        { userId: { in: matchedIds } },
        { actor: { in: matchedIds } },
      ];
    } else {
      where.id = 'none'; // force 0 results
    }
  }

  const [logs, total] = await Promise.all([
    db.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take,
      skip,
    }),
    db.auditLog.count({ where }),
  ]);

  const totalPages = Math.ceil(total / take);

  const userIds = [
    ...new Set(
      logs.flatMap((l) => [l.userId, l.actor].filter(Boolean) as string[]),
    ),
  ];

  const users =
    userIds.length > 0
      ? await db.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true, email: true },
        })
      : [];

  const userMap = new Map(users.map((u) => [u.id, u]));

  const getUserDisplay = (id: string | null) => {
    if (!id) return null;
    return formatUserDisplay(userMap.get(id) ?? undefined, id);
  };

  const allActions = Object.entries(ACTION_CONFIG).map(([key, cfg]) => ({
    key,
    label: cfg.label,
    emoji: cfg.emoji,
  }));

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
        actions={allActions}
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
                    !log.actor && USER_ACTIONS_WITHOUT_ACTOR.has(log.action);

                  return (
                    <tr
                      key={log.id}
                      className="border-b border-border/30 last:border-0 hover:bg-muted/30 transition-colors"
                    >
                      <td className="px-5 py-3.5">
                        <div
                          className={`inline-flex items-center gap-1.5 font-medium px-2 py-1 rounded-md bg-secondary text-foreground`}
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
                          <div className="flex flex-col">
                            <span className="text-[13px] font-medium text-foreground">
                              {actorDisplay.name}
                            </span>
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
                        {log.metadata ? (
                          <span className="text-[12px] text-muted-foreground font-mono bg-muted/50 px-2 py-1 rounded break-all line-clamp-2">
                            {formatMetadata(log.metadata)}
                          </span>
                        ) : (
                          <span className="text-[13px] text-muted-foreground">
                            —
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3.5 text-[12px] text-muted-foreground font-mono">
                        {log.ipAddress ?? '—'}
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
                href={`?q=${encodeURIComponent(q)}&action=${encodeURIComponent(filterAction)}&page=${Math.max(1, page - 1)}`}
                className={`px-3 py-1.5 text-[13px] font-medium rounded-lg border ${
                  page <= 1
                    ? 'border-border/30 text-muted-foreground/50 pointer-events-none'
                    : 'border-border/60 text-foreground hover:bg-background transition-colors'
                }`}
              >
                Previous
              </a>
              <span className="text-[13px] font-medium px-2">
                {page} / {totalPages}
              </span>
              <a
                href={`?q=${encodeURIComponent(q)}&action=${encodeURIComponent(filterAction)}&page=${Math.min(totalPages, page + 1)}`}
                className={`px-3 py-1.5 text-[13px] font-medium rounded-lg border ${
                  page >= totalPages
                    ? 'border-border/30 text-muted-foreground/50 pointer-events-none'
                    : 'border-border/60 text-foreground hover:bg-background transition-colors'
                }`}
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
