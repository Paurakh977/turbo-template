---
title: "Observable by Default Safe Defaults"
type: invariant
status: stable
authority: normative-constraints
owners: ["subsystems/observability-app.md"]
sources: ["apps/api/src/otel.ts", "apps/web/src/instrumentation.ts", "packages/observability/src/index.ts", "apps/api/src/common/observability/metrics.service.ts", "observability/alloy/config.alloy", "apps/api/src/common/http-exception.filter.ts"]
depends_on: ["decisions/ADR-0001-cluster-in-container.md", "decisions/ADR-0010-baked-rum-and-next-public.md", "flows/observability.md"]
guards: ["apps/api/src/common/observability/normalize-route.spec.ts", "apps/api/src/common/observability/metrics.service.spec.ts"]
updated: 2026-10-01
expires: null
superseded-by: null
template: true
---
# INV-008 Observable by Default Safe Defaults
> Up: ../00-INDEX.md
**ID:** INV-008
## Invariant
- Fact: Routes MUST be normalized with triple-synced normalizer, workers MUST carry per-worker instance identity, and telemetry MUST fail open with baked RUM only.
## Why
- Fact: Normalizer drift explodes cardinality and trips Alloy guard; missing instance id merges workers into phantom rates; second registry or CSP splits series or breaks beacons silently (FINAL-07 Medium-03).
## Code
- Fact: `apps/api/src/common/observability/metrics.service.ts` `normalizeRouteForMetrics` triple-synced with interceptor plus catch-all middleware in `apps/api/src/main.ts`; 404 plus 502 still counted.
- Fact: `apps/api/src/otel.ts` plus `apps/api/src/cluster.ts` set `service.instance.id` per worker; `OTEL_SDK_DISABLED` fail-open no-op in test plus e2e; Alloy only exporter target `observability/alloy/config.alloy` OTLP 4317 plus 4318.
- Fact: RUM baked via NEXT_PUBLIC_* rebuild plus Faro via nginx collect to Alloy 12347 POST-only; `isRecording` guards before late span writes in filter plus interceptor plus plugin.
### Folded INV-014 single-owner headers plus trace trio
- Fact: CSP single owner `apps/web/src/proxy.ts:45-61` never nginx never Helmet API; CORS single in `apps/api/src/main.ts`; envelope spreads body first then fields with 500 redaction.
- Fact: Trace trio traceparent plus tracestate plus baggage forwarded end-to-end via nginx plus allowedHeaders; IP trio aligned via realip plus trust-proxy-1 plus trustedProxies CIDR walk.
## Consequences
- Fact: Dashboards 01-to-06 stay low-cardinality; traces stay continuous; beacons survive CSP without silent loss.
## Naive failure mode
- Interpretation: Adding new meter outside `packages/observability/src` getMeter or second CSP in nginx or moving `depends_on: alloy` to base breaks Alloy-less e2e and splits telemetry.
## Guards-tests
- Fact: Run `normalize-route` plus `metrics` plus `alert-rules` specs; verify AuditQueueBacklogHigh uses max-not-sum and Grafana 01-to-06 render.
## Related ADRs
- Recommendation: See [ADR-0001 Cluster](../decisions/ADR-0001-cluster-in-container.md) plus [ADR-0010 Baked RUM](../decisions/ADR-0010-baked-rum-and-next-public.md).
## Related flows-subsystems
- Recommendation: Enforced in [observability](../flows/observability.md); owned by [observability-app](../subsystems/observability-app.md) plus observability-infra.
- Uncertainty: FINAL-10 Q11 OTel exporter versus Alloy compat plus Tempo retention plus Pyroscope arm64 unverified; pin alloy sha plus document retention, see FINAL-10 Q11.
- Fact: For audit planes see [05-audit-planes.md](05-audit-planes.md) INV-005 pointer only; this file owns only metrics plus traces plus headers.
