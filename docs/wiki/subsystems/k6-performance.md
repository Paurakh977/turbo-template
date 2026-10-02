---
title: "Subsystem: k6 Performance (Suites, Thresholds, Methodology Only)"
type: subsystem
status: stable
authority: descriptive
owners: ["subsystems/k6-performance.md"]
sources: ["k6/config.js", "k6/suites/smoke.js", "k6/suites/load.js", "k6/suites/stress.js", "k6/suites/spike.js", "k6/suites/soak.js", "k6/scenarios/auth-flow.js", ".env.k6.example", "scripts/benchmark-report.mjs"]
depends_on: ["invariants/06-rate-limits.md", "invariants/08-observability.md"]
guards: ["k6/suites/smoke.js", "k6/config.js", "scripts/benchmark-report.mjs"]
updated: 2026-10-01
expires: null
superseded-by: null
template: true
---
# Subsystem: k6 Performance (Suites, Thresholds, Methodology Only)
> Up: ../00-INDEX.md | Depends on: INV-06 (rate-limits), INV-08 (observability). Rules live in invariants, never copied here.
## 1. Ownership
**Fact:** Owned by `k6/config.js` (130 lines, BASE_URL plus USERS plus THRESHOLDS plus THINK plus MIX) plus `k6/suites/` (smoke, load, stress, spike, soak, capacity, edge-cases) plus `k6/scenarios/` (auth, notes, audit, public, rate-limit, web, edge).
**Fact:** Helpers owned by `k6/helpers/` (auth, http, data, setup, summary) plus `k6/run.sh` plus `run.ps1` plus `scripts/benchmark-report.mjs` (report generator); env overlay owned by `.env.k6.example` (139 lines).
**Recommendation:** Change suite, scenario, threshold, or helper only in these files; mirror traffic-mix changes in both load and capacity suites same PR.
## 2. Runtime
**Fact:** k6 runs from host against `https://localhost` (nginx 443) by default via `BASE_URL` env; suites use arrival-rate plus VU schedulers per `k6/suites/*.js` defaults with `LOAD_QUICK` plus `SOAK_DURATION` overrides.
**Fact:** Auth helper logs in as SEED_ADMIN plus USER from env (never real mailboxes); fallbacks match `.env.example` placeholders only for template runs.
**Fact:** No X-Bypass header exists; k6 runs against real limits with 429 as expected (see `k6/config.js:23-30` comment plus nginx no-bypass design).
**Interpretation:** Methodology tests the shielded system as users see it; bypassing would measure an unshielded backend that never serves prod.
## 3. Public API
**Fact:** Commands are `pnpm k6:smoke` plus `k6:load` plus `k6:stress` plus `k6:spike` plus `k6:soak` plus `k6:capacity` plus `k6:edge`; reports via `node scripts/benchmark-report.mjs` over `results/*.summary.json`.
| Suite | Intent | Gate |
|---|---|---|
| smoke | single-VU correctness | p95 under 500, p99 under 1000, 5xx under 1pct |
| load | sustained mixed traffic | p95 under 400, p99 under 800, checks over 99pct |
| spike | flood plus 429 visibility | 5xx under 5pct, checks over 99pct |
| soak | leak plus drift | p95 under 300, p99 under 600 |
| capacity | ceiling measure, no latency gate | checks over 95pct, drops zero |
**Fact:** Thresholds gate only 5xx plus checks plus drops; 429 is report-only (`count>=0` always passes, count visible) so shield firing never fails suite.
## 4. Dependency direction
**Fact:** Allowed: suites into scenarios into helpers into config; benchmark-report into results JSON; .env.k6 into host-run apps plus compose --env-file stacks.
**Fact:** Forbidden: suite importing prod secrets; scenario bypassing real limits; threshold asserting on 429 rate or on exact RPS/p95 as invariant.
| Check | Grep |
|---|---|
| No bypass | rg -n "X-Bypass|bypass" k6/, expect only no-bypass comments |
| Single threshold source | rg -n "THRESHOLDS" k6/config.js k6/suites, expect config only defines |
| Env-only creds | rg -n "SEED_ADMIN|USER_EMAIL" k6/config.js, expect env with fallback only |
## 5. Security posture
**Fact:** k6 uses template mailboxes (`admin@yourapp.com`, `user@yourapp.com`) from `.env.k6`; never commit real mailboxes or prod secrets for load runs.
**Fact:** Seed admin plus plain user cover superAdmin plus user roles; 2FA plus OAuth plus DLQ admin paths are out of load scope (covered by integration).
**Fact:** TLS targets self-signed localhost; host runs honor `NODE_TLS_REJECT_UNAUTHORIZED=0` only for local load, never prod.
## 6. Failure modes
**Fact:** Dead backend would exit 0 on 5xx-only thresholds if no 5xx-tagged requests exist; every suite also gates on `checks rate over 0.99` so 100pct failures fail.
**Fact:** Arrival-rate suites gate on `dropped_iterations count==0` (capacity) so scheduler overload is visible instead of silent under-load.
**Fact:** 429 storms are expected under spike (intentional); report-only threshold keeps count visible while 5xx gate proves backend stayed correct.
**Fact:** Pool exhaustion under load shows as 503 plus waiting growth (see database-package stats); ELU over 0.8 sustained is scale signal, not pool growth alone.
## 7. Performance
**Fact:** Think times single-sourced in `THINK_TIME_S` (smoke 2s, load 0.5 plus jitter, stress 0.2, spike 0.1, soak 1s); traffic mix in `TRAFFIC_MIX` (load 40/35/15/10, capacity notes-heavy).
**Fact:** Load p95/p99 gates (400/800) are suite health checks, not SLO promises; capacity has no latency gate because breaking point is expected slow.
**Fact:** k6 pools sized 50/1000/50/20/15 beat 100/70 in 1k-RPS runs (IO-bound, see .env.k6.example:75-77); grow pools only with benchmark proof attached.
**Fact:** Per-worker `service.instance.id` keeps Prometheus rate exact under API_WORKERS matrix 1/2/4/8 (see api-runtime plus ADR-0001 future).
## 8. Config/Env
**Fact:** `.env.k6.example:38-86` sets K6_TESTING true plus flood-gate opens (RATE 2M, THROTTLE 2M, NGINX 20000r/m plus 2000r/s, pools 50/1000/50/20/15) for shared-IP generators.
**Fact:** Host-run mode layers `.env.k6` over `.env` when K6_TESTING true (load-env.ts); container-stack mode uses `--env-file .env.k6` and needs full OTEL plus GIT plus GF keys.
**Fact:** `API_WORKERS` matrix runbook is 1 baseline then 2 then 4 then 8 with `pnpm k6:capacity` each plus recreate api only (no rebuild needed).
## 9. Testing/verification
**Fact:** k6 suites are the verification for rate-limit plus perf routes (T5 plus T9); integration `performance.integration.spec.ts` guards pool comments plus normalizeRoute cardinality.
**Fact:** `k6/tests/runner-contract.mjs` locks suite contract (threshold keys plus think keys plus mix sums to 1); `helpers/summary.js` shapes `results/*.summary.json`.
**Fact:** `scripts/benchmark-report.mjs` renders methodology plus labeled results (date plus commit plus env); never enshrine numbers as targets without ADR.
**Recommendation:** After suite or threshold change run `k6:smoke` plus `k6:load` quick plus `benchmark-report.mjs` before merge; attach summary JSON to PR.
## 10. Extension pointer
**Recommendation:** Add scenario by copying `public-flow.js` (unauth) or `notes-flow.js` (authed CRUD) plus helper trio plus checks plus 429 visibility, then wire suite weight same PR.
**Recommendation:** Add suite only with intent plus gate plus duration plus mix justification; capacity measures ceiling, edge asserts 4xx shapes, soak asserts no leak.
**Recommendation:** Follow workflows/add-rate-limited-action.md (future) for k6 429-visibility step plus NGINX plus customRules plus throttler plus SCOPES.
## 11. AI-guidance
MUST: keep methodology-only (commands plus config re-runnable); keep 429 expected (report-only), only 5xx plus checks plus drops gate; keep no-bypass.
MUST: keep thresholds single-sourced in config.js; keep think plus mix single-sourced; keep results labeled date plus commit plus env, never as invariant.
MUST-NOT: paste results JSON into subsystem file (link paths, research holds dated numbers); promote numbers without ADR; assert exact RPS as pass-fail.
MUST-NOT: run k6 against prod with prod rates lowered for convenience; use .env.k6 overlay on isolated bench host, never prod.
## 12. Common mistakes
**Interpretation:** Treating p95 gates as SLOs and failing deploys on 10ms drift confuses suite health with user contract; gates catch regressions, not promises.
**Interpretation:** Adding 429 to failure thresholds to make shield visible fails every spike run by design; 429 visibility is report-only by intent.
**Interpretation:** Bypassing nginx for direct-to-api load to get higher RPS measures an unshielded path users never hit; always target 443 via nginx.
**Interpretation:** Growing pools to 100/70 after seeing queueing without ELU plus benchmark proof repeats the IO-bound regression noted in pgbouncer.ini.
## 13. Related
Invariants: INV-06 rate-limits plus INV-08 observability (429 expected plus ELU plus normalize; rules not repeated). Flows: flows/rate-limited.md plus flows/authenticated-api.md (future). Subsystems: redis.md plus nginx-edge.md plus api-runtime.md. Workflows: add-rate-limited-action.md (future). ADRs: ADR-0001 cluster plus ADR-0009 no-bypass (future). Research: research/2026-09-k6-baseline.md plus capacity-notes.md (future, numbers expire).
## 14. Refs
k6/config.js, k6/suites/smoke.js, k6/suites/load.js, k6/suites/stress.js, k6/suites/spike.js, k6/suites/soak.js, k6/suites/capacity.js, k6/suites/edge-cases.js, k6/scenarios/auth-flow.js, k6/scenarios/notes-flow.js, k6/scenarios/rate-limit-flow.js, k6/scenarios/public-flow.js, k6/helpers/auth.js, k6/helpers/http.js, scripts/benchmark-report.mjs, .env.k6.example, .env.example.
> **Uncertainty:** OTel exporter vs Alloy compat plus Tempo retention plus Pyroscope arm64 are unverified with alloy latest unpinned. See .agent/wiki-discovery/FINAL-10-OPEN-QUESTIONS.md Q11; do not assert pipeline semantics for k6 telemetry correlation until pin plus retention docs land.
> **Uncertainty:** Benchmark numbers expire fastest; methodology stays. See PHASE2-13 S13 plus FINAL-03 S6; dated research files carry expires 6mo and never promote to invariant without ADR. This file holds methodology only, never results.
| File | Purpose | Gate |
|---|---|---|
| config.js | thresholds plus users plus mix | single source, no diverge |
| suites | smoke/load/stress/spike/soak | 5xx plus checks plus drops |
| scenarios | auth/notes/audit/public | checks plus 429 visibility |
| helpers | auth/http/data/setup | shared, no suite fork |
| benchmark-report | summary to markdown | labeled, never targets |
**Fact:** Methodology source is k6 suites plus scenarios plus config plus .env.k6.example plus benchmark-report.mjs; prose here is descriptive and code wins.
**Recommendation:** Keep this file 120-200 lines; link invariants, never copy rules; bump updated on every content PR per FINAL-09.
### Suite selector
| Goal | Run | Env |
|---|---|---|
| Correctness | pnpm k6:smoke | K6_TESTING true, host-run |
| Sustained | pnpm k6:load | .env.k6 overlay, 1500 maxVUs |
| Flood | pnpm k6:spike | spike asserts 429s fire |
| Leak | pnpm k6:soak | SOAK_DURATION 30m override |
| Ceiling | pnpm k6:capacity | workers matrix 1/2/4/8 |
### Methodology template (re-runnable)
**Fact:** Start local infra via local profile, set K6_TESTING true, run pnpm dev, then pnpm k6:smoke plus k6:load against https://localhost with .env.k6 layered.
**Fact:** Container stack via compose --env-file .env.k6 with prod profile, then pnpm k6:load from host; compose ignores root .env in this mode so full keys required.
**Recommendation:** Record commit plus env plus workers plus pools plus rates in every report header; unlabeled numbers are not comparable across runs.
**Fact:** Code wins over wiki; suites plus config plus report script win over prose per authority model.
**Recommendation:** Do not read whole wiki for perf work; follow task route T9 perf bundle in order per 00-INDEX (future).
### Capacity runbook excerpt
| Workers | Pool | Pooler peak | Result slot |
|---|---|---|---|
| 1 | 50 | 65 below 200 | baseline, record p95 plus 5xx |
| 2 | 50 | 65 below 200 | compare ELU plus waiting |
| 4 | 50 | 65 below 200 | watch checkpoint stall |
| 8 | 50 | 65 below 200 | IO-bound expected, do not grow pools |
**Fact:** Research files hold dated numbers with expires; subsystem holds methodology only per PHASE2-13 S13 rule 4.
**Recommendation:** Supersede research by adding new dated file, never editing old results in place.
**Fact:** Keep this file 120-200 lines; link invariants, never copy rules; bump updated on every content PR.
**Recommendation:** Touching suites or thresholds MUST update research pointer plus test-matrix plus INDEX router same PR when behavior changes.
