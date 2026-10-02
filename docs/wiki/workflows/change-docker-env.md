---
title: "Workflow: Change Docker Profile and Env"
type: workflow
status: stable
authority: normative-procedure
owners: ["subsystems/docker-environments.md"]
sources: ["docker-compose.yml", "docker-compose.observability.yml", "apps/api/Dockerfile.prod", "apps/web/Dockerfile.prod", "apps/migrate/Dockerfile", ".env.example", "apps/api/src/app.module.ts", "packages/database/src/client.ts", "turbo.json", "scripts/check-web-secrets.mjs"]
depends_on: ["invariants/07-health.md", "invariants/09-env.md", "invariants/01-architecture-b.md", "flows/migration.md", "flows/e2e.md", "subsystems/docker-environments.md", "subsystems/env-config.md"]
guards: ["scripts/check-web-secrets.mjs", "scripts/check-web-auth-imports.mjs", "apps/api/test/integration/modules/health.integration.spec.ts"]
updated: 2026-10-01
expires: null
superseded-by: null
template: true
---
# Workflow: Change Docker Profile and Env
> Up: ../00-INDEX.md | Use when: Dockerfile, compose profile, env var, or healthcheck change. Route: T7.
## Purpose
- Fact: Changes one of five profiles plus Dockerfiles plus single-source env with fail-fast validation.
- Interpretation: Baked `NEXT_PUBLIC_*` versus runtime secrets is the split; confusing them breaks boot or leaks secrets.
- Recommendation: Edit compose plus Dockerfile plus example plus validator plus turbo in one PR, then boot every affected profile.
## Preconditions
- [ ] Read `../00-INDEX.md` task row T7 and confirm Required order before diff.
- [ ] Read `../invariants/07-health.md` live versus ready plus `09-env.md` single source plus `01-architecture-b.md`.
- [ ] Read `../flows/migration.md` DIRECT_URL path plus `../flows/e2e.md` seed to nginx to Playwright path.
- [ ] Read `../subsystems/docker-environments.md` plus `env-config.md`.
- Fact: Shallow-merge `x-proxy-base` trap means profile overrides must be explicit, not inherited silently.
## Steps checklist
- [ ] 1. Update `docker-compose.yml` profile block prod slash dev slash local slash test slash e2e with explicit ports.
- [ ] 2. Update `apps/api/Dockerfile.prod` plus `apps/web/Dockerfile.prod` plus `apps/migrate/Dockerfile` trim plus HEALTHCHECK live.
- [ ] 3. Update `.env.example` single source with Secret flag plus default plus owner comment.
- [ ] 4. Update overlay `docker-compose.observability.yml` only for Alloy plus backends, never base app wiring.
- [ ] 5. Update `turbo.json` `passThroughEnv` for every task needing the new var the same PR.
- [ ] 6. Update Joi in `apps/api/src/app.module.ts` plus parsers `auth/config/env.ts` plus `database/client.ts`.
- [ ] 7. Update `load-env.ts` plus `scripts/check-web-*` expectations if web bundle surface shifts.
- [ ] 8. Decide ARG-baked versus runtime ENV: `NEXT_PUBLIC_*` needs rebuild, secrets never baked.
- [ ] 9. Boot affected profiles plus migrate via DIRECT_URL plus rebuild NEXT_PUBLIC test.
## Commands
```sh
pnpm guard:web-secrets -- --strict
pnpm guard:web-auth-imports
pnpm db:migrate:deploy
pnpm db:generate
pnpm --filter api test:integration -- -t "health"
pnpm --filter web test:e2e -- -g "boot"
```
- Fact: `db:migrate:deploy` proves DIRECT_URL wiring; `db:generate` proves client still builds after env shift.
- Fact: Secrets guard needs built standalone output; run `build` before `--strict` or exit 2 is expected.
## Files-areas
| Area | Paths |
|---|---|
| Compose | `docker-compose.yml` 5 profiles plus observability overlay |
| Images | `apps/api/Dockerfile.prod` plus `apps/web/Dockerfile.prod` plus `apps/migrate/Dockerfile` |
| Env | `.env.example` plus `app.module.ts` Joi plus `turbo.json` passthrough |
| Parsers | `auth/config/env.ts` `parseIntEnv` plus `database/client.ts` `parsePositiveInt` |
| Gate | `scripts/check-web-secrets.mjs` plus `check-web-auth-imports.mjs` |
## Architectural gates
- Fact: Web stays secret-free per profile; `NGINX_*` present per profile needing edge.
- Fact: HEALTHCHECK hits live only, never ready; `depends_on` gates on live to avoid deadlock.
- Fact: Baked versus runtime split holds; `NEXT_PUBLIC_*` inlined at build, secrets at runtime only.
- Fact: Single env source with fail-fast; missing required var throws at boot, never silent undefined.
## Tests
- Fact: Required `check-web-secrets --strict` plus imports plus compose config lint plus e2e boot.
- Fact: Required migrate DIRECT_URL plus `health` live plus ready pair plus NEXT_PUBLIC rebuild test.
- Fact: Recommended `ports-topology.md` plus `env-ownership.md` row verification.
## Documentation updates
- Fact: Same PR updates `subsystems/docker-environments.md` plus `env-config.md` plus `reference/env-ownership.md`.
- Fact: Same PR updates `reference/ports-topology.md` for port or profile or probe shifts.
- Fact: Bump `updated` plus run link lint; never paste secret values into docs.
## Verification
- [ ] Guards green on fresh build output for every touched profile.
- [ ] Compose config validates plus `NGINX_*` present where edge is expected.
- [ ] E2E boot plus migrate DIRECT_URL plus health live 200 plus ready shape all green.
- [ ] `git status --short` shows only Docker plus env plus validator plus docs paths.
## Failure-recovery
- Fact: Broken boot maps to revert compose plus Dockerfile plus env example together, never one alone.
- Fact: Missing passthrough maps to add var to `turbo.json` task plus clear turbo cache, then rebuild.
- Fact: Baked var stale maps to rebuild web image; runtime var stale maps to restart without rebuild.
- Uncertainty: FINAL-10 Q1 e2e prefix drift may mask boot green; run stub suite, see FINAL-10 Q1.
- Uncertainty: FINAL-10 Q12 web `pg` plus `ioredis` devDeps leftover hygiene; grep and remove, see FINAL-10 Q12.
- Uncertainty: FINAL-10 Q13 Resend plus host-rewrite plus CIDR versus hop on new topology; ADR when LB added, see FINAL-10 Q13.
## Related
- Fact: Up `../00-INDEX.md`; routes T7; enforced by INV-007 plus INV-009 plus INV-001.
- Recommendation: Model changes pair with `add-model.md`; probes pair with `debug-prod.md`.
- Recommendation: Ownership table in `../reference/env-ownership.md`; topology in `../reference/ports-topology.md`.
