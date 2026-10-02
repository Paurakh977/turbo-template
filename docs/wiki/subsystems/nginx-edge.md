---
title: "Subsystem: Nginx Edge (Zones, TLS, Health Exemption, Collect)"
type: subsystem
status: stable
authority: descriptive
owners: ["subsystems/nginx-edge.md"]
sources: ["nginx/nginx.conf", "nginx/entrypoint.sh", "docker-compose.yml", ".env.example", ".env.k6.example"]
depends_on: ["invariants/06-rate-limits.md", "invariants/07-health.md"]
guards: ["apps/api/test/integration/modules/security-regression.integration.spec.ts", "apps/api/test/integration/modules/health.integration.spec.ts"]
updated: 2026-10-01
expires: null
superseded-by: null
template: true
---
# Subsystem: Nginx Edge (Zones, TLS, Health Exemption, Collect)
> Up: ../00-INDEX.md | Depends on: INV-06 (rate-limits), INV-07 (health). Rules live in invariants, never copied here.
## 1. Ownership
**Fact:** Owned by `nginx/nginx.conf` (320 lines, zones plus upstreams plus TLS plus locations) plus `nginx/entrypoint.sh` (247 lines, validation plus envsubst plus rate injection) plus compose `proxy` service plus `NGINX_*` env rows.
**Fact:** Certs owned by `nginx/certs/localhost.crt` plus `.key` (self-signed local only); prod mounts real certs via `NGINX_SSL_CERT_FILENAME` plus key filename vars.
**Recommendation:** Change zone, burst, header, or TLS only in these files; mirror rate changes in `.env.example` plus `.env.k6.example` same PR.
## 2. Runtime
**Fact:** Worker model is `worker_processes auto` with `worker_connections 2048` plus `multi_accept on` (`nginx.conf:1-7`); keepalive 64 per upstream reuses TCP plus TLS to api and web.
**Fact:** Upstreams are `nextjs_client` (WEB_UPSTREAM_HOST plus PORT) and `nestjs_api` (API_UPSTREAM_HOST plus PORT), injected via envsubst from compose environment.
**Fact:** Port 80 redirects to https (`nginx.conf:123-137`); 443 terminates TLS 1.2 plus 1.3 with HSTS plus frameguard plus nosniff (CSP owned by web proxy, never nginx).
**Interpretation:** Edge is shield plus terminator plus router; it never enforces auth, only flood protection and correct client-IP bucketing.
## 3. Public API
**Fact:** Edge exposes 443 for app plus 80 redirect plus `/healthz` bare ok (no auth, no throttle, access_log off) for container plus LB probes.
| Location | Upstream | Rate | Source |
|---|---|---|---|
| /api/auth/ | nestjs_api 60s timeouts | auth_limit 300r/m burst 10 | nginx.conf:244-260 |
| /api/health/ | nestjs_api 5s timeouts | never throttled | nginx.conf:263-278 |
| /api/ | nestjs_api 60s timeouts | api_limit 10r/s burst 20 | nginx.conf:280-299 |
| /collect | alloy 12347 via variable | general 30r/s burst 50 | nginx.conf:202-242 |
| / | nextjs_client 300s | general 30r/s burst 50 | nginx.conf:301-318 |
**Fact:** Generic 429 location `@ratelimited` returns JSON plus Retry-After 10 (nginx.conf:185-189); `/api/auth/` omits it so Better Auth 429s pass through.
## 4. Dependency direction
**Fact:** Allowed: nginx into api plus web upstreams plus alloy for collect; entrypoint into nginx.conf.template plus realip.conf; compose into NGINX_* env.
**Fact:** Forbidden: client-controlled bypass header (empty key equals unlimited); second static CSP in nginx (breaks Faro beacons); ready-gated depends_on.
| Check | Grep |
|---|---|
| No bypass | rg -n "X-Bypass|bypass" nginx/nginx.conf, expect only no-bypass comment |
| No CSP | rg -n "Content-Security-Policy" nginx/nginx.conf, expect only single-owner comment |
| Health exempt | rg -n "limit_req" nginx/nginx.conf, expect none in /api/health/ block |
## 5. Security posture
**Fact:** Zones keyed on `$binary_remote_addr` after real-IP restore (`realip.conf` generated from NGINX_TRUSTED_PROXIES, default 127.0.0.0 slash 8 no-op direct).
**Fact:** `limit_conn conn_limit 20` per real IP at server level (`nginx.conf:148` via placeholder) guards slowloris plus connection exhaustion alongside rate zones.
**Fact:** Entrypoint validates hostnames, ports, filenames, CIDRs, rates, bursts before sed injection (`entrypoint.sh:33-207`); hostile values fail fast, never reach config.
## 6. Failure modes
**Fact:** Rate exceeded returns 429 with Retry-After; k6 treats 429 as expected, only 5xx fails thresholds (see k6/config.js FIVE_XX plus VISIBILITY_429).
**Fact:** Alloy absent makes only `/collect` 502 (variable plus resolver 127.0.0.11) while app keeps serving; static proxy_pass would crash-loop whole proxy.
**Fact:** Missing cert or key file exits entrypoint 1 with clear message (`entrypoint.sh:141-149`); missing required upstream env exits 1 before nginx starts.
**Fact:** Health never throttled so 210-hit security-regression proves flood shield without probe starvation; throttling health would hide warm-up blips.
## 7. Performance
**Fact:** Prod rates are auth 300r/m plus api 10r/s plus general 30r/s with bursts 10/20/50 (`.env.example:250-255`); k6 opens to 20000r/m plus 2000r/s bursts 2000.
**Fact:** `client_max_body_size 10m` global but 1m on `/collect` (Faro batches are KBs); buffers 8x16k plus gzip 6 for JSON plus JS plus CSS.
**Fact:** Connection upgrade map keeps non-WS in keepalive 64 pool (`nginx.conf:56-59`); old empty-close value idled the pool with fresh TLS per request.
**Fact:** Timeouts are 60s api/auth, 5s health, 300s web (proxy_buffering off for streaming); health fast-fail keeps depends_on live responsive.
## 8. Config/Env
**Fact:** Rates plus bursts plus conn limit plus server name plus cert names plus upstreams plus trusted proxies all come from `NGINX_*` in `.env.example:230-255`.
**Fact:** Entrypoint defaults mirror historical hardcodes when unset; k6 overlay in `.env.k6.example:62-68` raises for single-IP generators (1500 maxVUs).
**Fact:** `NGINX_TRUSTED_PROXIES` plus `NGINX_REAL_IP_HEADER` control real-IP restore; wrong CIDR silently corrupts every rate bucket, hence strict validation.
## 9. Testing/verification
**Fact:** `security-regression.integration.spec.ts` asserts 210 sequential health hits 429 on non-health paths while health stays reachable (throttle contract).
**Fact:** `health.integration.spec.ts` asserts live 200 anonymous plus ready checks via edge; e2e proxy slices cover 8443 TLS plus 8080 plus collect CORS.
**Fact:** k6 `rate-limit-flow.js` asserts 429s fire under spike; thresholds keep 429 report-only so shield visibility never fails the suite.
**Recommendation:** After zone or header change run security-regression plus e2e proxy plus k6 smoke plus spike before merge.
## 10. Extension pointer
**Recommendation:** Add location only with zone plus burst plus timeout plus 429 shape plus upstream; never add unauthenticated open proxy_pass without limit.
**Recommendation:** Add upstream only via compose service plus NGINX upstream env plus entrypoint validation plus .env.example row same PR.
**Recommendation:** Follow workflows/add-rate-limited-action.md (future) for nginx zone step plus customRules plus throttler plus SCOPES plus k6.
## 11. AI-guidance
MUST: keep no-bypass (no client header, empty key unlimited); keep health exempt from limit_req; keep collect rate-limited plus POST plus OPTIONS only.
MUST: keep traceparent plus tracestate plus baggage forwarding on api plus web locations; keep CSP owned by web proxy, never nginx.
MUST-NOT: add static proxy_pass to alloy (crash-loops without observability profile); add second CSP; gate depends_on on ready; expose admin console.
MUST-NOT: raise prod rates to k6 values permanently; k6 overlay is gitignored .env.k6 only, prod stays 300r/m plus 10r/s plus 30r/s.
## 12. Common mistakes
**Interpretation:** Adding X-Bypass header for load tests disables protection for everyone (empty key uncounted); tune rates via .env.k6 instead.
**Interpretation:** Adding static CSP in nginx to harden headers breaks Faro and API beacons with no log on either side (intersection is most restrictive).
**Interpretation:** Throttling /api/health to stop probe spam hides warm-up and makes compose wait forever; keep health exempt and throttle elsewhere.
**Interpretation:** Setting TRUSTED_PROXIES to 0.0.0.0 slash 0 to fix IP behind CDN trusts every hop and lets spoofed XFF poison rate buckets.
## 13. Related
Invariants: INV-06 rate-limits plus INV-07 health (edge shield plus probe exemption; rules not repeated). Flows: flows/rate-limited.md plus flows/e2e.md (future). Subsystems: redis.md plus api-runtime.md plus observability-infra.md (future). Workflows: add-rate-limited-action.md plus change-docker-env.md (future). ADRs: ADR-0009 no-bypass (future).
## 14. Refs
nginx/nginx.conf, nginx/entrypoint.sh, nginx/certs/localhost.crt, nginx/certs/localhost.key, docker-compose.yml, docker-compose.observability.yml, .env.example, .env.k6.example, apps/api/test/integration/modules/security-regression.integration.spec.ts, k6/scenarios/rate-limit-flow.js, k6/config.js, apps/web/src/proxy.ts.
> **Uncertainty:** OTel exporter vs Alloy compat plus Tempo retention plus Pyroscope arm64 are unverified with alloy latest unpinned. See .agent/wiki-discovery/FINAL-10-OPEN-QUESTIONS.md Q11; nginx forwards traceparent correctly but pipeline semantics must not be asserted here.
| Var | Prod | k6 | Validated by |
|---|---|---|---|
| NGINX_AUTH_RATE | 300r/m | 20000r/m | entrypoint.sh assert_rate |
| NGINX_API_RATE | 10r/s | 2000r/s | entrypoint.sh assert_rate |
| NGINX_GENERAL_RATE | 30r/s | 2000r/s | entrypoint.sh assert_rate |
| NGINX_CONN_LIMIT | 20 | 2000 | entrypoint.sh numeric 1-100000 |
| TRUSTED_PROXIES | 127.0.0.0 slash 8 | same | assert_trusted_proxies CIDR |
**Fact:** Edge source of truth is nginx.conf plus entrypoint.sh plus compose NGINX env; prose here is descriptive and code wins.
**Recommendation:** Keep this file 120-200 lines; link invariants, never copy rules; bump updated on every content PR per FINAL-09.
### Collect location guardrails
| Rule | Value | Why |
|---|---|---|
| Methods | POST plus OPTIONS only | Faro beacons only, deny rest at edge |
| Body cap | 1m (vs 10m global) | telemetry batches are KBs |
| CORS | star local-only, restrict prod | match Alloy FARO_CORS_ORIGINS |
| Resolver | 127.0.0.11 valid 30s | Docker DNS, request-time only |
**Fact:** Preflight returns 204 with CORS headers; beacons proxy with Host plus XFF plus trace headers preserved for Alloy attribution.
### Header forwarding contract
| Header | Set on | Purpose |
|---|---|---|
| Host | all proxy locations | trustedOrigins CSRF plus routing |
| X-Real-IP | all | real IP after restore, bucket key |
| X-Forwarded-For | all | hop chain, leftmost untrusted |
| traceparent | api plus web | OTel trace propagation |
| tracestate plus baggage | api plus web | vendor plus app context |
**Fact:** Leftmost XFF must never be trusted for auth; use restored remote_addr for buckets and session-derived userId for attribution.
**Recommendation:** When adding LB or CDN later, set NGINX_TRUSTED_PROXIES to provider CIDRs and re-run k6 rate-limit scenario to prove buckets still correct.
**Fact:** Code wins over wiki; nginx.conf plus entrypoint.sh win over prose per authority model.
**Recommendation:** Do not read whole wiki for edge change; follow task route T5 rate-limit bundle in order per 00-INDEX (future).
### Verification commands
**Fact:** Run security-regression plus health integration plus e2e proxy slices for edge; run nginx -t in proxy container for syntax before push.
**Fact:** TLS files must exist at container path before nginx starts; entrypoint checks both cert and key and fails fast with path in message.
**Recommendation:** Keep proxy logs in json_analytics shape (includes traceparent) so Loki plus Tempo can correlate edge plus app spans.
**Fact:** HSTS max-age 31536000 plus includeSubDomains is always on for 443; healthz intentionally omits inherited security headers for bare probes.
**Recommendation:** Keep this file 120-200 lines; link invariants, never copy rules; bump updated on every content PR.
