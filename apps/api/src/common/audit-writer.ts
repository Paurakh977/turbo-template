import { db } from '@repo/database';

import type { ServerSession } from './session.utils';
import { getImpersonatedBy } from './session.utils';
import { sanitizeAuditMetadata } from './audit-metadata';

/**
 * The single audit-row writer for rows attributed to an HTTP session (web
 * actions via AuditService, note mutations via NotesService).
 *
 * - userId is ALWAYS derived from the session; clients can never attribute
 *   rows to someone else.
 * - Client-supplied metadata is sanitized BEFORE the server merges its own
 *   impersonation markers, so `performedViaImpersonation` / `impersonatedBy`
 *   can never be forged (listForAdmin renders impersonatedBy as an identity).
 * - Failures are swallowed into server logs: audit is best-effort-blocking,
 *   never a mutation's failure point.
 */
export async function writeAuditRow(
  session: ServerSession,
  input: { action: string; metadata?: Record<string, unknown> },
  meta: { ip: string | null; userAgent: string | null },
): Promise<void> {
  const impersonatedBy = getImpersonatedBy(session);
  const safeMetadata = sanitizeAuditMetadata(input.metadata);

  // Prisma's generated JSON input type is stricter than our metadata shape;
  // the payload is plain JSON-safe values by construction.
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
              ...(safeMetadata ?? {}),
              performedViaImpersonation: true,
              impersonatedBy,
            }
          : safeMetadata) as AuditCreateData extends { metadata?: infer M }
        ? M
        : never,
      },
    });
  } catch (error) {
    console.error(`[AuditLog] ${input.action} failed:`, error);
  }
}
