---
title: "00 Glossary"
type: index
status: stable
authority: descriptive
owners: []
sources: [".agent/wiki-discovery/05-authorization-rbac.md", ".agent/wiki-discovery/03-api-runtime.md", ".agent/wiki-discovery/08-database-prisma.md", ".agent/wiki-discovery/06-audit-system.md", ".agent/wiki-discovery/01-repository-platform.md", ".agent/wiki-discovery/04-authentication.md", ".agent/wiki-discovery/FINAL-10-OPEN-QUESTIONS.md"]
depends_on: []
guards: []
updated: 2026-10-01
expires: null
superseded-by: null
template: true
---
# 00 Glossary

> Descriptive dictionary only. Normative rules live in invariants. Code wins over definitions. Up: self-root companion to 00-INDEX.md.

- Fact: Eight homonym pairs below are the only glossary entries. New homonyms trigger an update per .agent/wiki-discovery/PHASE2-13-IMPLEMENTATION-BLUEPRINT.md S6. See 00-INDEX.md for task routes.
- Recommendation: When two terms look interchangeable, stop and re-read the pair before editing code.

| Pair | One-line meaning | Pointer |
|---|---|---|
| Effective vs session user | Acting admin vs viewed account | invariants/02-fresh-role.md |
| Live vs ready | Process alive vs dependencies ready | invariants/07-health.md |
| Pooler vs direct | Shared pooled runtime vs dedicated migrate path | invariants/04-database-connections.md |
| Sync vs outbox audit | Inline auth write vs durable queued domain write | invariants/05-audit-planes.md |
| Presentational vs enforced | Interface hiding vs server verdict | invariants/10-ui-enforcement.md |
| Baked vs runtime env | Build-time inlined vs process-start injected | invariants/09-env.md |
| Bare-token vs prefixed | Raw session token key vs namespaced key | invariants/06-rate-limits.md |
| Instance id per worker | Unique telemetry identity per cluster worker | invariants/08-observability.md |
## Effective vs session user

- Fact: Session user is the viewed account from the session cookie. Effective user is the acting principal, which equals the impersonating admin when impersonation is active, else the session user. See .agent/wiki-discovery/05-authorization-rbac.md S10 plus apps/api/src/common/session.utils.ts for getEffectiveUserId and apps/api/src/users/users.controller.ts for me-role versus me-permissions split.
- Interpretation: Permission checks use the effective user, while ownership scoping and chrome visibility use the session user. Confusing them grants the wrong principal power or leaks admin interface into impersonated views.
- Recommendation: Pointer: read [fresh-role invariant](invariants/02-fresh-role.md) plus [request-context invariant](invariants/03-request-context.md) plus [rbac subsystem](subsystems/rbac-rules-users.md). Never unify me-role and me-permissions.

## Live vs ready

- Fact: Live reports process alive with no dependency touch. Ready checks Redis plus Postgres with a short race and returns failure when either is down. See .agent/wiki-discovery/03-api-runtime.md S3.6 plus apps/api/src/health/health.controller.ts for live versus ready handlers.
- Interpretation: Treating ready as liveness deadlocks container startup on warm-up blips, while treating live as readiness hides downstream outages from load balancing decisions.
- Recommendation: Pointer: read [health invariant](invariants/07-health.md) plus [e2e flow](flows/e2e.md). Container healthchecks hit live only.

## Pooler vs direct

- Fact: Pooler is the shared transaction-mode connection path for runtime queries. Direct is the dedicated Postgres path for migrations, studio, and seed. See .agent/wiki-discovery/08-database-prisma.md S12 plus packages/database/prisma.config.ts for datasource precedence and pgbouncer/pgbouncer.ini for transaction mode.
- Interpretation: Running migrations through the pooler breaks advisory locks and session-level statements, while running runtime traffic direct exhausts Postgres connections and bypasses pool budgets.
- Recommendation: Pointer: read [database-connections invariant](invariants/04-database-connections.md) plus [migration flow](flows/migration.md). Runtime uses pooler port, migrate uses direct port.
## Sync vs outbox audit

- Fact: Sync audit writes auth-tier security events inline with best-effort swallow. Outbox audit enqueues domain events in the same transaction as the business mutation for later durable delivery. See .agent/wiki-discovery/06-audit-system.md S3 plus apps/api/src/common/audit-writer.ts for plane split and apps/api/src/common/audit-queue.service.ts for poller and delivery.
- Interpretation: Assuming sync is durable loses events on failure without retry, while putting privilege events on the queue adds latency and ordering risk. Assuming all audit is same-transaction breaks auth flows that commit after hooks.
- Recommendation: Pointer: read [audit-planes invariant](invariants/05-audit-planes.md) plus [audit flow](flows/audit.md). High-volume domain writes use the queue with transaction handle.
- Uncertainty: Target identifier column is currently unset by writers and delivery timestamp differs from enqueue time under backlog. See .agent/wiki-discovery/FINAL-10-OPEN-QUESTIONS.md Q6 plus Q10 plus Q9 for redrive visibility. Never assert target semantics or timeline order as fact.

## Presentational vs enforced

- Fact: Presentational gating hides links, badges, and buttons in web code. Enforced gating re-checks fresh role plus permissions on the API for every mutation. See .agent/wiki-discovery/05-authorization-rbac.md S13-S14 plus apps/web/src/lib/server/require-admin.ts for presentational redirect and apps/api/src/common/authorization.service.ts for verdicts.
- Interpretation: Relying on hidden buttons as access control leaves direct endpoint calls unguarded. Moving enforcement into the client reintroduces stale-role and impersonation confusion.
- Recommendation: Pointer: read [ui-enforcement invariant](invariants/10-ui-enforcement.md) plus [web-auth-admin subsystem](subsystems/web-auth-admin.md). Interface may lag truth by one poll cycle because enforcement stays server-side.

## Baked vs runtime env

- Fact: Baked values are inlined at image build time and need rebuild to change. Runtime values are injected at process start and validated fail-fast at boot. See .agent/wiki-discovery/01-repository-platform.md S6 plus apps/web/next.config.js validation plus Dockerfile.prod builder ARG inlining for public-value inlining and apps/api/src/app.module.ts for Joi validation.
- Interpretation: Editing a baked value without rebuild silently keeps the old value in production, while treating a required secret as optional lets containers boot into silent downgrade.
- Recommendation: Pointer: read [env invariant](invariants/09-env.md) plus [env-config subsystem](subsystems/env-config.md) plus [docker-environments subsystem](subsystems/docker-environments.md).
- Uncertainty: Web package still lists unused data and cache client dependencies that look required but are not imported. See .agent/wiki-discovery/FINAL-10-OPEN-QUESTIONS.md Q12. Never assert install presence equals runtime use.
## Bare-token vs prefixed

- Fact: Bare-token means the session cache key is the raw session token with no namespace prefix in this Better Auth version. Prefixed would be a namespaced form that no writer produces here. See .agent/wiki-discovery/04-authentication.md S8 plus packages/auth/src/server/pending-storage.ts for key inventory and packages/auth/src/server/infra/redis.ts for mirror semantics.
- Interpretation: Deleting a prefixed key is a silent no-op that leaves the real session alive, so banned or revoked users stay authenticated until natural expiry. Adding a prefix cleanup without upgrading the framework reopens revoked sessions.
- Recommendation: Pointer: read [rate-limits invariant](invariants/06-rate-limits.md) for fail-open context plus [auth-better-auth subsystem](subsystems/auth-better-auth.md). Invalidate by bare token plus active-sessions list entry.
- Uncertainty: Whether active-sessions list deletion is load-bearing or defense-in-depth is unproven and depends on framework read-path filtering. See .agent/wiki-discovery/FINAL-10-OPEN-QUESTIONS.md Q4. Never assert either as fact.

## Instance id per worker

- Fact: Instance identifier is a unique telemetry label per cluster worker, distinguishing cumulative counters that would otherwise merge into one jagged series. See .agent/wiki-discovery/03-api-runtime.md S3.4 plus apps/api/src/otel.ts for per-worker resource construction and apps/api/src/cluster.ts for worker forking.
- Interpretation: Sharing one identifier across workers inflates rate calculations and hides per-worker skew, while dropping the label makes event-loop and pool gauges unattributable during capacity work.
- Recommendation: Pointer: read [observability invariant](invariants/08-observability.md) plus [observability flow](flows/observability.md). Keep identity distinct per worker and summed only in queries.
- Uncertainty: Exporter plus collector compatibility, retention, and native-module behavior on some architectures are unverified. See .agent/wiki-discovery/FINAL-10-OPEN-QUESTIONS.md Q11. Never guess versions or retention as fact.
