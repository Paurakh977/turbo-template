import 'server-only';

import { headers } from 'next/headers';
import { callInternalApi } from './server/internal-api';

type AuditMetadata = Record<string, unknown>;

type CreateServerAuditLogArgs = {
  action: string;
  metadata?: AuditMetadata;
  requestHeaders?: Headers;
};

/**
 * Architecture B: audit rows are written BY THE API TIER. This forwards the
 * event over HTTP; userId, actor, and impersonation enrichment are derived
 * server-side from the forwarded session cookie - a caller can never
 * attribute rows to someone else, so no identity hints are sent.
 */
export async function createServerAuditLog({
  action,
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
        body: { action, metadata: metadata ?? {} },
      },
    );
  } catch (error) {
    console.error(`[AuditLog] ${action} failed:`, error);
  }
}
