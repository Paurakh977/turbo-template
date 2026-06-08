import 'server-only';

import { headers } from 'next/headers';
import { db } from '@repo/database';

type SessionLike = {
  user: { id: string };
  session?: { impersonatedBy?: string | null };
};

type JsonValue = string | number | boolean | null;

type AuditMetadata = Record<
  string,
  JsonValue | JsonValue[] | Record<string, JsonValue>
>;

type CreateServerAuditLogArgs = {
  userId: string;
  action: string;
  session?: SessionLike;
  actor?: string | null;
  metadata?: AuditMetadata;
  requestHeaders?: Headers;
};

function resolveImpersonatingAdminId(session?: SessionLike): string | null {
  return session?.session?.impersonatedBy ?? null;
}

function resolveClientIp(h: Headers): string | null {
  const forwardedFor = h.get('x-forwarded-for');
  if (forwardedFor) {
    const first = forwardedFor
      .split(',')
      .map((part) => part.trim())
      .find(Boolean);
    if (first) return first;
  }
  return h.get('x-real-ip') ?? null;
}

export function getEffectivePermissionUserId(session: SessionLike): string {
  return resolveImpersonatingAdminId(session) ?? session.user.id;
}

export async function createServerAuditLog({
  userId,
  action,
  session,
  actor,
  metadata,
  requestHeaders,
}: CreateServerAuditLogArgs): Promise<void> {
  try {
    const h = requestHeaders ?? (await headers());
    const impersonatedBy = resolveImpersonatingAdminId(session);
    const resolvedActor = actor ?? impersonatedBy ?? null;

    const enrichedMetadata: AuditMetadata | undefined = impersonatedBy
      ? {
          ...(metadata ?? {}),
          performedViaImpersonation: true,
          impersonatedBy,
        }
      : metadata;

    await db.auditLog.create({
      data: {
        userId,
        action,
        actor: resolvedActor ?? undefined,
        ipAddress: resolveClientIp(h),
        userAgent: h.get('user-agent') ?? null,
        metadata: enrichedMetadata,
      },
    });
  } catch (error) {
    console.error(`[AuditLog] ${action} failed:`, error);
  }
}
