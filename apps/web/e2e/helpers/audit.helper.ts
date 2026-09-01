import { query } from './database.helper';

export interface AuditRow {
  id: string;
  userId: string | null;
  action: string;
  actor: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}

export async function findAuditLogs(opts: {
  action?: string;
  userId?: string;
  actor?: string;
  limit?: number;
} = {}): Promise<AuditRow[]> {
  const clauses: string[] = [];
  const params: unknown[] = [];
  let i = 1;
  if (opts.action) {
    clauses.push(`LOWER("action") = LOWER($${i++})`);
    params.push(opts.action);
  }
  if (opts.userId) {
    clauses.push(`"userId" = $${i++}`);
    params.push(opts.userId);
  }
  if (opts.actor) {
    clauses.push(`"actor" = $${i++}`);
    params.push(opts.actor);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const limit = opts.limit ?? 50;
  return query<AuditRow>(
    `SELECT * FROM "audit_log" ${where} ORDER BY "createdAt" DESC LIMIT ${limit}`,
    params,
  );
}

export async function latestAuditLog(
  action: string,
  opts: { userId?: string; actor?: string } = {},
): Promise<AuditRow | null> {
  const rows = await findAuditLogs({ action, ...opts, limit: 1 });
  return rows[0] ?? null;
}

export async function countAuditLogs(action: string): Promise<number> {
  const rows = await query<{ c: number }>(
    `SELECT COUNT(*)::int AS c FROM "audit_log" WHERE "action" = $1`,
    [action],
  );
  return rows[0]?.c ?? 0;
}
