---
title: "2026-09 k6 Baseline (Smoke plus Load)"
type: research
status: stable
authority: expired
owners: ["subsystems/k6-performance.md"]
sources: ["k6/config.js", "k6/suites/smoke.js", "k6/suites/load.js", "k6/scenarios/auth-flow.js", "k6/scenarios/notes-flow.js", "k6/scenarios/public-flow.js", "scripts/benchmark-report.mjs", ".env.k6.example"]
depends_on: ["subsystems/k6-performance.md"]
guards: []
updated: 2026-09-30
expires: 2027-03-30
superseded-by: null
template: true
---
# 2026-09 k6 Baseline (Smoke plus Load)
> Up: ../00-INDEX.md | Expires: 2027-03-30 | Measured: 2026-09-30 @ 8e9cce7 | Env: prod profile, workers=2, pools 50/1000/50/20/15, PG 200
## Date
- Fact: Measured 2026-09-30 at commit 8e9cce7; env prod profile via compose with `.env.k6` overlay, BASE_URL https://localhost nginx 443.
- Fact: Runner `k6/run.sh` plus `run.ps1` pins `grafana/k6:0.57.0`; summaries land in `k6/results/*.summary.json` via `helpers/summary.js`.
## Scope
- Fact: Suites `k6/suites/smoke.js` (2 VUs 30s) plus `k6/suites/load.js` (10-25-50 VUs 7m, LOAD_QUICK short variant) only; stress/spike/soak/capacity out of scope here.
- Fact: Scenarios `public-flow.js` plus `auth-flow.js` plus `notes-flow.js` plus `audit-flow.js` plus `rate-limit-flow.js` plus `web-flow.js`; edge 4xx shapes covered by `edge-cases.js` separately.
## Source / Version
- Fact: Thresholds single-sourced in `k6/config.js:42-111` THRESHOLDS plus THINK_TIME_S plus TRAFFIC_MIX; suites import, never redefine.
- Fact: Versions: repo 8e9cce7, k6 0.57.0, `.env.k6.example` 139 lines, `scripts/benchmark-report.mjs` 32 lines; Alloy latest unpinned, see Uncertainty Q11.
- Fact: Commit 8e9cce7 baseline from `.agent/wiki-discovery/PHASE2-13-IMPLEMENTATION-BLUEPRINT.md`; `k6/config.js:23-30` documents no X-Bypass design.
## Methodology
- Fact: Host-run `K6_TESTING=true pnpm dev` layers `.env.k6` over `.env`; container stack uses `compose --env-file .env.k6` with full OTEL plus GF keys.
- Fact: Run `pnpm k6:smoke` then `pnpm k6:load` against https://localhost; thresholds gate 5xx-only plus checks; 429 report-only `count>=0` always passes.
- Fact: Smoke gates `p95<500 p99<1000 checks>0.99 5xx<1pct`; load gates `p95<400 p99<800 checks>0.99 5xx<1pct`; spike/stress/soak gates differ, see `k6/config.js:55-92`.
- Fact: Auth setup runs once via `helpers/setup.js` `setupAdminSession`; per-VU sign-in would saturate auth zone and invalidate run.
- Fact: Think `THINK_TIME_S` smoke 2s, load 0.5 plus jitter 1.5; mix load 40/35/15/10 public/notes/audit/auth must sum to 1.
- Fact: Render with `node scripts/benchmark-report.mjs` over results dir; prints `| suite | checks | p95 | p99 | failed | reqs | dropped |` markdown.
- Recommendation: Record commit plus workers plus pools plus rates in every report header; unlabeled numbers are not comparable across runs.
## Results (labeled, not targets)
| Suite | RPS | p95 | 5xx | 429 | Notes |
|---|---|---|---|---|---|
| smoke | n/a | n/a | 0 expected | expected | 2026-09-30 @ 8e9cce7, methodology only, no certified numbers |
| load | n/a | n/a | 0 expected | expected | 2026-09-30 @ 8e9cce7, run benchmark-report.mjs on next run to fill |
- Fact: This revision records methodology only; no RPS/p95 certified here. Numbers expire, methodology stays per PHASE2-13 S13.
## Finding / Interpretation (hedged)
- Interpretation: 5xx-only plus checks gates suggest backend correctness under shield; 429 visibility proves limiter fired without failing suite.
- Interpretation: Flood gates RATE 2M plus NGINX 20000r/m 2000r/s suggest load reaches app plus DB, not edge wall; needs measured run to confirm.
- Recommendation: Never promote numbers to invariant without ADR; treat p95 gates as suite health, not SLO promises.
## Status / Limitations
- Fact: Status stable methodology, expired authority; numbers (when recorded) expire 2027-03-30 and never gate deploys.
- Fact: Limitations: single bench host, template mailboxes only, 2FA/OAuth/DLQ admin paths not loaded, self-signed TLS with insecure-skip-verify locally.
- Uncertainty: FINAL-10 Q11 OTel exporter vs Alloy compat plus Tempo retention plus Pyroscope arm64 unverified; see `.agent/wiki-discovery/FINAL-10-OPEN-QUESTIONS.md` Q11.
## Expiry / Supersession
- Fact: Expires 2027-03-30 (6mo); superseded-by null; supersede by adding new dated `research/YYYY-MM-*.md`, never editing this file.
- Fact: Route T9 last, never default; code wins over prose; suites plus config plus report script win over this file.
## Refs
- Fact: Refs `k6/config.js` plus `k6/suites/smoke.js` plus `load.js` plus `k6/scenarios/` plus `k6/helpers/summary.js` plus `scripts/benchmark-report.mjs` plus `.env.k6.example` plus `subsystems/k6-performance.md`.
