---
title: "Workflow: Change Auth Session Lifecycle"
type: workflow
status: stable
authority: normative-procedure
owners: ["subsystems/auth-better-auth.md"]
sources: ["packages/auth/src/server/auth.ts", "packages/auth/src/server/infra/redis.ts", "packages/auth/src/server/pending-storage.ts", "packages/auth/src/server/audit-plugin.ts", "packages/auth/src/server/database-hooks.ts", "apps/api/src/common/request-context.ts", "apps/api/src/common/session.utils.ts", "apps/web/src/lib/auth/auth-client.ts", "apps/web/src/lib/server/auth-http.ts"]
depends_on: ["invariants/01-architecture-b.md", "invariants/02-fresh-role.md", "invariants/03-request-context.md", "invariants/06-rate-limits.md", "flows/auth.md", "flows/authenticated-api.md", "subsystems/auth-better-auth.md", "subsystems/redis.md", "subsystems/security.md"]
guards: ["scripts/check-web-auth-imports.mjs", "scripts/check-web-secrets.mjs", "apps/api/test/integration/modules/auth-flow.integration.spec.ts", "apps/api/test/integration/modules/auth-session.integration.spec.ts"]
updated: 2026-10-01
expires: null
superseded-by: null
template: true
---
# Workflow: Change Auth Session Lifecycle
> Up: ../00-INDEX.md | Use when: session storage, expiry, 2FA, impersonation, cookies, or trusted origins change. Routes: T2, T10.
## Purpose
- Fact: Changes Better Auth lifecycle plus guards plus context plus web plumbing without breaking Arch-B or fresh-role.
- Interpretation: `auth.ts` is the single lifecycle owner; api guards plus web clients are followers, never owners.
- Recommendation: Edit storage plus rateLimit plus origins plus cookies in one scoped PR with auth plus security proofs.
## Preconditions
- [ ] Read `../00-INDEX.md` task rows T2 plus T10 and confirm Required order before diff.
- [ ] Read `../invariants/01-architecture-b.md` secret-free web plus `02-fresh-role.md` plus `03-request-context.md`.
- [ ] Read `../invariants/06-rate-limits.md` customRules plus bare-token behavior.
- [ ] Read `../flows/auth.md` hop table plus `../flows/authenticated-api.md` guard chain.
- [ ] Read `../subsystems/auth-better-auth.md` plus `redis.md` plus `security.md`.
- Fact: Web runtime import from auth root reintroduces DB secrets into the browser bundle.
## Steps checklist
- [ ] 1. Edit `packages/auth/src/server/auth.ts` storage plus expires 604800 plus updateAge 86400 plus freshAge 900 plus rules.
- [ ] 2. Update `infra/redis.ts` secondary storage plus `pending-storage.ts` GETDEL atomicity plus TTL 15 to 30s.
- [ ] 3. Update `audit-plugin.ts` plus `database-hooks.ts` plus `hierarchy.ts` if role or ban lifecycle shifts.
- [ ] 4. Update api `request-context.ts` plus interceptor plus `session.utils.ts` Session-once capture.
- [ ] 5. Update web `auth-client.ts` plus `auth-http.ts` plus `require-admin.ts` presentation only.
- [ ] 6. Confirm planes: privilege audit stays sync post-commit, domain stays outbox same-tx.
- [ ] 7. Walk `14-S17` dangerous-mods reject list for T10 hardening scope before merge.
- [ ] 8. Add `auth-flow` plus `2fa` plus `auth-session` plus `pending-storage` plus `stop-impersonation` coverage.
- [ ] 9. Run guards plus `rate-limit-thresholds` to prove 429 classification still holds.
## Commands
```sh
pnpm --filter api test:integration -- -t "auth-flow"
pnpm --filter api test:integration -- -t "auth-session"
pnpm --filter api test:integration -- -t "pending-storage"
pnpm --filter web test:e2e -- -g "auth"
pnpm guard:web-auth-imports
pnpm guard:web-secrets -- --strict
```
- Fact: `test:integration -t` selects Jest suite; `test:e2e -g` selects Playwright title filter.
- Fact: Always run both `auth-flow` and `auth-session`; one proves login, the other proves expiry plus refresh.
## Files-areas
| Area | Paths |
|---|---|
| Lifecycle | `packages/auth/src/server/auth.ts:174-478` plus `config/env.ts` |
| Storage | `infra/redis.ts` plus `pending-storage.ts:101-318` bare-token keys |
| Hooks | `audit-plugin.ts` plus `database-hooks.ts` plus `hierarchy.ts` |
| API | `request-context.*` plus `session.utils.ts` plus guards |
| Web | `auth-client.ts` plus `auth-http.ts` plus `require-admin.ts` |
## Architectural gates
- Fact: Browser plus web server never hold DB access or auth secrets per INV-001.
- Fact: Verdicts re-read PG role every request; no `session.user.role` trust.
- Fact: Request context per-request only with capture-at-emit for background work.
- Fact: No bypass header; `get-session` plus admin plus challenge limits stay enforced.
## Tests
- Fact: Required `auth-flow` plus `2fa` plus `auth-session` plus e2e `auth` plus `stop-impersonation`.
- Fact: Required `pending-storage` plus `rate-limit-thresholds` plus grep no value auth in web src.
- Fact: Required `auth-security` plus `security` integration for T10 boundary scope.
## Documentation updates
- Fact: Same PR updates `subsystems/auth-better-auth.md` plus `redis.md` plus `security.md` if touched.
- Fact: Same PR updates `reference/redis-keys.md` for new keys plus `reference/rate-limit-matrix.md` for rule shifts.
- Fact: Bump `updated` plus run link lint; never paste secrets or tokens into docs.
## Verification
- [ ] Guards web imports plus secrets-strict both green on built standalone output.
- [ ] Integration auth-flow plus 2fa plus auth-session plus pending plus stop specs green.
- [ ] E2E auth green on e2e profile with seeded accounts and storage states.
- [ ] Grep `from "@repo/auth"` runtime in web src returns only allowed subpaths.
## Failure-recovery
- Fact: Broken session maps to revert `auth.ts` plus flush Redis pending keys, never hand-edit session rows.
- Fact: Cookie plus CORS break maps to restore single-owner `trustedOrigins` plus `nextCookies` last order.
- Fact: Impersonation wedge maps to exactly-once stop path plus audit pair check.
- Uncertainty: FINAL-10 Q4 `active-sessions-*` load-bearing versus belt-and-braces; see FINAL-10 Q4.
- Uncertainty: FINAL-10 Q5 dummy OAuth plus `OAUTH_TEST_PROVIDER` never in prod; grep compose, see FINAL-10 Q5.
- Uncertainty: FINAL-10 Q2 bodyParser 2MB vendor mount coverage; test large body, see FINAL-10 Q2.
- Uncertainty: FINAL-10 Q3 interceptor order unpinned; pin if mutation added, see FINAL-10 Q3.
- Uncertainty: FINAL-10 Q8 audit-plugin maps TTL sweep unverified; add finally cleanup, see FINAL-10 Q8.
## Related
- Fact: Up `../00-INDEX.md`; routes T2 plus T10; enforced by INV-001 plus INV-002 plus INV-003 plus INV-006.
- Recommendation: Role grants continue in `add-permission-role.md`; edge limits in `add-rate-limited-action.md`.
- Recommendation: Reject list lives in `../subsystems/security.md` section 14-S17.
