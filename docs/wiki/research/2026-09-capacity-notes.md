---
title: "2026-09 Capacity Notes (Pool Headroom plus ELU)"
type: research
status: stable
authority: expired
owners: ["subsystems/k6-performance.md"]
sources: ["k6/suites/capacity.js", "k6/config.js", "apps/api/src/cluster.ts", "docker-compose.yml", "pgbouncer/pgbouncer.ini", "GETTING_STARTED.md", "scripts/benchmark-report.mjs"]
depends_on: ["subsystems/k6-performance.md", "subsystems/database-package.md", "subsystems/api-runtime.md"]
guards: []
updated: 2026-09-30
expires: 2027-03-30
superseded-by: null
template: true
---
# 2026-09 Capacity Notes (Pool Headroom plus ELU)
> Up: ../00-INDEX.md | Expires: 2027-03-30 | Measured: 2026-09-30 @ 8e9cce7 | Env: bench host 16-core, workers matrix 1/2/4/8, pools 50/1000/50/20/15
## Date
- Fact: Measured 2026-09-30 at commit 8e9cce7; bench host 16-core isolated from prod; `API_WORKERS` matrix 1 then 2 then 4 then 8 with `pnpm k6:capacity` each.
- Fact: Pool contract `workers x DATABASE_POOL_MAX <= PGBOUNCER_MAX_CLIENT_CONN`; server peak DEFAULT plus RESERVE must stay below POSTGRES_MAX_CONNECTIONS 200.
## Scope
- Fact: Suite `k6/suites/capacity.js` only; measures ceiling with arrival-rate plus `dropped_iterations count==0` gate; latency has no gate by design.
- Fact: Out of scope: soak leak detection, spike 429 flood shape, edge 4xx shapes, DLQ/admin redrive load; see baseline file for smoke plus load.
## Source / Version
- Fact: Sources `k6/suites/capacity.js` plus `k6/config.js:96-104` capacity thresholds plus `apps/api/src/cluster.ts:21-52` worker fork plus `pgbouncer/pgbouncer.ini` pools.
- Fact: Versions: repo 8e9cce7, k6 0.57.0, `.env.k6.example:75-86` pools 50/1000/50/20/15, PG 200, checkpoint 15min/0.9, WAL 4GB/1GB.
- Fact: Commit 8e9cce7 pool math from `GETTING_STARTED.md` pool section plus `docker-compose.yml:283-293` pooler comments; code wins over prose.
## Methodology
- Fact: Recreate api only per step (`compose --env-file .env.k6 up -d api`), no rebuild; run `pnpm k6:capacity` with `.env.k6` flood gates RATE 2M THROTTLE 2M.
- Fact: Capacity gates `checks>0.95 5xx<10pct dropped==0 429 count>=0`; breaking point expected slow, so no p95/p99 gate unlike load.
- Fact: Traffic mix `TRAFFIC_MIX.capacity` notesRead 0.4 notesWrite 0.25 rateLimit 0.2 health 0.15; mix sums to 1 per `k6/tests/runner-contract.mjs`.
- Fact: Observe pool gauges plus `waiting` growth plus 503 mapping plus ELU; ELU over 0.8 sustained is scale signal, not pool growth alone.
- Fact: Render with `node scripts/benchmark-report.mjs k6/results`; record workers plus pool plus pooler peak plus ELU plus p95 in header.
- Recommendation: Keep 50/1000/50/20/15 unless benchmark proof attached; 100/70 regressed IO-bound per `pgbouncer.ini` comment.
## Results (labeled, not targets)
| Workers | Pool | Pooler peak | p95 | 5xx | Notes |
|---|---|---|---|---|---|
| 1 | 50 | n/a | n/a | n/a | 2026-09-30 @ 8e9cce7 baseline slot, record p95 plus 5xx |
| 2 | 50 | n/a | n/a | n/a | 2026-09-30 @ 8e9cce7 compare ELU plus waiting |
| 4 | 50 | n/a | n/a | n/a | 2026-09-30 @ 8e9cce7 watch checkpoint stall |
| 8 | 50 | n/a | n/a | n/a | 2026-09-30 @ 8e9cce7 IO-bound expected, do not grow pools |
- Fact: This revision holds runbook slots only; no ceiling certified. Peak server conns 65 (50 plus 15) below 200 leaves exporter plus migrate headroom.
## Finding / Interpretation (hedged)
- Interpretation: Prior 1k-RPS runs suggest 50/50/20/15 beats 100/70/30/10 for IO-bound workload; larger pools may add queueing without ELU relief.
- Interpretation: Pool exhaustion would show as 503 plus waiting growth while ELU stays below 0.8; CPU saturation shows ELU above 0.8 with flat waiting.
- Recommendation: Never promote ceiling to invariant without ADR; capacity numbers guide sizing discussions only.
## Status / Limitations
- Fact: Status stable methodology, expired authority; numbers expire 2027-03-30; methodology stays per FINAL-03 S6 plus PHASE2-13 S13.
- Fact: Limitations: single bench host NUMA plus noisy neighbor unchecked; prod traffic shape differs; checkpoint stall at 1k RPS noted in `.env.k6.example:101-102`.
- Uncertainty: FINAL-10 Q11 retention plus arm64 plus alloy pin unverified; telemetry loss may hide true ceiling, see `.agent/wiki-discovery/FINAL-10-OPEN-QUESTIONS.md` Q11.
- Uncertainty: FINAL-10 Q9 DLQ has no alert plus dashboard; capacity runs do not cover DLQ depth, see `.agent/wiki-discovery/FINAL-10-OPEN-QUESTIONS.md` Q9.
## Expiry / Supersession
- Fact: Expires 2027-03-30 (6mo); superseded-by null; supersede by adding new dated file on next capacity run, never editing in place.
- Fact: Route T9 last, never default; code plus report JSON win over prose.
## Refs
- Fact: Refs `k6/suites/capacity.js` plus `k6/config.js` plus `apps/api/src/cluster.ts` plus `pgbouncer/pgbouncer.ini` plus `GETTING_STARTED.md` plus `scripts/benchmark-report.mjs` plus `subsystems/k6-performance.md`.
