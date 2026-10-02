---
title: "Subsystem: Observability App (SDKs, Meters, Spans)"
type: subsystem
status: stable
authority: descriptive
owners: ["subsystems/observability-app.md"]
sources: ["apps/api/src/otel.ts", "apps/web/src/instrumentation.ts", "apps/web/src/instrumentation-client.ts", "packages/observability/src/index.ts", "packages/observability/src/metrics.ts", "packages/observability/src/tracing.ts", "apps/api/src/common/observability/metrics.service.ts", "apps/api/src/common/observability/observability.interceptor.ts", "apps/api/src/common/http-exception.filter.ts"]
depends_on: ["invariants/08-observability.md"]
guards: ["apps/api/src/common/observability/metrics.service.spec.ts", "apps/api/src/common/observability/normalize-route.spec.ts", "apps/api/src/common/observability/alert-rules.spec.ts"]
updated: 2026-10-01
expires: null
superseded-by: null
template: true
---
# Subsystem: Observability App (SDKs, Meters, Spans)
> Up: ../00-INDEX.md | Depends on: INV-08 (triple-sync normalizer instance fail-open baked RUM). Rules live in invariants, never copied here.
## 1. Ownership
**Fact:** API boot owned by `apps/api/src/otel.ts` (202 lines, NodeSDK plus Pyroscope) after `load-env.ts`; web server owned by `apps/web/src/instrumentation.ts` (122 lines, register Node-only).
**Fact:** Browser owned by `apps/web/src/instrumentation-client.ts` (89 lines, initFaro) plus `lib/ui/faro-init.tsx` (12 lines, mount); shared owned by `packages/observability/src` (7 modules).
**Fact:** Nest owned by `common/observability/observability.module.ts` (Global) plus `observability.interceptor.ts` (107 lines, span-only) plus `metrics.service.ts` (398 lines) plus `http-exception.filter.ts` (envelope).
**Recommendation:** Change emitters here and backends in observability-infra same PR; label names must match.
## 2. Runtime
**Fact:** Boot order is load-env then otel then NestFactory (`main.ts:1-2`); otel side-effect only, never import Nest Express pg there.
**Fact:** `otel.ts:43-47` OTEL_SDK_DISABLED true means no SDK no profiler fail-open; `requireEnv` trims and throws Missing required env var.
**Fact:** Service identity is `OTEL_SERVICE_NAME_API` fallback shared plus namespace plus version `OTEL_SERVICE_VERSION` or `GIT_SHA` plus environment; per-worker `service.instance.id` api-worker-ID or api-single-PID.
**Fact:** Request path is Express catch-all timer plus finish record in `main.ts:45-71` then interceptor enriches active span with route template plus feature, then Http Pg IORedis auto-spans nest.
## 3. Public API
| Symbol | Contract | Source |
|---|---|---|
| createServiceResource | trims config or reads OTEL throws if missing | packages/observability/src/resource.ts |
| getMeter | default repo observability, LATENCY_BUCKETS 0.005 to 10 | packages/observability/src/metrics.ts |
| withSpan | startActiveSpan OK ERROR recordException end finally | packages/observability/src/tracing.ts |
| normalizeRouteForMetrics | strip query, 20plus to id, numeric to id | metrics.service.ts:24-31 |
| recordHttpRequest | defensive normalize, canonical status, clamp 0 | metrics.service.ts:252-275 |
**Fact:** Canonical status label is `http_response_status_code`; legacy `status_code` removed; query `nodejs_eventloop_delay_milliseconds` unit-suffixed.
## 4. Dependency direction
**Fact:** Allowed: `main.ts` into otel plus metrics middleware; interceptor into metrics service read-only; services into `withSpan` plus `record*`; logging into pino plus OTel bridge.
**Fact:** Forbidden: otel MUST NOT import Nest Express pg ioredis (circular plus boot order); interceptor MUST NOT record metrics (misses 404s); ad-hoc span keys forbidden.
| Check | Grep |
|---|---|
| No Nest in otel | rg -n Nest apps/api/src/otel.ts, expect empty |
| Canonical label | rg -n http_response_status_code apps/api/src/common/observability, expect hits |
| No raw route | rg -n rawPath apps/api/src/common/observability/metrics.service.ts, expect normalized |
## 5. Security posture
**Fact:** IORedis hook renames `redis:CMD` and redacts `db.statement`; Pg sets `enhancedDatabaseReporting false` and redacts `db.connection_string`.
**Fact:** `redact.ts` SENSITIVE_PATTERN covers password secret token cookie totp api key; OTel bridge copies only scalar fields, nested objects dropped to avoid PII leak.
**Fact:** CORS trace propagation limited to `/api/` plus configured `NEXT_PUBLIC_API_URL` (no wildcard); CSP `connect-src` allowlists only self plus API plus Faro.
**Fact:** Faro collector CORS locked by `FARO_CORS_ORIGINS` (star is local-only open mode); nginx adds no second CSP by design.
## 6. Failure modes
**Fact:** Missing OTel env with SDK enabled throws requireEnv plus Joi fail-fast at boot; Alloy down retries with backoff while stdout pino still lands in docker logs.
**Fact:** Negative duration from NTP step clamped to 0 lowest bucket; ended-span writes under abort skipped via `isRecording`, no warning spam.
**Fact:** Faro collector missing is silent no-RUM in dev, loud warn in prod; app never crashes; Pyroscope init failure warns only, SDK already started.
**Fact:** Telemetry is best-effort; request path never fails because observability failed; auth routes bypass interceptors but keep Express metrics.
## 7. Performance
**Fact:** Export is OTLP gRPC to Alloy every 15s api and 30s web; batch 200ms 512 1024; 64MiB max recv sustains k6 bursts without RESOURCE_EXHAUSTED.
**Fact:** Cardinality bounded by `normalizeRouteForMetrics` plus canonical status plus bounded auth labels; static segments under 20 chars locked by spec.
**Fact:** Event-loop gauges use Node builtins zero new deps observed on scrape; Faro captureConsole false plus persistent session true.
**Fact:** Ignoring `_next` healthz favicon prevents HMR and probe spam in Tempo and Prometheus; 7x rate bug warns never remove instance IDs.
## 8. Config/Env
**Fact:** Required `OTEL_EXPORTER_OTLP_ENDPOINT=http://alloy:4317` plus `OTEL_SERVICE_NAME` per tier plus namespace plus version or GIT_SHA plus environment.
**Fact:** `OTEL_SDK_DISABLED` false except test e2e true; Joi enforces conditional required; `OTEL_LOG_LEVEL` info prod debug otherwise.
**Fact:** `PYROSCOPE_SERVER_ADDRESS=http://pyroscope:4040` plus app name api; web omits profiler by design; Faro collector `https://localhost/collect` e2e 8443 variant.
**Fact:** `NEXT_PUBLIC_FARO_APP` trio baked at next build; rebuild web after changing; GIT_SHA maps to service version plus Faro version in compose.
## 9. Testing/verification
**Fact:** `normalize-route.spec.ts` locks 20-char invariant plus numeric UUID cuid collapse; `metrics.service.spec.ts` covers record plus clamp plus gauge ownership.
**Fact:** `alert-rules.spec.ts` keeps PromQL label names in sync with emitters; integration runs with `OTEL_SDK_DISABLED=true` no collector needed.
**Fact:** Faro catch warns every env except test to keep assertions quiet; web `process.on` versus api `process.once` shutdown difference noted.
**Recommendation:** Run specs after any route label bucket change; update dashboards same PR.
## 10. Extension pointer
**Recommendation:** Add counter or histogram in MetricsService onModuleInit plus record method plus spec; never use raw id in labels.
**Recommendation:** Add span tags via AppAttributes constants plus interceptor enrichment; use withSpan for domain ops.
**Recommendation:** Add Faro instrumentation via getWebInstrumentations options in one place; keep trace propagation allowlist tight.
## 11. AI-guidance
MUST: keep load-env before otel before NestFactory; keep span-only interceptor plus Express metrics to catch 404s; keep instance.id per worker.
MUST: normalize every new route; use AppAttributes HttpAttributes constants; clamp durations; check isRecording before span mutation.
MUST-NOT: add sampler without ADR; add high-cardinality label; log objects with tokens expecting redaction; set Faro env without rebuilding web.
## 12. Common mistakes
**Interpretation:** Adding metrics to interceptor and deleting main middleware loses 404s; Express is source of truth for counts.
**Interpretation:** Removing service.instance.id to simplify resources reintroduces 7x rate bug with per-worker counters summed wrong.
**Interpretation:** Using raw request URLs as route labels explodes Prometheus in one k6 run; always normalize via shared helper.
**Interpretation:** Adding static nginx CSP intersects proxy CSP and breaks beacons silently with no server log; proxy owns CSP alone.
## 13. Related
Invariants: INV-08 observability pointers only. Flows: flows/observability.md future. Subsystems: observability-infra.md, api-runtime.md, web-runtime.md. Workflows: change-observability.md future. ADRs: ADR-0001 cluster future.
## 14. Refs
apps/api/src/otel.ts, apps/api/src/load-env.ts, apps/api/src/main.ts, apps/web/src/instrumentation.ts, apps/web/src/instrumentation-client.ts, apps/web/src/lib/ui/faro-init.tsx, apps/web/src/proxy.ts, packages/observability/src/resource.ts, packages/observability/src/logging.ts, packages/observability/src/metrics.ts, packages/observability/src/tracing.ts, packages/observability/src/attributes.ts, packages/observability/src/redact.ts, apps/api/src/common/observability/observability.module.ts, apps/api/src/common/observability/observability.interceptor.ts, apps/api/src/common/observability/metrics.service.ts, apps/api/src/common/http-exception.filter.ts.
> **Uncertainty:** OTel exporter versus Alloy compat plus Tempo retention plus Pyroscope arm64 is unverified with alloy latest unpinned. See .agent/wiki-discovery/FINAL-10-OPEN-QUESTIONS.md Q11; do not assert pipeline semantics, pin alloy sha plus document retention plus check build logs.
| Metric | Type | Labels |
|---|---|---|
| http_server_request_duration_seconds | histogram | route method status |
| audit_queue_depth | gauge max | job |
| db_pool_used | observable gauge | service |
| eventloop_utilization | gauge | worker instance |
**Fact:** Audit depth gauge is global replicated; alerts use max never sum; additive counters use sum by job.
**Recommendation:** Keep this file 120-200 lines; link invariants, never copy rules; bump updated on every content PR.
| Span key | Owner | Note |
|---|---|---|
| http.route | interceptor | template not raw |
| app.feature | interceptor | auth notes audit users |
| trace_id span_id | pino mixin | Loki join |
### Verification commands
**Fact:** Run api unit for metrics plus normalize plus alert rules; check dashboards 01 02 04 06 render after label change.
**Recommendation:** Grep observability for metric name before renaming in code; rename in one place breaks four consumers.
**Fact:** OTEL_SEVERITY_MAP maps trace1 debug5 info9 warn13 error17 fatal21; bridge wraps six levels with body plus scalar attrs.
**Fact:** Logging injects trace span ids from active span; pino base service plus environment with isoTime and level formatter.
**Fact:** Http ignore lists health live healthz favicon on api and _next __nextjs favicon healthz on web.
**Recommendation:** Audit any new span attribute or log field for tokens PII before shipping.
**Fact:** Browser Faro beacons to collect with W3C traceparent to api origins; nginx file tail adds traceparent field to Loki.
**Recommendation:** Keep histogram buckets stable; changing them rewrites every quantile panel.
**Fact:** Code wins over wiki; metrics service plus otel plus package win over prose.
**Recommendation:** Touching SDK meter label interceptor filter MUST run normalize plus metrics plus alert specs.
**Fact:** Dual logging stdout plus OTLP preserves docker logs even when Alloy is down.
**Interpretation:** 100 percent sampling correct at template scale; tail sampling adds ops cost without benefit yet.
**Fact:** Alloy hostname rewrite alloy 4317 to localhost for host runs via dockerenv check in both api and web.
**Recommendation:** Never point OTLP endpoint at remote collector without TLS plus auth review.
**Fact:** Pyroscope tags tie environment plus version GIT_SHA to api traces web traces Faro version together.
**Fact:** Metrics exported OTLP gRPC to Alloy then Prometheus; logs to Loki; traces to Tempo with cross-links.
**Recommendation:** Keep timers unrefd so SIGTERM drains inside grace; verify via debug-prod triage.
**Fact:** Redacting db statement and connection strings prevents session password PII in Tempo.
**Fact:** Interceptor sets ROUTE_TEMPLATE and FEATURE plus status only when isRecording.
**Recommendation:** Keep this file 120 lines minimum per subsystem size gate.
