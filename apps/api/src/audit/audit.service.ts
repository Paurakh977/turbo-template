import { Injectable, ForbiddenException } from '@nestjs/common';
import { db } from '@repo/database';

import type { ServerSession } from '../common/session.utils';
import { getEffectiveUserId, getSessionRoleRaw, hasAdminRole } from '../common/session.utils';

const PAGE_SIZE = 50;
const USER_SEARCH_TAKE = 300;

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
  /** id -> display name/email for actors/targets referenced on this page */
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
  /**
   * Server-side write used by web actions that perform auth operations
   * remotely (profile updates, password-reset requests, theme/labs toggles).
   * userId is ALWAYS derived from the session - the client cannot attribute
   * audit rows to someone else. Impersonation enrichment mirrors the
   * Better Auth database hooks.
   */
  async recordFromSession(
    session: ServerSession,
    input: { action: string; metadata?: Record<string, unknown> },
    meta: { ip: string | null; userAgent: string | null },
  ): Promise<void> {
    const impersonatedBy = getImpersonatedBy(session);

    type AuditCreateData = NonNullable<
      Parameters<typeof db.auditLog.create>[0]
    >['data'];

    try {
      await db.auditLog.create({
        data: {
          userId: session.user.id,
          action: input.action,
          actor: impersonatedBy ?? undefined,
          ipAddress: meta.ip,
          userAgent: meta.userAgent,
          metadata: (impersonatedBy
            ? {
                ...(input.metadata ?? {}),
                performedViaImpersonation: true,
                impersonatedBy,
              }
            : input.metadata) as AuditCreateData extends { metadata?: infer M }
            ? M
            : never,
        },
      });
    } catch (error) {
      console.error(`[AuditLog] ${input.action} failed:`, error);
    }
  }

  /**
   * Admin listing - semantics mirrored 1:1 from the previous web-tier page
   * (user search take-300, OR clauses over userId/actor/id, 50/page).
   */
  async listForAdmin(
    session: ServerSession,
    params: { q?: string; action?: string; page?: number },
  ): Promise<AuditLogPage> {
    await this.assertAdmin(session);

    const take = PAGE_SIZE;
    const where: AuditLogWhere = {};

    if (params.action && params.action !== 'all') {
      where.action = params.action;
    }

    if (params.q) {
      const matchingUsers = await db.user.findMany({
        where: {
          OR: [
            { email: { contains: params.q, mode: 'insensitive' } },
            { name: { contains: params.q, mode: 'insensitive' } },
            { id: params.q },
          ],
        },
        select: { id: true },
        take: USER_SEARCH_TAKE,
      });
      const matchedIds = [...new Set(matchingUsers.map((u) => u.id))];

      const orClauses: NonNullable<AuditLogWhere>['OR'] = [
        { userId: params.q },
        { actor: params.q },
      ];
      if (matchedIds.length > 0) {
        orClauses.push({ userId: { in: matchedIds } });
        orClauses.push({ actor: { in: matchedIds } });
      }
      where.OR = orClauses;
    }

    const total = await db.auditLog.count({ where });
    const totalPages = Math.ceil(total / take);
    const currentPage =
      totalPages > 0 ? Math.min(Math.max(1, params.page ?? 1), totalPages) : 1;

    const logs = await db.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take,
      skip: (currentPage - 1) * take,
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

    const users = await db.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true, email: true },
    });

    return {
      logs: logs.map(serializeLog),
      total,
      page: currentPage,
      totalPages,
      usersById: Object.fromEntries(users.map((u) => [u.id, u])),
    };
  }

  private async assertAdmin(session: ServerSession): Promise<void> {
    const effectiveId = getEffectiveUserId(session);
    const user = await db.user.findUnique({
      where: { id: effectiveId },
      select: { role: true },
    });
    const roleRaw = getSessionRoleRaw({
      ...session,
      user: { ...session.user, role: (user?.role as string) ?? getSessionRoleRaw(session) },
    } as ServerSession);
    if (!hasAdminRole(roleRaw)) {
      throw new ForbiddenException('Admin role required.');
    }
  }
}

function getImpersonatedBy(session: ServerSession): string | null {
  return (
    (session as { session?: { impersonatedBy?: string | null } }).session
      ?.impersonatedBy ?? null
  );
}
