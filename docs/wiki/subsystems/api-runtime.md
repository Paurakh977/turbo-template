---
title: "Subsystem: API Runtime (Nest Bootstrap, Cluster, ALS, Health)"
type: subsystem
status: stable
authority: descriptive
owners: ["subsystems/api-runtime.md"]
sources: ["apps/api/src/main.ts", "apps/api/src/app.module.ts", "apps/api/src/cluster.ts", "apps/api/src/common/request-context.ts", "apps/api/src/common/request-context.interceptor.ts", "apps/api/src/health/health.controller.ts"]
depends_on: ["invariants/03-request-context.md", "invariants/07-health.md"]
guards: ["apps/api/test/integration/modules/health.integration.spec.ts", "apps/api/test/integration/modules/middleware.integration.spec.ts", "apps/api/test/integration/modules/security-regression.integration.spec.ts"]
updated: 2026-10-01
expires: null
superseded-by: null
template: true
---
# Subsystem: API Runtime (Nest Bootstrap, Cluster, ALS, Health)
> Up: ../00-INDEX.md | Depends on: INV-03 (request-context), INV-07 (health). Rules live in invariants, never copied here.
## 1. Ownership
**Fact:** Owned by apps/api/src/main.ts (sole prod entry, 188 lines) plus app.module.ts (209 lines, Joi plus throttler plus auth mount), cluster.ts (168 lines, workers), common/request-context.ts plus request-context.interceptor.ts (ALS lifecycle), health/health.controller.ts (97 lines, live versus ready).
**Fact:** Supporting owners: otel.ts (SDK identity), load-env.ts (env overlay), observability.interceptor.ts (span-only), http-exception.filter.ts (envelope).
**Recommendation:** Change bootstrap, guard, interceptor, or probe only in these files; mirror pipeline edits in test/integration/helpers/test-app.ts the same PR.
## 2. Runtime
**Fact:** Entry is node dist/main (Dockerfile.prod) calling runWithCluster(bootstrap) (main.ts:188); API_WORKERS=1 runs bootstrap directly, greater than 1 forks N workers sharing the listen port (cluster.ts:68-78).
**Fact:** main.ts order is load-bearing: load-env then otel (1-2), bodyParser false (23-25), trust proxy 1 (34), ALS middleware FIRST (43), catch-all metrics (48-71), auth-event metrics for auth paths only (73-104), helmet (107-123), compression (126), prefix api (128), ValidationPipe (130-136), HttpExceptionFilter (138), CORS allowlist (158-178), shutdown hooks (180), listen (182-183).
**Fact:** requestContextMiddleware runs storage.run(createRequestContext(), next) so guards through handlers execute inside one ALS store per request (request-context.ts:72-77); the interceptor copies req.session into ALS read-only after guards (interceptor:26-48).
**Fact:** Better Auth api/auth paths mount as raw Express middleware and bypass both Nest interceptors (main.ts:74-76); only ALS store plus HTTP plus auth-event metrics apply there.
## 3. Public API
**Fact:** All Nest controllers sit under /api (setGlobalPrefix api); AppController hello is routing smoke only.
| Endpoint | Contract | Source |
|---|---|---|
| GET /api/health/live | status ok, no Redis or PG touch, throttled never skipped | health.controller.ts:50-53 |
| GET /api/health/ready | status ready plus checks, or 503 with redacted checks | health.controller.ts:55-96 |
**Fact:** Errors use the HttpExceptionFilter envelope with statusCode, timestamp, path applied AFTER body to block spoofing (http-exception.filter.ts:79-86); 500 and above redacted to Internal server error.
## 4. Dependency direction
**Fact:** Allowed: main.ts into app.module.ts into feature modules (Notes, Users, Audit, Links, Health, ServerActionRateLimit); middleware into ALS store; interceptor reads req.session never resolves it; AuditQueueModule imported exactly once as Global singleton (app.module.ts:148).
**Fact:** Forbidden: controllers MUST NOT call getSession again; interceptors MUST NOT throw or write sessions; queue workers MUST NOT read ALS (undefined by design, capture at emit via buildAuditRowData).
| Check | Grep |
|---|---|
| No duplicate guard | rg -n UseGuards AuthGuard apps/api/src, expect only comments |
| No re-resolution | rg -n getSession apps/api/src/notes apps/api/src/users apps/api/src/audit, expect empty outside comments |
| Health throttled | rg -n SkipThrottle apps/api/src/health, expect empty |
## 5. Security posture
**Fact:** Global vendor AuthGuard denies by default; only health and links carry AllowAnonymous (full boundary in subsystems/security.md; this file states wiring, not the rule).
**Fact:** Helmet (frameguard deny, noSniff, referrer strict-origin-when-cross-origin, HSTS prod-only) plus CORS allowlist (NEXT_PUBLIC_APP_URL, BETTER_AUTH_URL, TRUSTED_ORIGINS, dev-only localhost) plus ValidationPipe transform plus whitelist plus forbidNonWhitelisted, all in main.ts:107-178.
**Fact:** disableTrustedOriginsCors true (app.module.ts:173-184) keeps exactly one CORS owner; 2mb body limits live on the Auth vendor mount (app.module.ts:180-183).
## 6. Failure modes
**Fact:** Redis blip: ready returns 503 redis error, live stays 200; container stays healthy because HEALTHCHECK hits live only.
**Fact:** PG down: ready returns 503 database error, live stays 200; ping plus SELECT 1 race uses a 1500 ms unref timeout cleared in finally (health.controller.ts:63-96).
**Fact:** Worker crash: primary reforks with sliding-window backoff (MAX_CRASHES 5 per 60s, delay 1000 times crashes ms, unref); above 5 exits 1 so compose restarts; intentional disconnect drains then exits 0 (cluster.ts:89-144).
**Fact:** SIGTERM: worker.disconnect stops accepts, drains HTTP plus audit 20s plus OTel inside the 30s compose grace (cluster.ts:146-167); OTel shutdown uses process.once to avoid double-invoke (otel.ts:198-201).
## 7. Performance
**Fact:** Pool budgets are two independent inequalities (cluster.ts:33-53): workers times DATABASE_POOL_MAX within PGBOUNCER_MAX_CLIENT_CONN, and pooler DEFAULT plus RESERVE below POSTGRES_MAX; default worker pool 10, k6 profile 50.
**Fact:** Scale signal is nodejs_eventloop_utilization_ratio sustained above 0.8 (CPU-bound, raise API_WORKERS up to cores or 8) with eventloop_delay answering queue wait; per-worker service.instance.id keeps Prometheus rate exact (otel.ts:66-85).
**Fact:** normalizeRouteForMetrics collapses IDs (long alphanumerics and digits to :id); every static segment stays under 20 chars, locked by normalize-route.spec.ts.
## 8. Config/Env
**Fact:** Single validator is ConfigModule Joi in app.module.ts:65-145 (abortEarly false lists every missing key); parseThrottleInt rejects empty-string-via-compose and non-digits (app.module.ts:40-51).
**Fact:** Required: HOST, PORT, DATABASE_URL, REDIS_URL, NEXT_PUBLIC_APP_URL, BETTER_AUTH_URL, BETTER_AUTH_SECRET min 32, APP_NAME, plus OTel keys unless OTEL_SDK_DISABLED true; THROTTLE_TTL_MS default 60000 and THROTTLE_LIMIT default 200 fall back via parser.
**Fact:** API_WORKERS defaults 1 cap 8; K6_TESTING true layers .env.k6 over .env (load-env.ts:8-10); Docker injects env via environment, never a copied .env file.
## 9. Testing/verification
**Fact:** Unit: request-context.spec.ts (ALS isolation plus memo), http-exception.filter.spec.ts (envelope plus 500 redaction), normalize-route.spec.ts (bounded cardinality); run pnpm --filter api test.
**Fact:** Integration real DI plus DB plus Redis: health (live 200 anonymous, ready checks), middleware (helmet plus prefix 404 on health/live plus envelope), security-regression (210 sequential health hits must 429), redis-failure plus database-failure (ready 503 versus live 200); run pnpm --filter api test:integration:all.
**Fact:** test-app.ts mirrors trust proxy, helmet, compression, prefix, pipe, filter, CORS but does NOT install ALS or metrics middlewares, so integration runs guards and interceptors with getRequestContext undefined (direct DB reads).
## 10. Extension pointer
**Recommendation:** Add a new global pipe, filter, guard, or interceptor by editing main.ts or app.module.ts, mirroring it in test-app.ts, and adding one integration assertion (anonymous 401, envelope shape, or 429 contract) the same PR; domain path in workflows/add-domain-module.md (future).
**Recommendation:** Add a new probe only as live (no deps) or ready (deps with redacted 503); never gate Docker HEALTHCHECK or compose depends_on on ready (deadlock, INV-07).
## 11. AI-guidance
MUST: keep ALS middleware first; keep bodyParser false with vendor 2mb limits; keep disableTrustedOriginsCors true; keep health throttled with no SkipThrottle; keep AuditQueueModule imported once; keep service.instance.id per worker; keep abortEarly false.
MUST-NOT: add controller-level AuthGuard; call getSession downstream; read ALS in workers or pollers; add express.json in main.ts; gate health on ready; cache roles module-level.
## 12. Common mistakes
**Interpretation:** Moving ALS after metrics for cleaner logs breaks getRequestContext for every earlier layer (main.ts:43 comment).
**Interpretation:** Adding SkipThrottle to health so probes never 429 re-opens the flood exemption and breaks the security-regression 210-hit contract (see INV-07).
**Interpretation:** Reading session.user.role to save a DB round-trip re-opens stale elevation up to session TTL; use getFreshRoleRaw (see rbac-rules-users.md).
**Interpretation:** Caching roles in a module Map with TTL recreates the same bug globally, including for banned users (see INV-03).
## 13. Related
Invariants: INV-03 request-context, INV-07 health (pointers only, rules not repeated). Flows: flows/authenticated-api.md (full hop table, future). Subsystems: rbac-rules-users.md, audit.md, security.md, redis.md plus nginx-edge.md (future). Workflows: add-domain-module.md (future). ADRs: ADR-0001 cluster, ADR-0005 live-only healthcheck (future).
## 14. Refs
apps/api/src/main.ts, apps/api/src/app.module.ts, apps/api/src/cluster.ts, apps/api/src/load-env.ts, apps/api/src/otel.ts, common/request-context.ts, common/request-context.interceptor.ts, observability/observability.interceptor.ts, observability/metrics.service.ts, common/http-exception.filter.ts, common/session.utils.ts, common/client-meta.ts, health/health.controller.ts, health/health.module.ts, test/integration/helpers/test-app.ts, Dockerfile.prod, Dockerfile.dev.
> **Uncertainty:** Non-auth large-body limit with bodyParser false is unverified; no explicit express.json limit exists in main.ts and the vendor 2mb mount may not cover domain routes. See .agent/wiki-discovery/FINAL-10-OPEN-QUESTIONS.md Q2; do not assert a limit, add an integration large-body test before changing parsers.
> **Uncertainty:** Relative order of the two APP_INTERCEPTORs is unpinned; both are non-mutating today so order is immaterial. See FINAL-10-OPEN-QUESTIONS.md Q3; pin order or comment plus test if either ever mutates.
> **Uncertainty:** OTel exporter versus Alloy compatibility, Tempo retention, and Pyroscope arm64 behavior are unverified with alloy latest unpinned. See FINAL-10-OPEN-QUESTIONS.md Q11; do not assert pipeline semantics here.
### Bootstrap order reference
| Order | Layer | File:Symbol | Note |
|---|---|---|---|
| 0 | Env then OTel | load-env.ts, otel.ts:3-6 | OTel requireEnv reads env, never import Nest or pg here |
| 1 | ALS store | main.ts:43 requestContextMiddleware | FIRST middleware, guards through handlers inside store |
| 2 | HTTP metrics | main.ts:48-71 | finish hook, skips logger.info for live probes only |
| 3 | Auth-event metrics | main.ts:73-104 | Only slash auth paths, raw-mount bypass note |
| 4 | Helmet, compression | main.ts:107-126 | CSP false JSON API, CORP cross-origin, gzip br |
| 5 | Prefix, pipe, filter, CORS | main.ts:128-178 | api prefix, whitelist pipe, envelope filter, single CORS |
| 6 | Shutdown, listen, cluster | main.ts:180-188 | enableShutdownHooks, listen host port, runWithCluster |
### Guard and interceptor contracts
**Fact:** Nest order is middleware, guards, interceptors, handler; the interceptor comment (app.module.ts:201-203) confirms req.session is settled before RequestContextInterceptor copies it.
**Fact:** ThrottlerGuard (APP_GUARD, Redis storage fail-open) runs before vendor AuthGuard; unauthenticated non-anonymous requests 401 after throttler accounting.
**Fact:** ObservabilityInterceptor sets ROUTE_TEMPLATE and FEATURE plus status on the active span only when isRecording; HTTP counts and durations stay in Express middleware so 404s and unmatched routes are captured.
### Shutdown and drain budgets
| Budget | Value | Owner |
|---|---|---|
| Poll plus purge timers | unref | audit-queue.service.ts, health.controller.ts timeout |
| Audit drain | 20s race inFlight plus flush | audit-outbox.ts, audit-queue.service.ts:200-217 |
| Docker grace | 30s stop_grace_period | docker-compose.yml, cluster.ts:156-157 |
| Refork backoff | 1s times crashes, 5 per 60s cap | cluster.ts:89-144 |
**Recommendation:** Keep drain below grace with margin; uncleared timers keep the loop hot and delay SIGTERM.
### Middleware mirror checklist
**Fact:** test-app.ts MUST mirror trust proxy, helmet flags, compression, global prefix, ValidationPipe flags, HttpExceptionFilter, and CORS origin callback; it MUST NOT install ALS or metrics middlewares (integration then proves guards without the store).
**Recommendation:** Diff main.ts against test-app.ts in every runtime PR; a drifted mirror gives false confidence on ALS versus direct-read behavior.
### Verification commands
**Fact:** Run pnpm --filter api test for unit, test:integration for the default suite, test:integration:all for the full matrix including strict and oauth, and test:e2e for the stub routing tier.
**Fact:** Compose profiles: test runs tmpfs postgres plus 64mb redis plus migrate-test plus api-test; e2e runs iso postgres plus redis plus api-e2e plus web-e2e plus proxy-e2e on 8080 plus 8443 with env-file isolation.
**Recommendation:** Keep HEALTHCHECK on live with PORT fallback expansion; verify depends_on service_healthy chains resolve web and proxy startup order.
**Recommendation:** Re-check pool math before raising API_WORKERS; prefer replicas past core count per the cluster safety comment.
### Testing and extension aide
**Fact:** Guards plus specs matrix: unit plus integration default plus full all plus stub e2e tiers; web e2e health plus proxy slices cover edge behavior; k6 public-flow covers live plus ready under load.
**Recommendation:** Touching bootstrap, CORS, helmet, prefix, pipe, filter, cluster, OTel identity, or health MUST run middleware plus health plus security-regression plus database-failure plus redis-failure suites.
**Recommendation:** New domain module reuses this runtime unchanged: add the feature import alongside NotesModule, keep controllers thin with validated DTOs plus extractClientMeta, keep services on fresh-role plus assertPermission.
**Recommendation:** New background worker MUST NOT read ALS; capture request values at emit (requestId, userId, clientMeta) and pass them explicitly, following buildAuditRowData.
**Interpretation:** Adding express.json with a limit to fix large bodies duplicates the vendor parser and double-parses auth routes; resolve via the FINAL-10 Q2 test first, then a single owned parser if proven needed.
**Interpretation:** Gating compose depends_on on ready instead of live deadlocks web and proxy on warm-up blips; keep liveness-only HEALTHCHECK per INV-07.
**Recommendation:** Prefer editing existing middleware order comments over reordering: each position carries a why comment and deleting a comment deletes the decision record.
**Recommendation:** When adding env, add the Joi entry plus test setup mirror plus turbo passThroughEnv plus .env.example row in the same PR.
**Fact:** Dockerfile.prod stages (pruner, installer, builder with placeholder URLs, prod-deps, runtime relink, runner dumb-init plus wget) keep the image slim with USER node and EXPOSE 3001 only.
**Recommendation:** Keep builder placeholder DATABASE_URL and DIRECT_URL never connecting; real connection strings arrive via compose environment at runtime.
