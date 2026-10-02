---
title: "Subsystem: Docker Environments (Images, Profiles, Health)"
type: subsystem
status: stable
authority: descriptive
owners: ["subsystems/docker-environments.md"]
sources: ["apps/api/Dockerfile.prod", "apps/api/Dockerfile.dev", "apps/web/Dockerfile.prod", "apps/web/Dockerfile.dev", "apps/migrate/Dockerfile", "docker-compose.yml", "docker-compose.observability.yml", ".dockerignore"]
depends_on: ["invariants/01-architecture-b.md", "invariants/07-health.md"]
guards: ["scripts/check-web-secrets.mjs", "scripts/check-web-auth-imports.mjs", "apps/api/test/integration/modules/health.integration.spec.ts"]
updated: 2026-10-01
expires: null
superseded-by: null
template: true
---
# Subsystem: Docker Environments (Images, Profiles, Health)
> Up: ../00-INDEX.md | Depends on: INV-01 (secret-free web), INV-07 (live versus ready throttled). Rules live in invariants, never copied here.
## 1. Ownership
**Fact:** Images owned by `apps/api/Dockerfile.dev` plus `Dockerfile.prod` (multi-stage runner) plus `apps/web/Dockerfile.dev` plus `Dockerfile.prod` (standalone) plus `apps/migrate/Dockerfile` (isolated workspace).
**Fact:** Runtime owned by `docker-compose.yml` (1176 lines, 5 profiles) plus `docker-compose.observability.yml` (412 lines, overlay) plus `.dockerignore` plus `nginx` edge plus `pgbouncer` config.
**Fact:** Contract owned by `.env.example` (343 lines) plus `turbo.json` passThroughEnv plus `app.module.ts` Joi plus `next.config.js` dotenv layering.
**Recommendation:** Change any Dockerfile or compose service MUST update this file and section matrix same PR.
## 2. Runtime
**Fact:** Single compose file with profiles prod dev local test e2e; proxy-base anchor shares nginx image plus cert gen plus NGINX env plus logs volume plus healthcheck.
**Fact:** Prod 8 services postgres redis pgbouncer migrate api web proxy pgadmin; dev 4 plus shared infra; test 4 hermetic; e2e 6 isolated prod-like behind TLS.
**Fact:** API prod stages are base plus pruner plus installer plus builder plus prod-deps plus runtime plus runner with USER node plus dumb-init plus wget HEALTHCHECK.
**Fact:** Web prod stages are base plus pruner plus installer plus builder with NEXT_PUBLIC ARGs plus runner with nextjs user plus standalone plus static plus public.
## 3. Public API
| Command | Shape | Source |
|---|---|---|
| compose prod up | slim images plus pgbouncer plus migrate job | docker-compose.yml prod |
| compose dev up | bind mount turbo dev with polling | Dockerfile.dev services |
| compose test up | tmpfs hermetic abort on exit | test profile |
| compose e2e up | env-file e2e plus TLS 8443 | e2e profile |
| overlay up | add observability file plus profile | observability yml |
**Fact:** Migrate image CMD is `prisma migrate deploy` with CHECKPOINT_DISABLE plus HIDE_UPDATE; boot gate `prisma version` fails build if prune broke CLI.
## 4. Dependency direction
**Fact:** Allowed: api into postgres via pgbouncer 6432 plus direct 5432 for migrate; web into api healthy; proxy into api plus web healthy; overlay adds alloy healthy.
**Fact:** Forbidden: images MUST NOT copy `.env`; web MUST NOT receive DATABASE_URL or BETTER_AUTH_SECRET; base MUST NOT depend on alloy (overlay only).
| Check | Grep |
|---|---|
| No env in image | rg -n "COPY.*\.env" apps/api/Dockerfile.prod apps/web/Dockerfile.prod, expect empty |
| Secret-free web | rg -n DATABASE_URL docker-compose.yml, expect only api migrate sections |
| Overlay only alloy | rg -n alloy docker-compose.yml, expect only comment |
## 5. Security posture
**Fact:** USER node for api migrate and nextjs 1001 for web; ENTRYPOINT dumb-init for PID1 reaping plus signal forwarding; api runner removes yarn npm corepack binaries.
**Fact:** Expose not ports for api web internal; only postgres redis pgadmin proxy alloy prometheus publish 127.0.0.1 mapped; prod proxy 80 443, dev e2e 8080 8443.
**Fact:** Postgres redis passwords via fail-fast VAR; pgadmin binds 127.0.0.1 SSH tunnel only; cAdvisor read-only plus tmpfs plus no published port.
**Fact:** Builder uses placeholder DATABASE_URL DIRECT_URL without connection; real creds arrive via compose environment at runtime, never build ARG cache.
## 6. Failure modes
**Fact:** Missing fail-fast VAR fails compose interpolation before start; missing Joi key fails api boot listing every key with abortEarly false.
**Fact:** Ready-probe misuse wedges web proxy forever because busybox wget exits non-zero on 503; keep HEALTHCHECK on live only, poll ready in seed orchestration.
**Fact:** Wrong DATABASE_URL pooler versus direct breaks migrate locks or app pooling; empty-string tuning without digits-only parse would zero budgets guarded by parseIntEnv throw.
**Fact:** Stale e2e-postgres volume causes seed password mismatch mitigated by TRUNCATE-first seed; tmpfs test avoids this class entirely.
## 7. Performance
**Fact:** Pool math is two inequalities: workers times POOL_MAX within PGBOUNCER_MAX_CLIENT_CONN and pooler DEFAULT plus RESERVE below POSTGRES_MAX; default pool 10, k6 50.
**Fact:** Scale signal is eventloop utilization above 0.8 raise workers up to cores or 8; per-worker instance id keeps rate exact.
**Fact:** Dev uses HMR polling CHOKIDAR plus WATCHPACK plus TSC dynamic polling for Docker Desktop events; never use dev images for load measurement.
**Fact:** Prod trim removes prisma react visx d3 mysql effect elkjs remeda plus non-postgres runtimes; boot smoke guards trim list after two wrong guesses.
## 8. Config/Env
**Fact:** Compose sole injection via environment, never copied env file; pruner copies source but runner only COPYs dist plus node_modules.
**Fact:** Syntax VAR fail-fast required for HOST PORT POSTGRES BETTER_AUTH APP OTEL GIT_SHA REDIS PROM; VAR empty optional for TRUSTED RESEND GOOGLE THROTTLE POOL EMAIL_VERIFICATION.
**Fact:** Per-service mapping: api gets pooler plus direct plus REDIS plus OTEL Pyroscope plus auth rate; web gets only NEXT_PUBLIC plus OTEL_DISABLED plus Faro; migrate gets only DIRECT plus DATABASE direct.
**Fact:** NEXT_PUBLIC baked as builder ARG requires rebuild; runtime ENV secrets plus OTEL plus pool need recreate only; GIT_SHA maps to service version plus Faro version.
## 9. Testing/verification
**Fact:** Health integration proves live 200 anonymous plus ready checks plus 210 sequential hits must 429; run test integration all.
**Fact:** `check-web-secrets --strict` scans standalone for DATABASE_URL PGPASSWORD PGUSER PGHOST; default report-only exits 0, CI must use strict.
**Fact:** `check-web-auth-imports` rejects runtime auth root after masking type-only; allows roles permissions password-policy subpaths.
**Recommendation:** After Dockerfile profile change run compose lint plus e2e boot plus migrate DIRECT_URL plus rebuild NEXT_PUBLIC test.
## 10. Extension pointer
**Recommendation:** Add infra service by picking profiles plus network alias plus volume plus healthcheck plus depends_on plus env injection together.
**Recommendation:** Add env var by choosing fail-fast versus empty deliberately plus turbo passThrough plus Joi plus requireEnv plus example row plus guard update.
**Recommendation:** Follow workflows change-docker-env.md future for profile Dockerfile env Joi turbo guards ARG-versus-ENV checklist.
## 11. AI-guidance
MUST: keep HEALTHCHECK on live with PORT fallback; keep depends_on healthy plus completed never started; keep stop_grace 30s above drain 20s.
MUST: keep pgbouncer for runtime and direct for migrate; keep NEXT_PUBLIC ARG versus runtime ENV split; keep publishes loopback-bound.
MUST-NOT: gate HEALTHCHECK or depends_on on ready; publish postgres redis publicly; pass secrets as ARG; combine prod plus monitoring profiles.
## 12. Common mistakes
**Interpretation:** Changing api HEALTHCHECK to ready deadlocks web and proxy on warm-up blips; liveness-only is correctness not laxity.
**Interpretation:** Passing new var without turbo passThrough surfaces as silent undefined in cached tasks; add to every task same PR.
**Interpretation:** Reusing env file for e2e mixes ports creds and TLS; always use env-file e2e with isolated 5434 6381 plus 8080 8443.
**Interpretation:** Adding second appending proxy outside RFC1918 breaks CIDR versus hop agreement for IP attribution; revisit both client-ip files.
## 13. Related
Invariants: INV-01 secret-free web, INV-07 health pointers only. Flows: flows/migration.md, flows/e2e.md future. Subsystems: env-config.md, api-runtime.md, web-runtime.md, observability-infra.md. Workflows: change-docker-env.md, add-model.md future. ADRs: ADR-0005 live-only, ADR-0008 migrate future.
## 14. Refs
apps/api/Dockerfile.prod, apps/api/Dockerfile.dev, apps/web/Dockerfile.prod, apps/web/Dockerfile.dev, apps/migrate/Dockerfile, apps/migrate/package.json, docker-compose.yml, docker-compose.observability.yml, .dockerignore, nginx/nginx.conf, pgbouncer/pgbouncer.ini, .env.example, .env.e2e.example, .env.test.example, .env.k6.example, turbo.json, apps/api/src/app.module.ts, apps/api/src/main.ts.
> **Uncertainty:** E2E app.e2e-spec slash versus api prefix drift is unverified. See .agent/wiki-discovery/FINAL-10-OPEN-QUESTIONS.md Q1; run stub suite and fix or delete before trusting e2e profile green.
> **Uncertainty:** OTel exporter versus Alloy compat plus Tempo retention plus Pyroscope arm64 is unverified. See FINAL-10-OPEN-QUESTIONS.md Q11; pin alloy sha plus document retention plus check build logs.
> **Uncertainty:** Resend dummy-OAuth host-rewrite assume CIDR hop agreement that breaks if LB added. See FINAL-10-OPEN-QUESTIONS.md Q13; open ADR when topology changes, do not patch ad hoc.
| Profile | Services | Ports |
|---|---|---|
| prod | postgres redis pgbouncer migrate api web proxy | 80 443 |
| dev | api-dev web-dev proxy-dev plus infra | 8080 8443 |
| test | postgres-test redis-test migrate-test api-test | 5433 6380 |
| e2e | postgres-e2e redis-e2e migrate-e2e api-e2e web-e2e proxy-e2e | 8080 8443 5434 6381 |
| local | host apps plus docker infra | localhost |
**Fact:** One file prevents drift; profiles select shape without duplicating base definitions.
**Recommendation:** Keep this file 120-200 lines; link invariants, never copy rules; bump updated on every content PR.
| Health | Probe | Gate |
|---|---|---|
| postgres | pg_isready | healthy daemon |
| redis | redis-cli ping PONG | healthy daemon |
| api | wget live | healthy liveness only |
| web | wget root | healthy via api |
| migrate | completed | completed success |
**Fact:** Two conditions are service_healthy for daemons and service_completed for one-shot migrate; no started race.
**Recommendation:** New service MUST declare healthy or completed; never rely on restart to paper ordering.
### Verification commands
**Fact:** Run compose config lint plus e2e boot plus health integration plus both web guards after profile change.
**Recommendation:** Record prod image sizes in PRs; set web proxy grace; promote secrets strict to CI fail.
**Fact:** Network is single app-network bridge with aliases per service; host reaches via 127 mapped ports.
**Recommendation:** Never publish postgres redis publicly; keep grace above drain timeout.
**Fact:** Dev volumes shadow bind mount node_modules for perf; turbo prune keeps build contexts minimal.
**Recommendation:** Use dev profile for iteration; never use dev images for load measurement.
**Fact:** Code wins over wiki; Dockerfiles plus compose plus turbo plus Joi win over prose.
**Recommendation:** Keep this file 120 lines minimum per subsystem size gate.
**Fact:** Migrate uses DIRECT_URL 5432 direct; runtime uses DATABASE_URL 6432 pooler with pgbouncer true.
**Fact:** Overlay merge adds alloy healthy to proxy and web only when overlay file included.
**Recommendation:** Always include overlay for prod dev local perf runs; omit for test e2e.
**Fact:** Local means apps on host with load-env layering, infra in docker via local profile.
**Recommendation:** Verify both pnpm dev and compose dev boot after env list change.
