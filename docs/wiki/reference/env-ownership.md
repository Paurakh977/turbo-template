---
title: "Reference: Env Ownership"
type: reference
status: stable
authority: derived
owners: ["subsystems/env-config.md"]
sources: [".env.example", "apps/api/src/app.module.ts", "packages/auth/src/config/env.ts", "packages/database/src/client.ts", "turbo.json", "docker-compose.yml"]
depends_on: ["invariants/09-env.md", "subsystems/env-config.md", "subsystems/docker-environments.md"]
guards: ["scripts/check-web-secrets.mjs", "packages/auth/src/config/env.spec.ts"]
updated: 2026-10-01
expires: null
superseded-by: null
template: true
---
# Reference: Env Ownership
> Up: ../00-INDEX.md
| Variable | Consumers | Secret? | Validated by | Missing behavior | Source |
|---|---|---|---|---|---|
| HOST, PORT | api | no | Joi required, PORT 1-65535 | boot fail | .env.example:11-12 + app.module.ts:69-70 |
| DATABASE_URL | api (via pgbouncer) | yes | Joi uri | boot fail | .env.example:88 + app.module.ts:71 |
| DIRECT_URL | migrate, studio | yes | prisma.config fail-fast, fallback DATABASE_URL | migrate fail | .env.example:91 + prisma.config.ts |
| REDIS_URL | api, auth secondaryStorage | yes | Joi uri | boot fail | .env.example:97 + app.module.ts:72 |
| BETTER_AUTH_SECRET | api only | yes | Joi min32 + placeholder guard | boot fail | .env.example:126 + app.module.ts:75 + env.ts:29-30 |
| BETTER_AUTH_URL, NEXT_PUBLIC_APP_URL, APP_NAME | api, web baked | no | Joi uri/required | boot fail | .env.example:107-128 + app.module.ts:73-76 |
| RATE_LIMIT_WINDOW, RATE_LIMIT_MAX, RATE_LIMIT_SIGNUP_MAX | auth rateLimit | no | parseIntEnv fallback 60/20/3 | empty=fallback | .env.example:160-163 + auth.ts:432-464 |
| THROTTLE_TTL_MS, THROTTLE_LIMIT | api throttler | no | parseThrottleInt fallback 60000/200 | empty=fallback | .env.example:168-169 + app.module.ts:166-167 |
| DATABASE_POOL_MAX, DATABASE_CONNECTION_TIMEOUT_MS, DATABASE_IDLE_TIMEOUT_MS | database pool | no | parsePositiveInt fallback 10/5000/30000 | empty=fallback | .env.example:27-29 + client.ts:10-25 |
| API_WORKERS | api cluster | no | cluster cap 8, pool math | default 1 | .env.example:186 + cluster.ts:51 |
| NGINX_AUTH/API/GENERAL_RATE+BURST, NGINX_CONN_LIMIT, NGINX_TRUSTED_PROXIES | proxy entrypoint | no | entrypoint validates, compose :-defaults | hardcoded default | .env.example:241-255 + compose:18-24 + nginx.conf:82-88 |
| OTEL_*, GIT_SHA, PYROSCOPE_*, GF_*, PROMETHEUS_PORT, GRAFANA_PORT | api, web, alloy | no | Joi required unless OTEL_SDK_DISABLED=true | boot fail | .env.example:279-312 + app.module.ts:85-137 |
| NEXT_PUBLIC_FARO_*, FARO_CORS_ORIGINS | web baked | no | build env, rebuild on change | stale beacon | .env.example:317-325 + next.config.js |
| SEED_ADMIN_*, USER_* | seed, k6 | partial | seed min12 | seed fail | .env.example:144-150 + seed.ts:28-30 |
## Notes
- Fact: `.env.example` is single source; compose `${VAR:?}` fail-fast vs `${VAR:-}` empty-fallback; container env wins.
- Fact: Empty-means-fallback for pool/throttle/rate knobs; digits-only parsers throw on `7d`, never NaN/truncate.
- Fact: `NEXT_PUBLIC_*` baked at `next build`; runtime secrets need restart only; never bake secrets.
- Fact: Web tier never receives DATABASE_URL/SECRET/PG keys; verify via `guard:web-secrets --strict`.
- Fact: turbo `passThroughEnv` is second gate; new var needs .env.example + validator + turbo + compose same PR.
- Uncertainty: OAuth test provider + Resend relaxation (FINAL-10 Q5/Q13); OTel exporter compat (Q11). See .agent/wiki-discovery/FINAL-10-OPEN-QUESTIONS.md; do not assert beyond fail-fast.
