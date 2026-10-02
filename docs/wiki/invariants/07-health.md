---
title: "Liveness versus Readiness Split"
type: invariant
status: stable
authority: normative-constraints
owners: ["subsystems/docker-environments.md"]
sources: ["apps/api/src/health/health.controller.ts", "apps/api/src/health/health.module.ts", "docker-compose.yml", "apps/api/Dockerfile.prod", "nginx/nginx.conf"]
depends_on: ["decisions/ADR-0005-live-only-healthcheck.md", "flows/e2e.md"]
guards: ["apps/api/test/integration/modules/health.integration.spec.ts", "apps/api/test/integration/modules/security-regression.integration.spec.ts"]
updated: 2026-10-01
expires: null
superseded-by: null
template: true
---
# INV-007 Liveness versus Readiness Split
> Up: ../00-INDEX.md
**ID:** INV-007
## Invariant
- Fact: Liveness MUST be dependency-free 200 when process is up; readiness MAY report 503 on Redis or Postgres failure; healthchecks MUST hit live never ready.
## Why
- Fact: Edge throttle on health flaps deploys into self-DDoS; ready-coupled load-balancing holds traffic on Redis blip that live could serve degraded.
## Code
- Fact: `apps/api/src/health/health.controller.ts:26-36` deliberately throttled no SkipThrottle; `live` returns ok with no deps; `ready:63-88` races Redis PING plus PG SELECT 1 with 1.5s timeout and redacted logs.
- Fact: `nginx/nginx.conf:263-278` exempts `/api/health/` from limit_req with 5s timeouts; `/healthz` stays unauthenticated unthrottled with access_log off.
- Fact: `docker-compose.yml` depends_on uses live healthy plus `apps/api/Dockerfile.prod` HEALTHCHECK hits live; LB uses healthz or live never ready.
## Consequences
- Fact: Containers start without deadlock on warm-up; 210 sequential hits correctly yield 429 proving throttle contract while probes in distinct buckets stay green.
## Naive failure mode
- Interpretation: Adding limit_req to `/api/health/` location or pointing LB at ready or adding SkipThrottle to health controller breaks deploy topology.
## Guards-tests
- Fact: Run `health` live plus ready specs plus 210-to-429 contract (Nest-throttled) plus api healthcheck interval 10 timeout 5 retries 12 start 30 on `/api/health/live`; proxy healthz probe is interval 15 retries 10 start 15. Health is Nest-throttled but edge-exempt — every sentence about throttling needs its layer prefix.
- Fact: For rate-limit layers see [06-rate-limits.md](06-rate-limits.md) INV-006 pointer only; this file owns only probe split plus topology.
## Related ADRs
- Recommendation: See [ADR-0005 Live Only](../decisions/ADR-0005-live-only-healthcheck.md) for deadlock versus degraded-serve trade-off.
## Related flows-subsystems
- Recommendation: Enforced in [e2e](../flows/e2e.md) plus observability; owned by [docker-environments](../subsystems/docker-environments.md) plus api-runtime.
- Fact: Probes from 127.0.0.1 in-container never share Nest throttle bucket with external floods via gateway XFF identity.
- Fact: Readiness failure shape is `{ checks: { redis, database } }` with 503; liveness shape is `{ status: ok }` with 200.
- Fact: Nginx file plus JSON analytics logs keep health exempt observations auditable without per-probe info spam.
- Fact: E2E seed plus Playwright projects gate on live healthy before traffic, never on ready degraded state.
