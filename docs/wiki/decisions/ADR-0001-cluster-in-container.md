---
title: "ADR-0001 Cluster in Container"
type: adr
status: accepted
authority: normative-history
owners: ["subsystems/api-runtime.md"]
sources: ["apps/api/src/cluster.ts", "docker-compose.yml", "apps/api/src/otel.ts"]
depends_on: ["invariants/04-database-connections.md", "invariants/08-observability.md", "flows/observability.md"]
guards: ["apps/api/src/cluster.ts", "k6/suites/"]
updated: 2026-10-01
expires: null
superseded-by: null
template: true
---
# ADR-0001 Cluster in Container
> Up: ../00-INDEX.md | Status: accepted | Routes T6 T9.
## Status
- Fact: Accepted. Node cluster forks workers sharing one port inside a single container. See apps/api/src/cluster.ts 21-52 for fork plus refork backoff.
## Context and problem
- Fact: Single event loop saturates at ELU 0.8 to 0.9 on hot JSON plus auth paths while host cores sit idle. Replicas multiply pool demand and image memory.
- Fact: Pool budget is workers times POOL_MAX against PgBouncer MAX_CLIENT. See docker-compose.yml API_WORKERS plus pgbouncer/pgbouncer.ini.
- Interpretation: Throughput needs more loops without multiplying Postgres connections or sidecars per replica.
## Decision
- Fact: Keep cluster.ts fork when WORKERS above 1, direct run when 1 or below. Per-worker instance.id keeps counters attributable. See apps/api/src/otel.ts per-worker resource.
- Recommendation: Tune WORKERS plus POOL_MAX with two-budget math, never raise workers without lowering per-worker pool.
## Rejected alternatives
- Replicas-only without cluster: one loop per container simplifies crash scope but multiplies Postgres clients and memory per replica and still needs per-replica identity. Rejected for pool storm at low replica counts.
- Kubernetes HPA-only scaling: autoscale on CPU handles sustained load but not single-container burst headroom and adds platform coupling this template does not require. Rejected for template portability.
- Single process plus larger pool: raises per-loop concurrency without extra loops, ELU stays the ceiling and latency tail grows. Rejected because ELU bound persists.
## Consequences
- Fact: Positive throughput scales with cores in one container, one health surface, one Alloy target. Negative worker crash reforks with backoff and in-flight on that worker drops.
- Fact: Pool math must be revisited on every WORKERS change or pgbouncer change, enforced by INV-004.
## Revisit-when
- Recommendation: Revisit when ELU above 0.8 sustained after WORKERS tune or pool storm at WORKERS above 1 with p99 breach. Then new ADR superseding this one, never edit history.
## Related invariants and implementation
- Recommendation: Constrained by INV-004 pooler versus direct plus INV-008 instance.id. Traversed by flows/observability.md. Owned by subsystems/api-runtime.md.
- Fact: Refs apps/api/src/cluster.ts plus docker-compose.yml API_WORKERS plus apps/api/src/otel.ts plus subsystems/api-runtime.md.
- Uncertainty: OTel exporter plus Alloy compat plus Tempo retention plus arm64 native behavior unverified. See .agent/wiki-discovery/FINAL-10-OPEN-QUESTIONS.md Q11. Never guess versions.
## Verification
- Fact: Verify with k6 smoke plus pool gauges and Grafana 01-06 render. ELU plus pool plus p99 stay in research dated file, never invariants.
