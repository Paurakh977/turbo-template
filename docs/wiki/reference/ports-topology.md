---
title: "Reference: Ports Topology"
type: reference
status: stable
authority: derived
owners: ["subsystems/docker-environments.md"]
sources: ["docker-compose.yml", "docker-compose.observability.yml", "apps/api/src/health/health.controller.ts", "nginx/nginx.conf"]
depends_on: ["invariants/07-health.md", "subsystems/docker-environments.md", "subsystems/observability-infra.md"]
guards: ["apps/api/test/integration/modules/health.integration.spec.ts", "apps/web/e2e/global.setup.ts"]
updated: 2026-10-01
expires: null
superseded-by: null
template: true
---
# Reference: Ports Topology
> Up: ../00-INDEX.md
| Port | Service | Profile | Exposure |
|---|---|---|---|
| 80, 443 | proxy nginx | prod/dev/local/e2e | public ${PROXY_HTTP_PORT}:80 ${PROXY_HTTPS_PORT}:443; /healthz |
| 5432 | postgres | prod/dev/local | 127.0.0.1:${POSTGRES_PORT}:5432; expose 5432 |
| 6379 | redis | prod/dev/local | 127.0.0.1:${REDIS_PORT}:6379; expose 6379 |
| 6432 | pgbouncer | prod/dev | 127.0.0.1:${PGBOUNCER_PORT}:6432; runtime pool |
| 3001 PORT | api | prod/dev/test/e2e | 127.0.0.1 loopback-only; container app-network |
| 3000 WEB_PORT | web | dev/prod | 127.0.0.1 loopback-only; via proxy |
| 5050 | pgadmin | prod optional | 127.0.0.1 only, SSH tunnel |
| 5433, 6380 | postgres-test, redis-test | test | host mappings, tmpfs |
| 8443 | proxy-e2e | e2e | PLAYWRIGHT_BASE_URL https://localhost:8443 |
| 4317, 4318 | alloy OTLP gRPC/HTTP | prod/dev/local/monitoring | 127.0.0.1 host access |
| 12345, 12347 | alloy UI, faro receiver | prod/dev/local/monitoring | 127.0.0.1; nginx /collect>alloy |
| 9090>9091 | prometheus | prod/dev/local/monitoring | 127.0.0.1:${PROMETHEUS_PORT}:9090 |
| 3100 | loki | prod/dev/local/monitoring | 127.0.0.1:3100 |
| 3200 | tempo | prod/dev/local/monitoring | 127.0.0.1:3200; 4317/4318/9095 internal |
| 4040 | pyroscope api-only | prod/dev/local/monitoring | 127.0.0.1:4040; no healthcheck shell-less |
| 3002 | grafana | prod/dev/local/monitoring | 127.0.0.1:${GRAFANA_PORT}:${GF_SERVER_HTTP_PORT} |
| 9100, 9187, 9121, 8080 | node/postgres/redis-exporter, cadvisor | monitoring | expose only (cadvisor 8080 no publish) |
## Health appendix
- Fact: live `GET /api/health/live` = dependency-free `{ok}`; HEALTHCHECK + depends_on use live only.
- Fact: ready `GET /api/health/ready` = redis ping 1500ms + `SELECT 1`; 503 on failure; LB/e2e poll ready.
- Fact: Health throttled like any route (no SkipThrottle); 210 hits>429 proves shared bucket.
- Fact: api depends_on postgres+migrate+redis+pgbouncer healthy; web depends_on api healthy; proxy depends_on alloy (overlay only).
- Uncertainty: Alloy latest unpinned + Tempo retention + Pyroscope arm64 (FINAL-10 Q11). See .agent/wiki-discovery/FINAL-10-OPEN-QUESTIONS.md.
