---
title: "Workflow: Change Observability Pipeline"
type: workflow
status: stable
authority: normative-procedure
owners: ["subsystems/observability-app.md"]
sources: ["apps/api/src/otel.ts", "apps/web/src/instrumentation.ts", "packages/observability/src/index.ts", "apps/api/src/common/observability/metrics.service.ts", "apps/api/src/common/observability/observability.interceptor.ts", "observability/alloy/config.alloy", "observability/prometheus/alerts/database.yml", "observability/grafana/dashboards/02-api-performance.json"]
depends_on: ["invariants/08-observability.md", "flows/observability.md", "subsystems/observability-app.md", "subsystems/observability-infra.md"]
guards: ["apps/api/src/common/observability/metrics.service.spec.ts", "apps/api/src/common/observability/normalize-route.spec.ts", "apps/api/src/common/observability/alert-rules.spec.ts"]
updated: 2026-10-01
expires: null
superseded-by: null
template: true
---
# Workflow: Change Observability Pipeline
> Up: ../00-INDEX.md | Use when: SDK, meter, label, Alloy, rule, dashboard, or alert change. Route: T6.
## Purpose
- Fact: Changes app SDKs plus Alloy plus backends plus Grafana with fail-open telemetry and normalized routes.
- Interpretation: Telemetry never blocks requests; `OTEL_SDK_DISABLED` plus Alloy overlay keep local runs quiet.
- Recommendation: Change SDK to Alloy to backend to dashboard in order; never move `depends_on alloy` from overlay to base.
## Preconditions
- [ ] Read `../00-INDEX.md` task row T6 and confirm Required order before diff.
- [ ] Read `../invariants/08-observability.md` normalized routes plus per-worker identity plus fail-open.
- [ ] Read `../flows/observability.md` SDK to Alloy to Tempo plus Prom plus Loki plus Pyroscope narrative.
- [ ] Read `../subsystems/observability-app.md` plus `observability-infra.md`.
- Fact: Unnormalized route labels explode cardinality; triple-sync across SDK plus meter plus interceptor is normative.
## Steps checklist
- [ ] 1. Update SDK `apps/api/src/otel.ts` NodeSDK 15s plus `apps/web/src/instrumentation.ts` lighter 30s.
- [ ] 2. Use `getMeter('@repo/observability')` in `packages/observability/src` for new meter, never raw meter name.
- [ ] 3. Update `metrics.service.ts` `normalizeRouteForMetrics` and keep under 20 canonical routes.
- [ ] 4. Update interceptor plus `http-exception.filter.ts` span-only behavior with `isRecording` check.
- [ ] 5. Update `observability/alloy/config.alloy` OTLP 4317 slash 4318 batch 200ms plus Faro 12347 guard.
- [ ] 6. Update Prometheus rules plus `alert-rules.spec.ts` max-not-sum for backlog style alerts.
- [ ] 7. Update Loki plus Tempo plus Pyroscope wiring plus retention notes if touched.
- [ ] 8. Update Grafana 01 to 06 dashboards plus verify render locally before merge.
- [ ] 9. Keep compose overlay `depends_on alloy` in overlay only, never in base compose.
## Commands
```sh
pnpm --filter api test:integration -- -t "metrics"
pnpm --filter api test:integration -- -t "normalize-route"
pnpm --filter api test:integration -- -t "alert-rules"
pnpm k6:smoke
```
- Fact: `metrics` plus `normalize-route` plus `alert-rules` are Jest specs; run all three before dashboard merge.
- Fact: `k6:smoke` stays optional here unless route labels changed on a hot path.
## Files-areas
| Area | Paths |
|---|---|
| SDK | `apps/api/src/otel.ts` plus `apps/web/src/instrumentation*.ts` |
| Package | `packages/observability/src/*` resource plus logger plus meter |
| App | `metrics.service.ts` plus interceptors plus exception filter |
| Pipeline | `observability/alloy/config.alloy` plus exporters |
| Surface | `observability/prometheus/alerts/*` plus `grafana/dashboards/*` |
## Architectural gates
- Fact: `depends_on alloy` stays in observability overlay, never in base compose.
- Fact: Route normalization triple-sync holds across SDK plus service plus interceptor.
- Fact: Telemetry fail-open; exporter outage never returns 500 for business traffic.
- Fact: Per-worker `instance.id` preserved for ELU plus pool correlation.
## Tests
- Fact: Required `metrics` plus `normalize-route` plus `alert-rules` specs green.
- Fact: Required Grafana 01 to 06 render check plus overlay `depends_on` grep.
- Fact: Recommended `ports-topology.md` check for 4317 slash 4318 slash 12347 exposure.
## Documentation updates
- Fact: Same PR updates `subsystems/observability-app.md` plus `observability-infra.md` plus `ports-topology.md`.
- Fact: Same PR updates `flows/observability.md` hops if SDK or pipeline order changed.
- Fact: Bump `updated` plus run link lint; never paste full Alloy config into docs.
## Verification
- [ ] All three specs green plus Grafana dashboards 01 to 06 render without missing panels.
- [ ] Alloy still overlay-only; base compose has no Alloy dependency.
- [ ] New meter appears with normalized route label and `instance.id` intact.
- [ ] `git status --short` shows only SDK plus Alloy plus alert plus dashboard plus docs paths.
## Failure-recovery
- Fact: Bad rule maps to revert alert plus rerun `alert-rules` spec; never silence backlog alert to green dashboards.
- Fact: Cardinality blowup maps to tighten normalizer plus drop raw path label, then redeploy Alloy.
- Fact: Pipeline outage maps to fail-open check with `OTEL_SDK_DISABLED` versus Alloy down isolation.
- Uncertainty: FINAL-10 Q11 OTel exporter versus Alloy compat plus Tempo retention plus Pyroscope arm64; see FINAL-10 Q11.
## Related
- Fact: Up `../00-INDEX.md`; routes T6; enforced by INV-008.
- Recommendation: Prod triage continues in `debug-prod.md`; backlog alert in `../flows/audit.md`.
- Recommendation: Methodology stays, numbers expire; never promote k6 numbers without ADR.
