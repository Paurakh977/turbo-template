import 'server-only';

import { headers } from 'next/headers';
import { callInternalApi } from './server/internal-api';

type SessionLike = {
  user: { id: string };
  session?: { impersonatedBy?: string | null };
};

type AuditMetadata = Record<string, unknown>;

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

/**
 * Effective actor for permission decisions: while impersonating, decisions
 * and audit attribution belong to the acting admin.
 */
export function getEffectivePermissionUserId(session: SessionLike): string {
  return resolveImpersonatingAdminId(session) ?? session.user.id;
}

/**
 * Architecture B: audit rows are written BY THE API TIER. This forwards the
 * event over HTTP; userId is derived server-side from the forwarded session
 * cookie, so a caller can never attribute rows to someone else. The local
 * `userId`/`actor` arguments remain in the signature for call-site
 * compatibility but are treated as hints only - the API's values win.
 */
export async function createServerAuditLog({
  action,
  session,
  metadata,
  requestHeaders,
}: CreateServerAuditLogArgs): Promise<void> {
  try {
    const h = requestHeaders ?? (await headers());
    await callInternalApi(
      '/api/audit-logs',
      {
        method: 'POST',
        requestHeaders: h,
        body: {
          action,
          // Free-form context travels as metadata; the API enriches it with
          // impersonation + IP/UA from the forwarded request and derives
          // userId from the session (never from the payload).
          metadata: {
            ...(metadata ?? {}),
            hintUserId: session?.user.id,
            hintActor: resolveImpersonatingAdminId(session),
          },
        },
      },
    );
  } catch (error) {
    console.error(`[AuditLog] ${action} failed:`, error);
  }
}
