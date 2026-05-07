import { db } from '@repo/database';
import { requireAdmin } from '../../../lib/require-admin';
import { formatDistanceToNow } from 'date-fns';

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
  sessions_revoked: {
    emoji: '🔒',
    label: 'Sessions revoked',
    color: 'text-red-400',
  },
  session_revoked: {
    emoji: '🔒',
    label: 'Session revoked',
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

  return entries
    .map(([key, value]) => {
      if (key === 'from' || key === 'to')
        return `${key === 'from' ? 'from' : 'to'} ${value}`;
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
]);

export default async function AuditLogPage() {
  await requireAdmin();

  const logs = await db.auditLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: 200,
  });

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

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight">Audit Log</h1>
        <p className="text-muted-foreground text-sm mt-1">Last 200 events</p>
      </div>

      <div className="rounded-2xl border border-border/50 bg-card/60 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border/50 bg-muted/30">
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                Event
              </th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                Affected User
              </th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                Performed By
              </th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                Details
              </th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                IP
              </th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                When
              </th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => {
              const action = formatAction(log.action);
              const userDisplay = getUserDisplay(log.userId);
              const actorDisplay = getUserDisplay(log.actor);
              const isUserAction =
                !log.actor && USER_ACTIONS_WITHOUT_ACTOR.has(log.action);

              return (
                <tr
                  key={log.id}
                  className="border-b border-border/30 last:border-0 hover:bg-muted/20"
                >
                  <td className="px-4 py-3">
                    <span className={`font-medium ${action.color}`}>
                      {action.emoji} {action.label}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col">
                      <span
                        className={`text-xs ${
                          userDisplay?.isPartial
                            ? 'text-amber-500'
                            : 'text-foreground'
                        }`}
                      >
                        {userDisplay?.name ?? '—'}
                      </span>
                      {userDisplay?.email && (
                        <span className="text-xs text-muted-foreground">
                          {userDisplay.email}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {log.actor && actorDisplay ? (
                      <div className="flex flex-col">
                        <span className="text-xs text-foreground">
                          {actorDisplay.name}
                        </span>
                        {actorDisplay.email && (
                          <span className="text-xs text-muted-foreground">
                            {actorDisplay.email}
                          </span>
                        )}
                      </div>
                    ) : isUserAction ? (
                      <span className="text-xs text-green-500">
                        (the user themselves)
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {log.metadata && (
                      <span className="text-xs text-muted-foreground font-mono">
                        {formatMetadata(log.metadata)}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {log.ipAddress ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {formatDistanceToNow(new Date(log.createdAt), {
                      addSuffix: true,
                    })}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
