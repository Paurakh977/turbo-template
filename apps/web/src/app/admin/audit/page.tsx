import { db } from '@repo/database';
import { requireAdmin } from '../../../lib/require-admin';
import { formatDistanceToNow } from 'date-fns'; // install if needed

export const dynamic = 'force-dynamic';

const ACTION_LABELS: Record<string, string> = {
  user_signed_up: '🆕 Signed up',
  session_created: '🔑 Signed in',
  role_changed: '🎭 Role changed',
  user_banned: '🚫 Banned',
  user_unbanned: '✅ Unbanned',
  user_impersonated: '👤 Impersonated',
  email_changed: '📧 Email changed',
};

export default async function AuditLogPage() {
  await requireAdmin();

  const logs = await db.auditLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: 200,
    include: {
      // If you want to join user names, add a relation — for now, just IDs
    },
  });

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
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Event</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">User</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">IP</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">When</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => (
              <tr key={log.id} className="border-b border-border/30 last:border-0 hover:bg-muted/20">
                <td className="px-4 py-3">
                  <div className="font-medium">{ACTION_LABELS[log.action] ?? log.action}</div>
                  {log.metadata && (
                    <div className="text-xs text-muted-foreground font-mono mt-0.5">
                      {JSON.stringify(log.metadata)}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                  {log.userId?.slice(0, 12)}…
                  {log.actor && <div>by {log.actor.slice(0, 12)}…</div>}
                </td>
                <td className="px-4 py-3 text-xs text-muted-foreground">{log.ipAddress ?? '—'}</td>
                <td className="px-4 py-3 text-xs text-muted-foreground">
                  {formatDistanceToNow(new Date(log.createdAt), { addSuffix: true })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}