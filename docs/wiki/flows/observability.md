---
title: "Flow: Observability SDK to Grafana"
type: flow
status: stable
authority: descriptive
owners: ["subsystems/observability-app.md"]
sources: ["apps/api/src/otel.ts", "apps/api/src/main.ts", "apps/api/src/common/observability/metrics.service.ts", "apps/api/src/common/observability/observability.interceptor.ts", "packages/observability/src/index.ts", "observability/alloy/config.alloy", "observability/prometheus/alerts/application.yml"]
depends_on: ["invariants/08-observability.md"]
guards: ["apps/api/src/common/observability/metrics.service.spec.ts", "apps/api/src/common/observability/normalize-route.spec.ts"]
updated: 2026-10-01
expires: null
superseded-by: null
template: true
---
# Flow: Observability SDK to Grafana
> Up: ../00-INDEX.md | Depends on: INV-008
## Purpose
- Fact: Follows request signal from dual SDKs through Alloy OTLP to Tempo/Prom/Loki/Pyroscope plus Grafana dashboards.
- Interpretation: Catch-all middleware plus normalizer plus fail-open SDK keep cardinality bounded and requests unblocked.
- Recommendation: New endpoints must use normalized route labels; new spans must guard `isRecording`.
## Diagram
```text
req -> main.ts(metrics catch-all+auth-event) -> metrics.service(normalizeRoute)
  -> ObservabilityInterceptor(span-only) -> otel.ts SDK(fail-open if DISABLED)
  -> packages/observability(logging/tracing/metrics redact)
  -> Alloy 4317/4318 batch512 + Faro 12347 + nginx file -> Tempo/Prom/Loki/Pyroscope
  -> Grafana 01-06 dashboards + Prometheus alerts
```
## Hop table
| # | Hop | File:Symbol | In->Out | Failure |
|---|---|---|---|---|
| 0 | Catch-all | apps/api/src/main.ts:metricsService | every req -> recordHttpRequest | Captures 404/502 bypassing interceptors; skips live/healthz logs |
| 1 | Normalize | apps/api/src/common/observability/metrics.service.ts:normalizeRouteForMetrics | raw path -> template route | Per-ID collapses to :id; unknown stays raw bounded |
| 2 | Span enrich | apps/api/src/common/observability/observability.interceptor.ts:ObservabilityInterceptor | req -> span attrs | Guards isRecording before setAttribute to avoid ended-span warn |
| 3 | SDK init | apps/api/src/otel.ts:OTEL_SDK_DISABLED | env -> no-op or exporter | Disabled true is fail-open no-op; missing endpoint fails fast via Joi |
| 4 | Shared kit | packages/observability/src/index.ts:createLogger | event -> redact+meter | PII redacted; getMeter namespace fixed per package |
| 5 | Collector | observability/alloy/config.alloy:batch | OTLP 4317/4318 -> batch 200ms 512 | 64MiB guard survives k6 burst; Alloy only exporter target |
| 6 | Backends | observability/tempo/config.yml:4317 | traces/metrics/logs -> Tempo/Prom/Loki | Retention documented per backend; Pyroscope shell-less no healthcheck |
| 7 | Surface | observability/grafana/dashboards/02-api.json:Grafana | signals -> 01-system..06-logs | Alerts max-not-sum for backlog; DLQ needs separate non-empty alert |
## Files
- Fact: `apps/api/src/otel.ts` plus `apps/api/src/main.ts:48-104` own SDK init plus catch-all plus auth-event middleware.
- Fact: `metrics.service.ts` owns `normalizeRouteForMetrics` plus `service.instance.id` per-worker attribution.
- Fact: `packages/observability/src` owns logger plus tracing plus meters with redact by default.
- Fact: `observability/alloy/config.alloy` owns OTLP receivers plus batch plus Tempo/Prom/Loki exporters.
## Failure branches
- Fact: OTel disabled -> SDK no-op; request still served without spans or metrics export.
- Fact: Alloy down -> SDK buffers then drops; app never blocks on telemetry flush.
- Fact: High cardinality -> normalizer caps series; unnormalized route would explode Alloy memory.
- Fact: Pyroscope outage visible via Grafana red plus startup warn; no container healthcheck by design.
## Security + observability implications
- Fact: `traceparent/tracestate/baggage` forwarded by nginx plus CORS allowlist end-to-end.
- Fact: Auth audit spans guard `isRecording`; late writes under saturation stay silent not warn.
- Interpretation: Second CORS or CSP owner breaks beacons; keep single-owner headers in `main.ts` plus proxy.
- Fact: Baked RUM via `NEXT_PUBLIC_*` inlined at build; runtime injection is rejected without ADR-0010 revisit.
## Linked invariants
- Recommendation: Enforced by [INV-008 Observability](../invariants/08-observability.md) with triple-sync plus instance.id plus fail-open.
- Recommendation: Related pipeline owner [observability-infra](../subsystems/observability-infra.md) plus change workflow.
## Up link
- Fact: Up: `../00-INDEX.md`; routes T6,T8; subsystems `observability-app` plus `observability-infra`.
- Fact: Faro collect via nginx rate-limited 30r/s burst 50; prod must restrict CORS alongside FARO_CORS_ORIGINS.
