import { Injectable, ForbiddenException, Optional } from '@nestjs/common';
import { db } from '@repo/database';
import { withSpan, AppAttributes } from '@repo/observability';

import type { ServerSession } from '../common/session.utils';
import { getEffectiveUserId, hasAdminRole } from '../common/session.utils';
import { writeAuditRow } from '../common/audit-writer';
import { AuditQueueService } from '../common/audit-queue.service';
import { AuthorizationService } from '../common/authorization.service';

const PAGE_SIZE = 50;
const USER_SEARCH_TAKE = 300;

// UUID/cuid2/nanoid pattern — used to split exact-ID lookups
// from fuzzy email/name searches. Exact match is an O(1) index scan; fuzzy
// match requires a sequential scan on the user table, so we avoid it when
// the query is already a bare ID.
// Pattern: 20+ alphanumeric + hyphen/underscore characters.
const ID_PATTERN = /^[A-Za-z0-9_-]{20,}$/;

type AuditLogRow = {
  id: string;
  userId: string | null;
  action: string;
  actor: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  metadata: unknown;
  createdAt: string;
};

type AuditLogPage = {
  logs: AuditLogRow[];
  total: number;
  page: number;
  totalPages: number;
  /** id → display name/email for actors/targets referenced on this page */
  usersById: Record<string, { id: string; name: string | null; email: string }>;
};

type AuditLogRecord = Awaited<
  ReturnType<typeof db.auditLog.findMany>
>[number];

type AuditLogWhere = NonNullable<
  Parameters<typeof db.auditLog.findMany>[0]
>['where'];

function serializeLog(row: AuditLogRecord): AuditLogRow {
  return {
    id: row.id,
    userId: row.userId,
    action: row.action,
    actor: row.actor,
    ipAddress: row.ipAddress,
    userAgent: row.userAgent,
    metadata: row.metadata,
    createdAt: row.createdAt.toISOString(),
  };
}

@Injectable()
export class AuditService {
  constructor(
    private readonly authz: AuthorizationService,
    // @Optional: same seam as NotesService — unit tests construct directly
    // and keep the synchronous path; production always injects the queue.
    @Optional() private readonly auditQueue?: AuditQueueService,
  ) {}

  /**
   * Server-side write used by web actions that perform auth operations
   * remotely (profile updates, password-reset requests, theme/labs toggles).
   * userId is ALWAYS derived from the session - the client cannot attribute
   * audit rows to someone else. Impersonation enrichment mirrors the
   * Better Auth database hooks.
   *
   * BACKGROUND write: the endpoint allowlist
   * (CLIENT_AUDIT_ACTIONS) admits only non-security UX events, so the queue
   * is safe here — ordering + retry preserved, response no longer waits for
   * the INSERT.
   */
  async recordFromSession(
    session: ServerSession,
    input: { action: string; metadata?: Record<string, unknown> },
    meta: { ip: string | null; userAgent: string | null },
  ): Promise<void> {
    return withSpan('audit.record', async (span) => {
      span.setAttribute(AppAttributes.OPERATION, 'audit.record');
      span.setAttribute(AppAttributes.FEATURE, 'audit');
      span.setAttribute('audit.action', input.action);
      if (this.auditQueue) {
        await this.auditQueue.enqueueSessionAudit(session, input, meta);
        return;
      }
      await writeAuditRow(session, input, meta);
    });
  }

  /**
   * Admin listing — optimizations:
   *
   * 1. Atomic snapshot: count + findMany run inside a single $transaction so
   *    a concurrent INSERT between the two queries cannot shift rows across
   *    pages or produce an inconsistent total.
   *
   * 2. Stable pagination: orderBy [{ createdAt: 'desc' }, { id: 'desc' }]
   *    adds a deterministic tie-breaker preventing non-deterministic page
   *    windows when multiple rows share the same timestamp.
   *    The composite index (createdAt DESC, id DESC) covers both columns.
   *
   * 3. Empty-array guard: skip user.findMany when the page has no referenced
   *    user IDs — avoids an unnecessary round-trip for system-only rows.
   *
   * 4. Search split: UUID/cuid/nanoid-shaped queries use exact-match only
   *    (O(1) indexed scan). Non-ID queries (email fragment, name) use ILIKE
   *    against the user table. This avoids a full user-table scan when the
   *    caller is searching by a known ID.
   */
  async listForAdmin(
    session: ServerSession,
    params: { q?: string; action?: string; page?: number },
  ): Promise<AuditLogPage> {
    return withSpan('audit.list', async (span) => {
      span.setAttribute(AppAttributes.OPERATION, 'audit.list');
      span.setAttribute(AppAttributes.FEATURE, 'audit');

      await this.assertAdmin(session);

      const take = PAGE_SIZE;
      const requestedPage = Math.max(1, params.page ?? 1);
      const where: AuditLogWhere = {};

      if (params.action && params.action !== 'all') {
        where.action = params.action;
      }

      if (params.q) {
        const q = params.q;
        const isIdShaped = ID_PATTERN.test(q);

        let matchedIds: string[] = [];
        if (!isIdShaped) {
          // Fuzzy: email/name ILIKE search → collect matching user IDs.
          const matchingUsers = await db.user.findMany({
            where: {
              OR: [
                { email: { contains: q, mode: 'insensitive' } },
                { name: { contains: q, mode: 'insensitive' } },
              ],
            },
            select: { id: true },
            take: USER_SEARCH_TAKE,
          });
          matchedIds = [...new Set(matchingUsers.map((u) => u.id))];
        }

        // Always include exact userId/actor match so ID-shaped searches
        // work without the user-table scan.
        const orClauses: NonNullable<AuditLogWhere>['OR'] = [
          { userId: q },
          { actor: q },
        ];
        if (matchedIds.length > 0) {
          orClauses.push({ userId: { in: matchedIds } });
          orClauses.push({ actor: { in: matchedIds } });
        }
        where.OR = orClauses;
      }

      // Atomic count + findMany in a single $transaction snapshot.
      // We pre-compute a provisional skip using the requested page. If the
      // page is out of range (requestedPage > totalPages), we clamp to the
      // last page AFTER reading the count — no second DB round-trip needed.
      const provisionalSkip = (requestedPage - 1) * take;

      const [total, provisionalLogs] = await db.$transaction([
        db.auditLog.count({ where }),
        db.auditLog.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take,
          skip: provisionalSkip,
        }),
      ]);

      const totalPages = Math.ceil(total / take) || 1;
      const currentPage = Math.min(requestedPage, totalPages);
      const correctSkip = (currentPage - 1) * take;

      // If the clamped skip differs from what we already fetched, re-fetch the
      // correct page. This only fires when requestedPage > totalPages (a
      // stale browser link after rows are deleted) — the common path (page 1
      // or any in-range page) never incurs the second query.
      const logs =
        correctSkip === provisionalSkip
          ? provisionalLogs
          : await db.auditLog.findMany({
              where,
              orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
              take,
              skip: correctSkip,
            });

      // Resolve display identities for every user referenced directly or via
      // impersonation metadata (same enrichment as the old page).
      const metadataImpersonators = logs
        .filter(
          (l): l is (typeof l) & { metadata: Record<string, unknown> } =>
            Boolean(l.metadata) && typeof l.metadata === 'object',
        )
        .map((l) => l.metadata.impersonatedBy)
        .filter((v): v is string => typeof v === 'string');

      const userIds = [
        ...new Set(
          logs
            .flatMap((l) => [l.userId, l.actor])
            .concat(metadataImpersonators)
            .filter((v): v is string => Boolean(v)),
        ),
      ];

      // Empty-array guard — skip user.findMany when no user IDs
      // appear on the current page (system-generated rows, empty page, etc.).
      const users =
        userIds.length > 0
          ? await db.user.findMany({
              where: { id: { in: userIds } },
              select: { id: true, name: true, email: true },
            })
          : [];

      return {
        logs: logs.map(serializeLog),
        total,
        page: currentPage,
        totalPages,
        usersById: Object.fromEntries(users.map((u) => [u.id, u])),
      };
    });
  }

  private async assertAdmin(session: ServerSession): Promise<void> {
    const effectiveId = getEffectiveUserId(session);
    // One authoritative read via the shared service — same freshness
    // guarantee, no duplicated role logic.
    const roleRaw = await this.authz.getFreshRoleRaw(effectiveId);
    // Deny-by-default: a missing row (user hard-deleted while a Redis-backed
    // session is still live) returns 'user' and must NEVER degrade to the
    // possibly-elevated role snapshot carried inside the session token.
    if (!hasAdminRole(roleRaw)) {
      throw new ForbiddenException('Admin role required.');
    }
  }
}
