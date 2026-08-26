# Issues & Fix Plan — Audit Session 2026-08-25

Findings from the full-codebase audit (API, web, packages, infra, CI, docs).
Status legend: `[x]` fixed · `[ ]` planned/deferred.

---

## [x] H1 — Production trusts `localhost` as a "trusted origin" — FIXED

**File:** `packages/auth/src/auth.ts` (`trustedOrigins`)
**Malfunction:** `'http://localhost:3000'` and `'https://localhost'` were
unconditionally in Better Auth's CSRF origin allowlist, even in production.
The API's own CORS layer explicitly gates these behind `NODE_ENV !== 'production'`
(`apps/api/src/main.ts`) citing exactly this hazard — the two layers
contradicted each other. Any local process serving a page on localhost could
send credentialed-looking requests that passed Better Auth's origin check;
blast radius was contained only by undocumented reliance on `SameSite=Lax`
cookies. Trusted-origin lists also feed redirect/callbackURL validation.

**Fix:** gate both hardcoded entries behind `isProduction` (exported from
`packages/auth/src/env.ts`). Local HTTPS prod-profile stacks keep working
because `.env.example` ships `TRUSTED_ORIGINS=https://localhost`, which is
merged in via the env branch.

**Verification:** typecheck/lint; prod-stack curl with spoofed
`Origin: http://localhost:3000` rejected, legit origin accepted; dev sign-in flow unaffected.

---

## [x] H2 — Missing `BETTER_AUTH_SECRET` boots with a public constant — FIXED

**Files:** `packages/auth/src/env.ts`, `packages/auth/src/auth.ts`
**Malfunction:** when `BETTER_AUTH_SECRET` was unset, production silently fell
back to the literal string `'build-time-placeholder-secret'`. The fallback was
written for Next build-time page-data evaluation ("real values take effect when
the server starts"), but `export const secret = ...` evaluates **once at module
load** — there is no second evaluation. A misconfigured deployment booted
healthy while signing session cookies, OAuth tokens, and TOTP encryption with a
key readable in the public repo → forgeable sessions for any user including
superAdmin. Upstream better-auth throws in this situation; the placeholder
bypassed that safety net, and only the NestJS API tier had Joi protection.

**Fix:** keep the inert build-time fallback but expose `usingPlaceholderSecret`;
in `auth.ts`, throw before constructing betterAuth when in production, the
placeholder is active, and it is NOT the Next build phase
(`NEXT_PHASE === 'phase-production-build'`). Every server-boot path now fails
loudly; builds stay green.

**Verification:** `pnpm build` green (exemption works); API boot with secret
unset + `NODE_ENV=production` crashes with explicit error; normal prod stack boots fine.

---

## [x] H3 — Audit-log IP addresses were attacker-forgeable (leftmost XFF) — FIXED

**File:** `apps/api/src/common/client-meta.ts`
**Malfunction:** the helper took `X-Forwarded-For.split(',')[0]` — the
**leftmost** entry — which is fully client-controlled. nginx *appends* the real
peer (`$proxy_add_x_forwarded_for`), so a client sending
`X-Forwarded-For: 8.8.8.8` produced chain `"8.8.8.8, <real-ip>"` and every
API-written audit row recorded `8.8.8.8`. Insider forensics poisoned; ironically
better-auth rows in the same table resolved correctly because
`packages/auth` uses right-to-left trusted-hop stripping (`trustedProxies`).

**Fix:** resolve `req.ip` first — `main.ts` sets `trust proxy = 1`, so Express
trusts the immediate peer (nginx or the web relay) and returns the rightmost
untrusted hop = the true client appended by nginx. This is correct in every
current topology (nginx→api direct and nginx→web→api). Fallback order:
`req.ip` → `x-real-ip` (nginx overwrites it, trustworthy) → null. Leftmost-XFF
parsing deleted.

**Verification:** unit test with forged multi-hop XFF returns the real hop;
live curl with spoofed XFF writes the real client IP to the audit row.

---

## [x] H4 — Turbo cache served stale bundles with old baked-in URLs — FIXED

**File:** `turbo.json` (`build` task)
**Malfunction:** Next.js inlines `NEXT_PUBLIC_*` variables into client bundles
at **build time**, but turbo's `build` task declared no `env` keys and
`envMode:"strict"` is not enabled. In loose env mode, vars pass through to
processes but are **not hashed** — changing `NEXT_PUBLIC_APP_URL` produced an
identical input hash → cache HIT → old `.next` output restored with the OLD URL
baked into JS chunks. Deploys shipped browser bundles calling the wrong origin
(cookie domain mismatch, CSP `connect-src` blocking the right API). CI built
with `http://localhost:3000`, polluting the shared cache space with literally-wrong
artifacts eligible for prod reuse. (The CHANGELOG's earlier claim of "turbo
strict env mode" was inaccurate.)

**Fix:** declare `"env": ["NEXT_PUBLIC_API_URL", "NEXT_PUBLIC_APP_URL",
"NEXT_ALLOWED_DEV_ORIGINS"]` on the `build` task so env changes invalidate the
hash. `envMode: strict` deliberately deferred — enabling it repo-wide would fail
tasks using undeclared vars; logged as follow-up.

**Verification:** double `pnpm build` → second run full cache HIT; env change →
cache MISS with new URL found in `.next/static` chunks.

---

## Deferred (documented, not scheduled)

### [ ] H5 — API Dockerfile prune-list guarded by a nonexistent test
`apps/api/Dockerfile.prod:66-106` deletes ~25 dependency-tree globs claiming
"a boot smoke test guards the whole list" — no such test exists anywhere, and
CI never builds images. Any dependency bump that changes what better-auth/prisma
eagerly import ships an image that builds clean and crash-loops on first boot
(`MODULE_NOT_FOUND`) → healthcheck never passes → web/proxy never start → full outage.
The migrate image has the correct pattern (`RUN prisma version` gate).
**Plan:** preferred — CI job that builds both prod images and probes their
healthcheck endpoint once; alternative — builder-stage smoke
(`node dist/main` against placeholder env with timeout). Reconcile the comment either way.

### [ ] M1 — Zero resource limits across docker-compose services
No `mem_limit`/`cpus`/`pids_limit` on any of the 10 services; default json-file
log driver is unbounded. Failure modes: OOM-killer cascade (Postgres spike kills
Redis → everyone logged out AND rate limiting fails open simultaneously);
weeks of log growth filling disk under a chatty error loop; fork-bomb/crypto
jobs getting all host cores.
**Plan:** shared logging anchor (`json-file`, max-size 10m ×3) + per-service caps:
postgres 1g/1.5cpu/pids 200 · redis 256m/-/100 · api 512m/1.5cpu/120 ·
web 512m/1cpu/120 · pgadmin 256m/-/50 · proxy 128m/-/50 · migrate 256m.

### Other known mediums (from audit, not yet scheduled)
- Rate limiting fails open during Redis outage (`packages/auth/src/auth.ts` increment catch → 0)
- ThrottlerGuard registers after AuthGuard — every request pays session resolution before 429
- Notes check-then-write TOCTOU; ~5 sequential round trips per mutation
- Missing indexes: `session.expiresAt`, `verification.expiresAt`, `jwks.expiresAt`
- Web tier: unvalidated `INTERNAL_API_URL` receives forwarded cookie jar; header-inferred email origins

(Fixed since this register was written — do not re-triage: audit metadata
forgery and `assertAdmin` stale-role fallback [§13 P0-2/P0-4], unvalidated
`parseInt` knobs [§13 P1-6], non-atomic GET+DEL token fallback [now one Lua
GET+DEL script in `secondaryStorage.getAndDelete`, failing closed].)
