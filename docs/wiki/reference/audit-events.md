---
title: "Reference: Audit Events"
type: reference
status: stable
authority: derived
owners: ["subsystems/audit.md"]
sources: ["packages/auth/src/server/audit-plugin.ts", "packages/auth/src/server/database-hooks.ts", "apps/api/src/common/audit-queue.service.ts", "apps/api/src/common/audit-outbox.ts", "apps/api/src/common/audit-writer.ts", "apps/api/src/audit/audit.controller.ts"]
depends_on: ["invariants/05-audit-planes.md", "subsystems/audit.md", "flows/audit.md"]
guards: ["apps/api/test/integration/modules/audit-logging.integration.spec.ts", "apps/api/src/common/audit-outbox.spec.ts"]
updated: 2026-10-01
expires: null
superseded-by: null
template: true
---
# Reference: Audit Events
> Up: ../00-INDEX.md
| Event | Plane | Idempotency | Retention | Hook |
|---|---|---|---|---|
| user_signed_up, email_changed, account_deleted | sync auth | natural row, sync INSERT | audit_log persist | database-hooks.ts:76,131,176 |
| session_created, user_impersonated, user_signed_out | sync auth | natural row, sync INSERT | audit_log persist | database-hooks.ts:229-293 |
| user_stop_impersonating | sync auth | suppression flag pop | audit_log persist | audit-plugin.ts:701-730 + database-hooks.ts:254 |
| role_changed, user_banned, user_unbanned | sync auth | old-vs-fresh diff | audit_log persist | audit-plugin.ts:403-449,603-631 |
| sessions_revoked, session_revoked, user_deleted | sync auth | target id + span | audit_log persist | audit-plugin.ts:470-521 |
| user_impersonation_started, user_created, password_changed | sync auth | target id + span | audit_log persist | audit-plugin.ts:548-695 |
| user_ban_blocked, user_delete_blocked | sync guard-blocked | before-throw | audit_log persist | audit-plugin.ts:123-204 |
| note_created/updated/deleted et al (domain) | outbox PENDING>CLAIMED>DONE/DLQ | idempotency key P2002 silent | DONE 30d purge batch1000; PENDING/DLQ never purged | audit-queue.service.ts:82-123 + audit-outbox.ts:57-66 |
| profile_updated, theme_changed, labs_toggled | client HTTP>outbox | IsIn allowlist, 4KB meta cap | same outbox retention | audit.controller.ts:34-45 |
## Notes
- Fact: Auth plane = sync INSERT; domain/client plane = same-tx outbox (250ms poll, batch 50, 30s claim, 5 attempts).
- Fact: Purge deletes DONE-only older than 30d hourly; DLQ redrive is single-id UPDATE to PENDING, never auto.
- Fact: Client endpoint admits only 3 UX actions; system rows never arrive over HTTP (forgery allowlist).
- Fact: Outbox order is best-effort FIFO per batch; cross-instance global order is not guaranteed.
- Uncertainty: targetId populate-or-drop (Q6); overlong UA uncapped TEXT vs 4KB meta (Q7); DLQ no alert (Q9); createdAt delivery-vs-enqueue skew (Q10); maps TTL/sweep (Q8). See .agent/wiki-discovery/FINAL-10-OPEN-QUESTIONS.md.
