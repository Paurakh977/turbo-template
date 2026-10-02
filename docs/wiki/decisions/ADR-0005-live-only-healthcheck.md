---
title: "ADR-0005 Live-Only Healthcheck"
type: adr
status: accepted
authority: normative-history
owners: ["subsystems/api-runtime.md"]
sources: ["apps/api/src/health/health.controller.ts", "docker-compose.yml", "apps/api/Dockerfile.prod"]
depends_on: ["invariants/07-health.md", "flows/e2e.md", "subsystems/docker-environments.md"]
guards: ["apps/api/src/health/health.controller.spec.ts", "apps/web/e2e/global.setup.ts"]
updated: 2026-10-01
expires: null
superseded-by: null
template: true
---
# ADR-0005 Live-Only Healthcheck
> Up: ../00-INDEX.md | Status: accepted | Routes T7 T8.
## Status
- Fact: Accepted. Compose HEALTHCHECK and depends_on hit live endpoint with no deps, never ready. See apps/api/src/health/health.controller.ts 26-36 plus 63-88.
## Context / Problem
- Fact: Ready checks Redis plus PG with 1.5s race. Gating startup or LB on ready couples deploy order to downstream flaps and self-DDoSes deploys.
- Interpretation: Liveness means process answers; readiness means deps answer. Mixing them turns a Redis blip into a deploy deadlock.
- Fact: Nginx health locations stay exempt from throttling while Nest health stays throttled by design. See nginx/nginx.conf health blocks.
## Decision
- Fact: Keep Dockerfile HEALTHCHECK on live plus compose depends_on live plus nginx passing health without limit_req. Ready stays observability-only for triage.
- Recommendation: New probes MUST keep live no-deps plus ready Redis-plus-PG split, MUST NOT add SkipThrottle exemption beyond current throttled design.
- Fact: E2E ready polling waits for stack without blocking compose boot. See apps/web/e2e/global.setup.ts polling.
## Rejected alternatives
- Ready-gated depends_on: waits for PG plus Redis before API healthy but deadlocks when DB starts after API or Redis blips during rollout. Rejected for deploy deadlock.
- SkipThrottle on health for cleaner signals: removes 210-to-429 noise but hides the throttled-by-design proof that edge exemption works. Rejected for signal loss.
- LB directly at ready with failover: routes around degraded deps but couples edge routing to DB state that changes per second. Rejected for flap coupling.
## Consequences
- Fact: Positive deploys never deadlock on downstream, live 200 plus ready 503 pair proves split. Negative degraded deps stay visible only via ready plus Alloy plus Grafana, not via orchestrator restart.
- Interpretation: Debug-prod triage reads live versus ready first, then pool gauges, per workflows/debug-prod.md.
## Revisit-when
- Recommendation: Revisit only when orchestrator supports degraded-ready state distinctly from dead. Then new ADR, keep live as restart signal.
## Related invariants and implementation
- Recommendation: Constrained by INV-007 live versus ready plus throttled. Traversed by flows/e2e.md. Owned by subsystems/api-runtime.md plus subsystems/docker-environments.md.
- Fact: Refs apps/api/src/health/health.controller.ts plus docker-compose.yml healthchecks plus apps/api/Dockerfile.prod HEALTHCHECK plus nginx/nginx.conf.
- Uncertainty: E2E app spec slash versus api prefix drift may give false health confidence. See .agent/wiki-discovery/FINAL-10-OPEN-QUESTIONS.md Q1. Run stub suite before trusting e2e green.
- Uncertainty: Long-lived orchestrator plus LB topology change would re-open ready-gating need. See .agent/wiki-discovery/FINAL-10-OPEN-QUESTIONS.md Q13. No topology change without ADR.
## Verification
- Fact: Verify with live 200 plus ready 503 pair plus e2e health plus proxy specs plus compose config lint before merge.
