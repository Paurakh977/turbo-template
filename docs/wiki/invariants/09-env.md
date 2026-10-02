---
title: "Single Env Source Fail Fast"
type: invariant
status: stable
authority: normative-constraints
owners: ["subsystems/env-config.md"]
sources: [".env.example", "apps/api/src/app.module.ts", "packages/auth/src/server/auth.ts", "packages/database/src/client.ts", "turbo.json", "apps/api/src/load-env.ts", "packages/database/prisma.config.ts"]
depends_on: ["decisions/ADR-0010-baked-rum-and-next-public.md", "flows/migration.md", "flows/e2e.md"]
guards: ["apps/api/test/integration/modules/middleware.integration.spec.ts", "scripts/check-web-secrets.mjs"]
updated: 2026-10-01
expires: null
superseded-by: null
template: true
---
# INV-009 Single Env Source Fail Fast
> Up: ../00-INDEX.md
**ID:** INV-009
## Invariant
- Fact: `.env.example` MUST be single source with fail-fast validation; baked public values MUST rebuild on change while runtime secrets MUST inject per environment.
## Why
- Fact: Empty-string zeroing plus parseInt truncation plus local `.env` copied to prod silently downgrades verification and zeroes pools or budgets (FINAL-07 High-05 plus Low-02).
## Code
- Fact: `apps/api/src/app.module.ts` Joi abortEarly false validates HOST plus PORT plus DATABASE_URL plus REDIS_URL plus OTel set; `packages/auth/src/server/auth.ts` throws on missing app URL plus name plus sender.
- Fact: Parsers validated `parseThrottleInt` in `app.module.ts:40-51` plus `parseIntEnv` in auth config plus `parsePositiveInt` in `packages/database/src/client.ts`; digits-only min throw, empty falls back never Number-empty-zero.
- Fact: `turbo.json` passThroughEnv allowlist separates hashed `NEXT_PUBLIC_*` from runtime pass-through; `apps/api/src/load-env.ts` plus `packages/database/prisma.config.ts` DIRECT_URL prod fail-fast.
## Consequences
- Fact: Missing prod secret or mail config fails at boot with every key listed; pools and throttles keep intended budgets instead of zero.
## Naive failure mode
- Interpretation: Using `Number(process.env.VAR ?? fallback)` or bare `parseInt` turns 7d into 7s and empty into zero budgets.
- Interpretation: Copying dev volumes into prod or publishing DB wide or requiring Alloy in e2e breaks environment isolation.
## Guards-tests
- Fact: Run env validation specs plus `middleware` integration plus `check-web-secrets --strict`; verify `.env.example` stays key-for-key with compose plus Joi plus turbo.
## Related ADRs
- Recommendation: See [ADR-0010 Baked RUM](../decisions/ADR-0010-baked-rum-and-next-public.md) for baked versus runtime split.
## Related flows-subsystems
- Recommendation: Enforced in [migration](../flows/migration.md) plus [e2e](../flows/e2e.md); owned by [env-config](../subsystems/env-config.md) plus docker-environments.
- Fact: For pool math see [04-database-connections.md](04-database-connections.md) INV-004 pointer only; this file owns only env sourcing plus parsing.
- Fact: Compose `x-proxy-base` shallow-merge requires repeating NGINX_* per profile; missing repeat silently drops proxy tuning.
- Fact: ARG-baked NEXT_PUBLIC_* need web rebuild; runtime ENV needs only restart, never mix the two channels.
- Fact: `OTEL_SDK_DISABLED` fail-open allowed only in test plus e2e; prod must wire exporter endpoint plus identity.
