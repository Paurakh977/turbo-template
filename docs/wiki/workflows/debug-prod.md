---
title: "Workflow: Debug Production Audit and Health"
type: workflow
status: stable
authority: normative-procedure
owners: ["subsystems/audit.md"]
sources: ["apps/api/src/health/health.controller.ts", "apps/api/src/common/audit-queue.service.ts", "apps/api/src/common/audit-outbox.ts", "observability/alloy/config.alloy", "observability/prometheus/alerts/database.yml", "observability/grafana/dashboards/03-database-redis.json", "observability/grafana/dashboards/02-api-performance.json", "apps/api/src/cluster.ts"]
depends_on: ["invariants/05-audit-planes.md", "invariants/07-health.md", "invariants/08-observability.md", "flows/audit.md", "flows/observability.md"]
guards: ["apps/api/test/integration/modules/health.integration.spec.ts", "apps/api/src/common/observability/alert-rules.spec.ts", "apps/api/src/common/audit-queue.service.spec.ts"]
updated: 2026-10-01
expires: null
superseded-by: null
template: true
---
# Workflow: Debug Production Audit and Health
> Up: ../00-INDEX.md | Use when: prod triage for backlog, probes, pool, ELU, or DLQ signal. Route: T8.
## Purpose
- Fact: Triages live versus ready plus Alloy plus Grafana plus pool plus ELU with max-not-sum backlog math.
- Interpretation: Live answers process alive; ready answers dependency health; confusing them pages falsely.
- Recommendation: Check probes first, then backlog max, then pool plus ELU, then DLQ count, in that order.
## Preconditions
- [ ] Read `../00-INDEX.md` task row T8 and confirm Required order before diff.
- [ ] Read `../invariants/05-audit-planes.md` DLQ plus purge plus `07-health.md` live versus ready plus `08-observability.md`.
- [ ] Read `../flows/audit.md` claim plus deliver plus DLQ plus `../flows/observability.md` Alloy to backends.
- Fact: Summing backlog depth across workers multiplies the signal; alert on max, never sum.
## Steps checklist
- [ ] 1. Probe `GET /api/health/live` expects 200 dependency-free plus `GET /api/health/ready` may 503 with redacted logs.
- [ ] 2. Open Alloy plus Grafana logs plus traces plus metrics plus profiles for the incident window.
- [ ] 3. Check `AuditQueueBacklogHigh` max-not-sum in `database.yml:50-69` plus `application.yml:111`.
- [ ] 4. Check Grafana 03-db-redis backlog plus 02-api ELU above 0.8 plus delay gauges.
- [ ] 5. Check pool gauges `MAX_CLIENT` versus `workers x POOL` plus PgBouncer `MAX_CONN` headroom.
- [ ] 6. Run DLQ count `SELECT count(*) FROM audit_outbox WHERE status='DLQ'` before any redrive decision.
- [ ] 7. Confirm purge spares PENDING: DONE-only 30d hourly 1000 via PK delete.
- [ ] 8. Confirm drain 20s below grace 30s in compose plus `cluster.ts:152-164`.
- [ ] 9. Hand off to `redrive-dlq.md` only with single-id scope and admin gate, never auto.
## Commands
```sh
pnpm --filter api test:integration -- -t "health"
pnpm --filter api test:integration -- -t "alert-rules"
pnpm --filter api test:integration -- -t "purgeDoneBatch"
pnpm k6:smoke
```
- Fact: `health` proves live 200 plus ready 503 pair; `alert-rules` pins max-not-sum; `purgeDoneBatch` proves predicate.
- Fact: DLQ inspect uses SQL in `audit-outbox.ts:26-30`; never redrive from Grafana panel alone.
- Fact: DLQ SELECT canonical: `SELECT id,action,attempts,last_error FROM audit_outbox WHERE status='DLQ' ORDER BY created_at DESC LIMIT 50;`
## Files-areas
| Area | Paths |
|---|---|
| Probes | `apps/api/src/health/health.controller.ts:63-88` live versus ready |
| Queue | `audit-queue.service.ts:50-52` metrics plus `:419-449` purge plus outbox tuning |
| Alerts | `observability/prometheus/alerts/database.yml:50-69` max-not-sum |
| Pipeline | `observability/alloy/config.alloy` plus Grafana 02 plus 03 dashboards |
| Runtime | `apps/api/src/cluster.ts:21-52` workers plus `152-164` drain |
## Architectural gates
- Fact: Liveness stays dependency-free; readiness may report failure without killing the container.
- Fact: Backlog alert uses max-not-sum; depth gauge owned by refresh only, never zeroed on enqueue.
- Fact: Purge predicate DONE-only; PENDING plus CLAIMED plus DLQ never match.
- Fact: Never auto-redrive without admin gate; poison rows replay otherwise.
## Tests
- Fact: Required `health` live plus ready pair plus `alert-rules` max-not-sum plus `purgeDoneBatch` spares PENDING.
- Fact: Required DLQ SELECT count plus single-id dry-run before any UPDATE to PENDING.
- Fact: Recommended Grafana 03 plus 02 screenshots attached to incident note.
## Documentation updates
- Fact: Incident follow-up updates `subsystems/audit.md` plus `flows/audit.md` if tuning or predicate changed.
- Fact: Follow-up updates `reference/audit-events.md` retention note plus `ports-topology.md` health appendix.
- Fact: Bump `updated` plus run link lint; never paste PII or full metadata into docs.
## Verification
- [ ] Live 200 plus ready shape observed with throttled health path intact.
- [ ] Backlog max verified, not summed; ELU plus pool gauges recorded with worker count.
- [ ] DLQ count recorded; redrive decision logged with single-id scope or deferral reason.
- [ ] `git status --short` shows only runbook plus alert plus docs paths if fix landed.
## Failure-recovery
- Fact: False backlog page maps to recheck max versus sum plus worker count, then tune alert, not poller.
- Fact: Pool storm maps to lower `API_WORKERS` or raise `MAX_CLIENT`, then recheck gauges, never pooled migrate.
- Fact: Telemetry gap maps to Alloy overlay check with `OTEL_SDK_DISABLED` isolation.
- Uncertainty: FINAL-10 Q9 DLQ has no alert dashboard endpoint; poison rows invisible, see FINAL-10 Q9.
- Uncertainty: FINAL-10 Q10 `createdAt` delivery versus `created_at` enqueue skew; expose both, see FINAL-10 Q10.
- Uncertainty: FINAL-10 Q11 OTel compat retention arm64 unpinned alloy; pin plus document, see FINAL-10 Q11.
- Uncertainty: FINAL-10 Q6 `targetId` dead column confuses forensics; exclude from reads, see FINAL-10 Q6.
## Related
- Fact: Up `../00-INDEX.md`; routes T8; enforced by INV-005 plus INV-007 plus INV-008.
- Recommendation: Redrive steps in `redrive-dlq.md`; pipeline changes in `change-observability.md`.
- Recommendation: Pool math in `../subsystems/database-package.md`; probes in `../invariants/07-health.md`.
