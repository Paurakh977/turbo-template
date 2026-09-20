import { db } from '@repo/database';
import { createLogger } from '@repo/observability';

import type { ServerSession } from './session.utils';
import { getImpersonatedBy } from './session.utils';
import { sanitizeAuditMetadata } from './audit-metadata';

const logger = createLogger('api.audit');

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
 *
 * Sync vs background split:
 * - SYNCHRONOUS (awaited): security-critical events — role_changed,
 *   user_banned/unbanned, sessions_revoked, user_deleted, impersonation
 *   start/stop. These stay inline for cause→effect ordering in the same
 *   request; they are rare (rate-limited to single digits/min) so the extra
 *   RTT is negligible. They live in the auth tier (audit-plugin.ts,
 *   database-hooks.ts) which has no access to the Nest queue — `writeAuditRow`
 *   below remains their path.
 * - BACKGROUND (AuditQueueService, transactional outbox):
 *   note_created/updated/deleted, profile_updated, theme_changed,
 *   labs_toggled — high-volume domain/UX events with no privilege change.
 *   Enqueue INSERTs a durable audit_outbox row (same-transaction as the
 *   note mutation where the caller passes tx); a 250ms SKIP LOCKED poller
 *   delivers to audit_log with retry + DLQ. kill -9 safe: committed rows
 *   are redelivered after restart; uncommitted rows roll back with the
 *   mutation (client retries, idempotency key dedupes).
 */

// Prisma's generated JSON input type is stricter than our metadata shape;
// the payload is plain JSON-safe values by construction.
export type AuditRowData = NonNullable<
  Parameters<typeof db.auditLog.create>[0]
>['data'];

export type AuditRowInput = {
  action: string;
  metadata?: Record<string, unknown>;
};

export type AuditClientMeta = {
  ip: string | null;
  userAgent: string | null;
};

/**
 * Pure builder: resolves attribution + sanitization + impersonation markers
 * synchronously at emit time. The background queue stores THIS (plain data),
 * never the session object — so actor/userId/ip can never shift between
 * enqueue and insert, and nothing holds request-scoped references.
 */
export function buildAuditRowData(
  session: ServerSession,
  input: AuditRowInput,
  meta: AuditClientMeta,
): AuditRowData {
  const impersonatedBy = getImpersonatedBy(session);
  const safeMetadata = sanitizeAuditMetadata(input.metadata);

  return {
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
      : safeMetadata) as AuditRowData extends { metadata?: infer M }
      ? M
      : never,
  };
}

/**
 * Single INSERT. THROWS on failure — the background queue relies on this for
 * retry accounting. Sync callers must use `writeAuditRow` (swallowed) instead.
 */
export async function persistAuditRowData(data: AuditRowData): Promise<void> {
  await db.auditLog.create({ data });
}

export async function writeAuditRow(
  session: ServerSession,
  input: AuditRowInput,
  meta: AuditClientMeta,
): Promise<void> {
  try {
    await persistAuditRowData(buildAuditRowData(session, input, meta));
  } catch (error) {
    logger.error({ action: input.action, err: error }, 'Audit log write failed');
  }
}
