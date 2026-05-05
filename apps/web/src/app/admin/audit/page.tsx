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
      if (key === 'from' || key === 'to') return `from ${value} → to ${value}`;
      if (key === 'reason') return `reason: ${value}`;
      if (key === 'oldEmail') return `old: ${value}`;
      if (key === 'email') return `email: ${value}`;
      if (key === 'name') return `name: ${value}`;
      return `${key}: ${value}`;
    })
    .join(', ');
}

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

  const getUserInfo = (id: string | null) => {
    if (!id) return null;
    const user = userMap.get(id);
    if (!user) return id.slice(0, 8);
    return user.name || user.email || id.slice(0, 8);
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
                User
              </th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                Actor
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
                    <span className="text-xs text-foreground">
                      {getUserInfo(log.userId)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {log.actor ? (
                      <span className="text-xs text-muted-foreground">
                        by {getUserInfo(log.actor)}
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
