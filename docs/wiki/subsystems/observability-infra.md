---
title: "Subsystem: Observability Infra (Alloy, Backends, Grafana)"
type: subsystem
status: stable
authority: descriptive
owners: ["subsystems/observability-infra.md"]
sources: ["observability/alloy/config.alloy", "observability/prometheus/prometheus.yml", "observability/prometheus/recording-rules.yml", "observability/prometheus/alerts/application.yml", "observability/prometheus/alerts/database.yml", "observability/loki/config.yml", "observability/tempo/config.yml", "observability/grafana/provisioning/datasources/datasources.yml", "observability/grafana/dashboards/01-system-overview.json", "docker-compose.observability.yml"]
depends_on: ["invariants/08-observability.md"]
guards: ["apps/api/src/common/observability/alert-rules.spec.ts", "apps/api/src/common/observability/metrics.service.spec.ts"]
updated: 2026-10-01
expires: null
superseded-by: null
template: true
---
# Subsystem: Observability Infra (Alloy, Backends, Grafana)
> Up: ../00-INDEX.md | Depends on: INV-08 (triple-sync normalizer instance fail-open baked RUM). Rules live in invariants, never copied here.
## 1. Ownership
**Fact:** Pipeline owned by `observability/alloy/config.alloy` (216 lines, OTLP plus Faro plus nginx tail) plus `docker-compose.observability.yml` (412 lines, 10 services plus proxy augmentations).
**Fact:** Metrics owned by `observability/prometheus/prometheus.yml` (29 lines) plus `recording-rules.yml` (32 lines) plus `alerts/application.yml` (146 lines) plus database redis infrastructure alerts.
**Fact:** Logs traces profiles owned by `observability/loki/config.yml` plus `tempo/config.yml` plus `pyroscope/config.yml` plus grafana datasources plus 6 dashboards plus nginx json_analytics.
**Recommendation:** Change storage scraping dashboards here; change labels buckets in observability-app same PR.
## 2. Runtime
**Fact:** Alloy is single fan-in: OTLP grpc 4317 max 64MiB plus http 4318 plus Faro 12347 plus nginx file tail converge, then fan-out to Tempo Prometheus Loki.
**Fact:** Batch processor timeout 200ms send 512 max 1024 outputs tempo prometheus loki_labels; attributes processor inserts loki resource labels.
**Fact:** Exporters are otlp tempo client tempo 4317 insecure, prometheus forward to remote-write, loki forward to relabel; Faro outputs logs to loki process plus traces to tempo.
**Fact:** Prometheus scrapes alloy 12345 plus postgres-exporter 9187 plus redis-exporter 9121 plus node-exporter 9100 plus cadvisor 8080 every 15s; api web never scraped directly.
## 3. Public API
| Endpoint | Contract | Source |
|---|---|---|
| alloy OTLP grpc | 0.0.0.0 4317 64MiB | config.alloy receiver |
| alloy OTLP http | 0.0.0.0 4318 | config.alloy receiver |
| faro receiver | 0.0.0.0 12347 cors split | config.alloy faro |
| alloy UI | 127.0.0.1 12345 | compose ports |
| grafana | 127.0.0.1 mapped port | compose grafana |
**Fact:** 64MiB raised from 4MiB default; per-route series under k6 exceed 10MiB or Alloy rejects RESOURCE_EXHAUSTED.
## 4. Dependency direction
**Fact:** Allowed: apps into Alloy 4317 grpc; browser into nginx collect into Alloy 12347; Alloy into Tempo Prometheus Loki; Grafana into all backends.
**Fact:** Forbidden: Prometheus MUST NOT scrape api web directly (duplicates remote-write); Loki labels MUST NOT gain high-cardinality route user id.
| Check | Grep |
|---|---|
| No direct scrape | rg -n "api:3001|web:3000" observability/prometheus/prometheus.yml, expect empty |
| Low labels | rg -n "service.*route" observability/alloy/config.alloy, expect only low set |
| Overlay only | rg -n depends_on.*alloy docker-compose.yml, expect empty base |
## 5. Security posture
**Fact:** Alloy 4317 4318 12345 12347 published 127.0.0.1 only; containers talk over app-network aliases, host via loopback.
**Fact:** Grafana port mapped 127.0.0.1 with admin creds via env; Prometheus remote-write receiver has no auth on single-host net by design loopback plus app-network only.
**Fact:** FARO_CORS_ORIGINS star is local-only open mode; restrict to app domains before prod in Alloy plus nginx both; nginx collect limit POST OPTIONS plus 1m cap plus 30r per s.
**Fact:** cAdvisor read-only rootfs plus tmpfs tmp plus no published port contains privileged surface; every open port is attack surface.
## 6. Failure modes
**Fact:** Alloy down means app OTLP retries, Grafana API dashboards stale, nginx collect 502s but app serves; Prometheus down means metrics red alerts silent generator backs up.
**Fact:** Loki down queues pushes in Alloy, trace-to-log links break, stdout docker logs still available; Tempo down drops traces at exporter, metrics logs unaffected.
**Fact:** Pyroscope down logs init warn with profiles gap and datasource red; redis-exporter pyroscope outage has no container health, only ExporterDown plus red.
**Fact:** Cardinality blowup with raw IDs pushes exports past 10MiB then 64MiB then Prometheus OOM over 15d; single-host SSD tuning assumes local filesystem.
## 7. Performance
**Fact:** Prometheus retention 15d scrape 15s eval 15s timeout 10s; Loki retention 168h 7d with compactor delete delay 5m; Tempo local filesystem with wal slack 15m.
**Fact:** Recording rules evaluated 30s consume recorded series not raw rates to cut query load; p95 p99 sum by le job route before quantile.
**Fact:** cAdvisor housekeeping 15s docker_only true; node-exporter plus cadvisor cover host plus container; Tempo generator writes span-metrics with exemplars.
**Fact:** Faro session persistent small localStorage write; captureConsole false; ignoring health prevents probe spam in backends.
## 8. Config/Env
**Fact:** Single source `.env.example:267-325`; compose uses VAR fail-fast, code requireEnv throws; GIT_SHA single version maps to service version plus Faro version.
**Fact:** OTEL_ENVIRONMENT literal per profile production development test, not from env except host; Alloy config mounted read-only no templating except CORS.
**Fact:** Service DNS names on app-network not localhost; OTLP endpoint kept as docker hostname alloy even for host runs with code rewrite.
**Fact:** GF port plus PROM port plus CADVISOR caps env-driven; compose requires GIT_SHA, e2e sets GIT_SHA e2e.
## 9. Testing/verification
**Fact:** No collector in test e2e profiles with OTEL_SDK_DISABLED true keeps suites hermetic; monitoring profile starts stack without postgres redis, do not combine prod plus monitoring.
**Fact:** `alert-rules.spec.ts` guards label renames; `normalize-route.spec.ts` guards cardinality; healthchecks alloy healthy via tcp, prometheus healthy, loki tempo ready, grafana api health.
**Fact:** Six dashboards 01-system 02-api 03-db-redis 04-auth 05-profiling 06-logs-traces provisioned via dashboards.yml file provider editable true.
**Recommendation:** After rules alerts change run promtool check rules plus alert spec; after Alloy change run alloy fmt plus dry-run.
## 10. Extension pointer
**Recommendation:** Add scrape target via static_config plus Grafana panel plus ExporterDown regex same PR.
**Recommendation:** Add recording rule to recording-rules 30s group, consume in alerts plus dashboards, never copy PromQL.
**Recommendation:** Add alert to alerts yml with severity plus dashboard annotation plus runbook link; add Loki pipeline stage before standard relabel.
## 11. AI-guidance
MUST: keep Alloy as only writer to Loki Tempo from apps; keep Prometheus job names stable; keep Loki labels low service job method only.
MUST: keep audit depth max by job never sum; keep OTLP grpc URL in SDKs; keep NEXT_PUBLIC_FARO bake rebuild rule.
MUST-NOT: add depends_on alloy in base compose; add healthcheck to pyroscope or redis-exporter without shell variant; scrape api web directly.
## 12. Common mistakes
**Interpretation:** Pinning alloy latest to digest without Renovate freezes pipeline silently; track GA channel with policy.
**Interpretation:** Adding Loki label for route user id causes index explosion unrecoverable without wipe; use structured metadata instead.
**Interpretation:** Combining prod plus monitoring leaves exporters scraping nothing; use one app profile at a time.
**Interpretation:** Pointing OTLP at localhost in compose breaks containers; keep alloy hostname, code rewrites for host.
## 13. Related
Invariants: INV-08 observability pointers only. Flows: flows/observability.md future. Subsystems: observability-app.md, api-runtime.md, docker-environments.md. Workflows: change-observability.md, debug-prod.md future. ADRs: ADR-0001 cluster future.
## 14. Refs
observability/alloy/config.alloy, observability/prometheus/prometheus.yml, observability/prometheus/recording-rules.yml, observability/prometheus/alerts/application.yml, observability/prometheus/alerts/database.yml, observability/prometheus/alerts/redis.yml, observability/prometheus/alerts/infrastructure.yml, observability/loki/config.yml, observability/tempo/config.yml, observability/pyroscope/config.yml, observability/grafana/provisioning/datasources/datasources.yml, observability/grafana/dashboards/01-system-overview.json, docker-compose.observability.yml, docker-compose.yml, nginx/nginx.conf.
> **Uncertainty:** OTel exporter versus Alloy compat plus Tempo retention plus Pyroscope arm64 is unverified with alloy latest unpinned. See .agent/wiki-discovery/FINAL-10-OPEN-QUESTIONS.md Q11; pin alloy sha plus set document retention plus check build logs before claiming lossless.
| Dashboard | Purpose | Source |
|---|---|---|
| 01-system-overview | host plus containers | grafana dashboards |
| 02-api-performance | p95 error rate | recording rules |
| 03-database-redis | pool backlog cache | database alerts |
| 04-auth-security | signin 429 fallback | application alerts |
| 06-logs-traces | Loki Tempo join | derivedFields |
**Fact:** Recording rules are single definition; alerts plus dashboards consume them never copy PromQL.
**Recommendation:** Keep this file 120-200 lines; link invariants, never copy rules; bump updated on every content PR.
### Verification commands
**Fact:** Run promtool check rules plus alert spec plus Grafana provisioning dry-run before PR.
**Recommendation:** Grep observability plus apps for old and new names same commit when renaming anything.
**Fact:** Nginx json traceparent to Alloy nginx process to Loki trace id derivedField to Tempo lookup.
**Recommendation:** Never add high-cardinality Loki label; index explosion needs wipe to recover.
**Fact:** Alloy ports bound 127.0.0.1 on host; OTLP grpc plus http both enabled on Alloy and Tempo; SDKs use grpc URL.
**Fact:** Proxy waits for healthy alloy in prod dev but boots without alloy in e2e test; nginx resolves collect at request time.
**Fact:** Loki schema tsdb filesystem v13 period 24h storage chunks with structured metadata plus deletes allowed.
**Recommendation:** Watch prometheus-data plus loki-data plus tempo-data volumes; 15d metrics outgrows 7d logs first.
**Fact:** Pyroscope filesystem backend dir data only; server 4040 with plugin app installed.
**Recommendation:** Validate with promtool plus alloy fmt plus Grafana dry-run before PR.
**Fact:** Code wins over wiki; Alloy config plus compose overlay win over prose.
**Recommendation:** Touching pipeline dashboard alert MUST update observability-app plus ports-topology same PR.
**Fact:** Tempo overrides ingestion slack 2m; generator processors service-graphs plus span-metrics with namespace dimensions.
**Fact:** Datasources link Prometheus Loki Tempo Pyroscope with exemplar traceID plus tracesToLogs plus tracesToProfiles.
**Fact:** Postgres-exporter probes slash not healthy; cadvisor probes healthz on 8080; alloy probes healthy via tcp.
**Recommendation:** Keep this file 120 lines minimum per subsystem size gate.
**Fact:** Fail-open test e2e emits nothing; 100 percent sampling elsewhere with no sampler config.
**Fact:** cAdvisor privileged read-only mem cpu caps must die alone never OOM postgres tempo.
**Recommendation:** Keep scrape 15s eval 15s retention 15d 7d tuned for single-host SSD.
**Fact:** Summing audit depth across workers multiplies true depth by worker count.
**Fact:** Native histograms plus exemplars enabled but no dashboard verified to consume them yet.
**Recommendation:** Document pipeline topology ports retention healthcheck gaps in this file.
**Fact:** Alloy batch 200ms 512 1024 plus 64MiB cap sustains k6 bursts.
**Recommendation:** Keep alloy latest risk visible until digest plus Renovate lands.
