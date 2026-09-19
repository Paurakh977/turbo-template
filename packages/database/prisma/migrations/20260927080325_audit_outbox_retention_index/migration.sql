-- Retention purge partial index for audit_outbox (DONE rows by updated_at).
-- The purge SELECT (status = 'DONE' AND updated_at < cutoff ORDER BY
-- updated_at, id LIMIT 1000) is an index-only scan on this partial index no
-- matter how large the PENDING backlog grows. Plain DDL is transactional
-- inside migrate deploy; IF NOT EXISTS keeps partial deploys re-runnable.
-- Prisma @@index cannot express partial predicates, so this lives in SQL
-- only (see the matching comment on AuditOutbox in auditOutbox.prisma).

CREATE INDEX IF NOT EXISTS "audit_outbox_done_updated_idx"
  ON "audit_outbox"("updated_at" ASC, "id" ASC)
  WHERE "status" = 'DONE';
