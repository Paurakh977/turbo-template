---
title: "ADR-0003 Architecture B Secret-Free Web"
type: adr
status: accepted
authority: normative-history
owners: ["subsystems/web-runtime.md"]
sources: ["apps/web/src/lib/server/fetch-internal.ts", "apps/web/src/lib/server/internal-api.ts", "apps/web/src/lib/server/auth-http.ts", "docker-compose.yml", "scripts/check-web-secrets.mjs", "scripts/check-web-auth-imports.mjs"]
depends_on: ["invariants/01-architecture-b.md", "flows/auth.md", "flows/authenticated-api.md", "subsystems/web-runtime.md"]
guards: ["scripts/check-web-secrets.mjs", "scripts/check-web-auth-imports.mjs"]
updated: 2026-10-01
expires: null
superseded-by: null
template: true
---
# ADR-0003 Architecture B Secret-Free Web
> Up: ../00-INDEX.md | Status: accepted | Routes T1 T2 T7 T10.
## Status
- Fact: Accepted. Web SSR holds no DATABASE_URL, no BETTER_AUTH_SECRET, no auth runtime. See docker-compose.yml web env inject-nothing plus scripts/check-web-secrets.mjs.
## Context / Problem
- Fact: Next.js SSR compromise would mint sessions or read DB directly if secrets lived in web. Blast radius is full auth bypass plus data exfiltration.
- Interpretation: Direct DB or auth-runtime imports in web save one HTTP hop but collapse the trust boundary that INV-001 exists to hold.
- Fact: Gateway path adds one internal HTTP hop with 5s timeout mapping to 503 or 504. See apps/web/src/lib/server/fetch-internal.ts plus internal-api.ts.
## Decision
- Fact: Keep HTTP gateways fetch-internal plus internal-api plus auth-http as the only web-to-API path. Web calls API over internal network, never Prisma or auth runtime.
- Fact: Compose web service injects no SECRET or DATABASE_URL. Guards scripts/check-web-secrets.mjs --strict plus scripts/check-web-auth-imports.mjs enforce it in CI.
- Recommendation: New web server code MUST use callInternalApi helper trio, never import @repo/database or @repo/auth root runtime.
## Rejected alternatives
- Dual-pool web with direct Prisma in web: saves hop latency but gives SSR compromise full DB access and diverges pool budgets. Rejected for secret blast radius plus pool divergence.
- Auth runtime in web for faster session reads: saves gateway round-trip but lets web mint or verify sessions outside API policy. Rejected for mint bypass plus hierarchy drift.
- Shared secret file mounted into web for server actions: simplifies local dev but leaks BETTER_AUTH_SECRET into the most exposed surface. Rejected for exposure without need.
## Consequences
- Fact: Positive SSR compromise yields no mint or DB bypass, pool math stays API-only, auth policy has one owner. Negative one extra hop latency plus 5s gateway timeout must be handled as 503 or 504.
- Interpretation: Web builds stay portable across profiles because no per-profile secret wiring is needed in web.
## Revisit-when
- Recommendation: Revisit only if edge SSR strictly requires secrets with proof no gateway can serve it. Default answer is deny. Then new ADR superseding this one, never edit history.
## Related invariants and implementation
- Recommendation: Constrained by INV-001 secret-free plus INV-010 presentational versus enforced. Traversed by flows/auth.md plus flows/authenticated-api.md. Owned by subsystems/web-runtime.md.
- Fact: Refs apps/web/src/lib/server/fetch-internal.ts plus internal-api.ts plus auth-http.ts plus docker-compose.yml web env plus subsystems/security.md.
- Uncertainty: Web pg plus ioredis devDeps look leftover but not imported in src. See .agent/wiki-discovery/FINAL-10-OPEN-QUESTIONS.md Q12. Presence is not runtime use, verify by grep before removal.
- Uncertainty: Resend plus dummy-OAuth plus host-rewrite edge cases break if LB hop added. See .agent/wiki-discovery/FINAL-10-OPEN-QUESTIONS.md Q13. No topology change without ADR.
- Uncertainty: Dummy OAuth controller plus OAUTH_TEST_PROVIDER must never run in prod. See .agent/wiki-discovery/FINAL-10-OPEN-QUESTIONS.md Q5. Grep compose hosting env before enabling.
## Verification
- Fact: Verify with pnpm guard:web-secrets --strict plus pnpm guard:web-auth-imports plus grep no value auth in web/src before merge.
