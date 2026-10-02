---
title: "Architecture B Secret-Free Web"
type: invariant
status: stable
authority: normative-constraints
owners: ["subsystems/web-runtime.md"]
sources: ["docker-compose.yml", "apps/web/src/lib/server/fetch-internal.ts", "apps/web/src/lib/server/internal-api.ts", "apps/web/src/lib/server/auth-http.ts", "scripts/check-web-secrets.mjs", "scripts/check-web-auth-imports.mjs"]
depends_on: ["decisions/ADR-0003-architecture-b-secret-free-web.md", "flows/auth.md", "flows/authenticated-api.md"]
guards: ["scripts/check-web-secrets.mjs", "scripts/check-web-auth-imports.mjs"]
updated: 2026-10-01
expires: null
superseded-by: null
template: true
---
# INV-001 Architecture B Secret-Free Web
> Up: ../00-INDEX.md
**ID:** INV-001
## Invariant
- Fact: Web tier MUST hold no DATABASE_URL, no BETTER_AUTH_SECRET, no direct DB import; all auth and data access goes via HTTP gateways with cookie forwarding.
## Why
- Fact: Leaked secret mints arbitrary sessions; direct DB skips guards, authz, and audit in one edit (FINAL-07 Critical-01).
- Interpretation: Blast radius is full tenant compromise from one web-container read.
## Code
- Fact: `docker-compose.yml:web service env block (compose web service, INTERNAL_API_URL plus NEXT_PUBLIC plus OTel only)` web env injects only INTERNAL_API_URL plus NEXT_PUBLIC_* plus OTel, never secrets.
- Fact: `apps/web/src/lib/server/fetch-internal.ts` plus `internal-api.ts` plus `auth-http.ts` forward cookies with 5s timeout mapping to 503 or 504.
- Fact: Pure subpaths only `packages/auth/src/shared/permissions.ts` plus `packages/roles/src/index.ts`; erased `import type { Auth }` is allowed.
## Consequences
- Fact: Compromised web cannot mint sessions or read Postgres directly; API remains sole policy and audit owner.
- Recommendation: Reject any diff adding secrets or DB clients to web image or compose web env.
## Naive failure mode
- Interpretation: Importing `{ auth }` from `@repo/auth` root or `{ db }` from `@repo/database` in `apps/web/src` to save one HTTP hop forks auth and needs secret in web.
## Guards-tests
- Fact: Run `pnpm guard:web-secrets --strict` plus `pnpm guard:web-auth-imports`; both must be green before merge.
- Fact: Grep `from '@repo/auth'` and `from '@repo/database'` in `apps/web/src` must show only pure subpaths or erased types.
## Related ADRs
- Recommendation: See [ADR-0003 Architecture B](../decisions/ADR-0003-architecture-b-secret-free-web.md) for gateway versus direct-DB trade-off.
## Related flows-subsystems
- Recommendation: Enforced in [auth](../flows/auth.md) plus [authenticated-api](../flows/authenticated-api.md); owned by [web-runtime](../subsystems/web-runtime.md).
- Uncertainty: FINAL-10 Q12 web `pg` plus `ioredis` devDeps remain installed but unused in `src`; retention versus removal unconfirmed, see `.agent/wiki-discovery/FINAL-10-OPEN-QUESTIONS.md` Q12.
- Fact: For fresh-role verdicts see [02-fresh-role.md](02-fresh-role.md) INV-002 pointer only; this file owns only secret-free boundary.
