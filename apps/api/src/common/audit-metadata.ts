/**
 * Metadata keys the SERVER owns in audit rows. `listForAdmin` renders
 * `metadata.impersonatedBy` as a resolved identity ("performed via
 * impersonation by <admin>"), so client-supplied metadata must never be able
 * to set these — otherwise any authenticated user could fabricate
 * impersonation trails attributed to arbitrary admins via POST /api/audit-logs.
 *
 * Server writers always set these keys AFTER sanitization, so the server's
 * values win by construction.
 */
const SERVER_OWNED_METADATA_KEYS = [
  'performedViaImpersonation',
  'impersonatedBy',
] as const;

export function sanitizeAuditMetadata(
  metadata?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (!metadata) return undefined;
  const clean = { ...metadata };
  for (const key of SERVER_OWNED_METADATA_KEYS) {
    delete clean[key];
  }
  return clean;
}
