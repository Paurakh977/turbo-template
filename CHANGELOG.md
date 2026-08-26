# Changelog — Audit & Hardening Session (2026-08-25)

**Base commit:** `1f6bae2` — "chore(cleanup): Architecture B residue"
**Scope:** Full-stack security/consistency audit of the Architecture-B migration
(`8dc599b..1f6bae2`), every file reviewed, ~40 defects found and fixed across
API, web, packages, and infra. All changes currently **uncommitted** — review
then commit as one atomic unit (several pieces depend on each other).
**Final verification:** typecheck / lint / unit tests / production builds /
web-secrets guardrail all green; every fix proven against a live running
stack (real sign-ups, TOTP generation, impersonation, redirects).

---

## TL;DR — what was wrong

1. The Architecture-B migration left **RBAC semantics broken** (web-side
   permission checks evaluated the wrong user during impersonation) and
   duplicated enforcement.
2. Several **security holes**: forgeable audit trail, anonymous CRUD on
   `/api/links`, double CORS registration, localhost CORS origins in prod,
   session token cached in `sessionStorage`, XSS crash via crafted query
   params.
3. A **dormant Prisma schema drift** (born Aug 16, activated by a client
   regeneration) killed 2FA with `P2022`.
4. Rate limiting was **mis-tuned** (hottest endpoint had the smallest bucket)
   and its Redis storage was non-atomic.
5. Assorted UX/consistency bugs (modal focus theft, 2FA double-submit,
   operators unable to see all notes, email-verification page always showing
   "failed", dead code, stale docs).

---

## 1. RBAC rework — single enforcement point, impersonation-safe

**Root cause:** Better Auth's `POST /api/auth/admin/has-permission` always
evaluates the **session user's** permissions and ignores `body.userId` when a
cookie is forwarded (verified in better-auth@1.6.29 dist + docs). Web called
it 4× per notes page with an "effective user id" that was silently ignored —
during impersonation the UI checked the *target's* powers instead of the
acting admin's, diverging from API-side enforcement.

**Fix**
- **New `GET /api/users/me/permissions`** (`apps/api/src/users/users.controller.ts`):
  evaluates the **effective user** (`getEffectiveUserId` → impersonating admin
  while impersonating) against the same `ADMIN_PLUGIN_ROLES` access-control
  objects better-auth uses, locally — **1 DB query per request** instead of 10.
- Deleted `userHasPermissionFromApi` from the web gateway; all call sites
  (notes page/actions, settings page/actions, `check-permission.ts`) migrated
  to `getMyPermissionsFromApi()`.
- `callInternalApi` now auto-pulls `next/headers()` when a caller forgets to
  forward headers — the missing cookie-forwarding was the true root cause of
  the original "401 on every guarded route" incident (a stale web build hid it).
- Docs (`docs/architecture-b-migration.md` §0) updated with the has-permission
  warning so nobody re-introduces it.

**Verified live:** superAdmin verdicts correct; while impersonating a plain
user, permissions resolve to the acting admin's (the exact broken case).

## 2. Notes RBAC parity restored (operator regression)

**Root cause:** when notes logic moved server-side, `canListAll` was
translated to `hasAdminRole` — but the pre-migration implementation gated
visibility on the **`notes.list` permission (operator+)**. Operators lost
access to other users' notes.

**Fix:** `notes.service.listForSession` uses `hasOperatorRole` (= exact role
set carrying `notes.list`); admin+ remains the bar for *editing others'* notes.
Full matrix re-verified against the reference commit's behavior.

## 3. Rate limiting — why everything 429'd locally, and the real fixes

**Root causes**
- `get-session` had a fixed **60/min** bucket while being the hottest path in
  the app (every server render resolves it under Architecture-B, plus browser
  focus refetch per tab). Two accounts alt-tabbing exhausted it in seconds.
- Better Auth's limiter key is `ip|path` (per-IP by design) — locally all
  traffic shares one IP, so both accounts share every bucket.
- The Redis secondary storage had no atomic `increment`, so the limiter ran
  in racy "best-effort" mode (boot warning).

**Fix**
- `get-session` 60→**300/min**, `list-accounts` 30→60 (still bounds abuse;
  the read is an indexed per-user DB query - better-auth does not cache it).
- `secondaryStorage.increment` implemented (atomic Lua `INCR`+`EXPIRE`,
  fixed window from first hit, degrades open on Redis failure) — strict
  enforcement, boot warning gone.
- `secondaryStorage.getAndDelete` added (`GETDEL`) — closes the read-then-
  delete race on single-use tokens.
- Audit page renders a friendly "Slow down a little" card on 429 instead of
  crashing into the error boundary.
- `RATE_LIMIT_*` / `SESSION_*` / `TWO_FACTOR_*` tuning knobs are now actually
  injected into the api containers (they were documented but never wired) and
  pass through turbo's strict env mode.

## 4. Security fixes

| Issue | Fix |
|---|---|
| Any authenticated user could **forge audit rows** (arbitrary action + 2 MB metadata) via `POST /api/audit-logs` | Action allowlist (`profile_updated`, `theme_changed`, `labs_toggled`) + 4096-char metadata cap |
| **Anonymous create/update/delete** on `/api/links` (memory-growth DoS, data tampering) | Mutations removed; read-only GET kept `@AllowAnonymous` for the landing page (an intermediate version dropped the decorator and 401'd anonymous visitors — caught and fixed in second-pass review) |
| **Double CORS registration**: thallesp auto-registers a 2nd CORS layer from better-auth trustedOrigins (no PATCH, divergent list) → random 500s | `disableTrustedOriginsCors: true`; `main.ts` is the single CORS authority |
| Localhost origins granted **credentialed CORS in production** | Gated behind `NODE_ENV !== 'production'`; deny path no longer throws (was an unfiltered 500), now `callback(null, false)` |
| **Session token cached in `sessionStorage`** (XSS-readable) | `stripSessionSecrets()` strips token/IP/UA before caching |
| `decodeURIComponent()` **crash** on crafted `?error_description=100%` (auth + landing pages) | `safeDecodeParam()` helper, used at both call sites |
| `/api/health/ready` leaked **driver error strings** publicly | Redacted to `error`, details logged server-side |
| CSP missing `connect-src` — absolute-API-URL mode was self-blocked | Derived from `NEXT_PUBLIC_API_URL` in `proxy.ts` |
| Nothing prevented web from re-importing the DB-bound `@repo/auth` root | eslint `no-restricted-imports` fence (type imports exempt) |
| `typescript.ignoreBuildErrors: true` | `false` — type errors fail builds |
| Password inputs were `.trim()`ed inconsistently — space-containing credentials failed 2FA/delete | Passwords now sent verbatim everywhere |

## 5. Prisma migration re-baseline (the 2FA `P2022` incident)

**Timeline (git-verified)**
- **May 16** — last migration ever committed. Everything in sync.
- **Aug 16** (`c25e8c4`) — `auth:generate` regenerated the schema
  (`betterAuth.prisma`): two-factor gained `failedVerificationCount` +
  `lockedUntil`; `user.banned` index dropped. **Committed with no migration.**
- **Aug 25, 00:03** — Prisma client regenerated from the drifted schema
  (install churn). Every 2FA query now selects columns the DB lacks.
- **Aug 25, 12:56** — first 2FA attempt → `P2022: column does not exist`.

**Fix (as requested: full re-baseline, not a patch)**
- All 9 legacy migrations deleted; **one `20260825120000_init`** generated via
  `prisma migrate diff --from-empty --to-schema` (matches schema exactly).
- Dev DB reset, init applied, admin re-seeded; `prisma migrate dev` now
  reports **"Already in sync"**.
- Proven: fresh DB bootstraps from the single init (10 tables);
  `auth:generate` on current code produces **zero schema diff**;
  `db:migrate:dev` after it is a no-op — the future cycle is healthy.
- Guardrail: `pnpm auth:generate` now prints a reminder to run
  `db:migrate:dev` (the skipped step that caused this).

## 6. Email verification UX ("verified but shows failed")

**Root cause (proven live):** better-auth's `/api/auth/verify-email` consumes
the token **server-side** and redirects to the callback URL **bare on
success** (302, no params) and with `?error=CODE` only on failure. The page
treated "no `?token=`" as failure — so the success path could never render.

**Fix:** bare arrival ⇒ success state ("Email verified!") → dashboard;
`?error=` ⇒ failure; `?token=` (hand-crafted links) still verified
client-side. Redirect contract asserted with a live 302 test.

## 7. Bug fixes (web)

- **ActionDialog**: single effect keyed `[open, pending]` ran its cleanup on
  every pending flip — releasing the scroll lock and stealing focus behind an
  open dialog mid-request. Split into lifecycle (`[open]`) + keyboard
  (`[open, pending]`) effects.
- **2FA dialogs**: no pending state (double-submit) and no try/catch (silent
  failures) → `enabling`/`verifying` props + error handling.
- **Admin gating**: UI used permission-proxy checks (`user:['ban']`) while
  guards use role tokens → unified on `hasAdminRole` so UI can't drift.
- **Admin lookup**: `.catch(() => null)` reported API-down as "User not
  found" → honest error surfaced.
- **Copy bugs**: "AdminTableUser banned." toasts/column → real names;
  `unban(userId)` signature bug.
- Toast ID collisions (same-ms) → `crypto.randomUUID`-based.
- Hydration warnings on relative note timestamps → `suppressHydrationWarning`.
- Two-factor page wrapped in `Suspense` (prereq-safe `useSearchParams`).
- Audit filter inputs got `aria-label`s; audit list clamps long `q`/`action`
  instead of rejecting (bookmarks degrade, not 400).
- Missing root `error.tsx` / `not-found.tsx` added (admin segment crashed raw);
  missing `public/logo.svg` created (referenced 8×, never existed).
- Landing metadata: "Create Next App" → proper title template.

## 8. Bug fixes (API & infra)

- `http-exception.filter`: exception body could spoof `statusCode`/`path` →
  envelope fields now applied after the spread.
- **Prisma never disconnected on shutdown** → `DatabaseShutdown` hook +
  `disposeExternalPool: true` (pool actually closes on SIGTERM).
- `GET /api/notes` was **unbounded** → `ListNotesQuery` (limit 1–500 default
  200, offset 0–10k) + `total` in response.
- Duplicated `extractClientMeta` → shared `common/client-meta.ts`.
- api-dev healthcheck probed `/api` (guaranteed 404 → container flapped) →
  `/api/health/live` everywhere; Dockerfile healthcheck honors runtime
  `PORT` (was hardcoded 3001).
- api-dev/web-dev ports published on `0.0.0.0` + RFC1918-wide
  `trustedProxies` = LAN XFF spoofing → bound to `127.0.0.1`.
- Redundant per-controller `AuthGuard`s removed (global APP_GUARD already
  resolved sessions — every domain request ran `getSession` twice).
- `DATABASE_URL` no longer passed as a Docker build arg (placeholder in
  builder stage; credentials out of build cache/provenance).
- nginx: removed cargo-cult `zone` directive (OSS nginx gains nothing; the
  comment was wrong about health checks).

## 9. Cleanup / consistency

- **Dead code removed**: `require-operator.ts`, `requestPasswordResetAction`,
  `src/env.ts`, `tailwind_test/` route, link DTOs + `@nestjs/mapped-types`,
  `escape-html` (api), `crypto-js` (database), `REPORT_ONLY` in
  check-web-secrets, stale `/admin/has-permission` client pattern.
- `.env.example`: un-glued `NEXT_ALLOWED_DEV_ORIGINS` line (broke fresh
  setups); documented `INTERNAL_API_URL` for host runs; **unit-corrected**
  `TWO_FACTOR_OTP_PERIOD` (better-auth takes **minutes**; 180 meant 3-hour
  OTPs — now `3` with explicit unit docs).
- `BETTER_AUTH_URL` removed from the web tier (dev matches prod);
  auth-client SSR fallback prefers `NEXT_PUBLIC_APP_URL`.
- Both gateway error messages now explain exactly how to fix a missing
  `INTERNAL_API_URL`.
- `GETTING_STARTED.md`: pnpm 11.23.0, script/glob corrections, mojibake
  repaired; `apps/web/.env.example` rewritten truthfully; migration doc §0
  rewritten; `audit.controller` duplicate docblock removed; orphaned
  `requestPasswordResetFromApi` export removed.

## 10. Verification performed

- `turbo typecheck / lint / test` — 15/15 green; `pnpm build` green (strict
  types); `guard:web-secrets` clean.
- Live prod-stack E2E: sign-in → guarded routes (previously 401) → notes
  CRUD → forged-audit-row rejected (400) → impersonation permissions resolve
  to acting admin → unauth 307→/auth → web `printenv` contains no secrets.
- 2FA full lifecycle on a live API: enable → **real generated TOTP verified**
  → wrong code rejected → disable. Email-verification redirect contract
  asserted (302 bare vs `?error=`).
- Prisma: fresh-DB bootstrap from single init; `auth:generate` → zero diff;
  `migrate dev` → "Already in sync".

## 11. Follow-ups (known, deliberately not done here)

- NestJS ThrottlerGuard runs *after* the Better Auth session guard (guard
  ordering) — session cost is paid before throttling on some routes.
- Audit writes on HTTP paths are best-effort-BLOCKING (`await`ed; failures
  swallowed into server logs); only plugin/`databaseHooks` writes are
  fire-and-forget (availability trade-off, documented).
- `toApiStatus` duplicated across the two web gateways — consolidate if a
  third gateway appears.
- CI: consider SHA-pinning GitHub Actions; `--max-warnings 0` once the
  existing warning backlog is cleared.
- `GETTING_STARTED.md` had encoding damage from earlier tooling — repaired,
  but watch for editor/terminal encoding on Windows (PowerShell 5.1 writes
  BOMs; use UTF-8 without BOM for SQL/migration files).

---

## 12. Second-pass audit fixes — H1–H4 (same day)

Full-codebase re-audit of everything above (4 parallel deep-explores of API,
web, packages, infra/CI/docs) surfaced five high-severity defects and several
mediums. Four high-severity items fixed now; full register with rationale and
verification steps lives in **`issues.md`**. Typecheck / lint / test 15/15
green after all changes.

| # | Defect | Fix |
|---|---|---|
| H1 | `trustedOrigins` included `http://localhost:3000` + `https://localhost` **unconditionally** — Better Auth's CSRF origin allowlist trusted localhost in production while `main.ts` CORS gates the exact same origins behind `NODE_ENV` (contradictory layers) | Both entries now wrapped in `!isProduction`; local HTTPS prod stacks unaffected because `.env.example` ships `TRUSTED_ORIGINS=https://localhost` (`packages/auth/src/auth.ts`) |
| H2 | Missing `BETTER_AUTH_SECRET` silently booted production on the public constant `'build-time-placeholder-secret'` — module-load-time fallback meant "real values take effect at server start" was false; forgeable sessions/TOTP/OAuth tokens on any misconfigured host-run deploy | Placeholder kept only for Next build-time evaluation (`NEXT_PHASE === 'phase-production-build'` exemption); every server boot in production without a real secret now throws before betterAuth constructs (`packages/auth/src/env.ts`, `auth.ts`) |
| H3 | Audit rows recorded **attacker-forgeable IPs**: `extractClientMeta` read leftmost `X-Forwarded-For`, but nginx *appends* the real peer — client-sent first entry won | Resolution reordered to `req.ip` first (`trust proxy = 1` ⇒ rightmost-untrusted hop, correct through nginx→api *and* nginx→web→api), then nginx-overwritten `x-real-ip`; leftmost parsing deleted; no other XFF parsers remain (`apps/api/src/common/client-meta.ts`) |
| H4 | Turbo served stale builds when `NEXT_PUBLIC_*` changed: vars were inlined into client bundles at build time but not part of the cache hash (no `env` keys on `build`, strict env mode never actually enabled) → cached bundles shipped old baked-in URLs; CI-built `http://localhost:3000` bundles eligible for prod reuse | `"env": ["NEXT_PUBLIC_API_URL", "NEXT_PUBLIC_APP_URL", "NEXT_ALLOWED_DEV_ORIGINS"]` added to the `build` task so env changes invalidate the hash (`turbo.json`). Repo-wide `envMode: strict` deliberately deferred |

**Deferred (documented in `issues.md`, not scheduled here):** H5 — api image
prune-list guarded by a nonexistent boot test (comment contradicts reality;
CI builds no images); compose-wide resource/log limits; rate-limit fail-open
on Redis outage; ThrottlerGuard-after-AuthGuard ordering; non-atomic token
fallbacks; unvalidated numeric env parsing; audit metadata namespace collision;
`assertAdmin` stale-role fallback; missing `expiresAt` indexes.

---

## 13. Third-pass audit fixes — P0–P3 (same day)

Hands-on re-verification of every open finding (each reproduced against
source before fixing), excluding the deferred infra items (H5 image boot
gate, compose resource limits — unchanged). Typecheck/lint/test/build +
both web guards green after all changes; unit suite grew a regression test
for the empty-patch rejection.

### Security

| # | Defect | Fix |
|---|---|---|
| P0-1 | **Forgeable audit IPs persisted in `packages/auth`**: all 8 `auditLogPlugin` hooks + `databaseHooks` read raw leftmost `x-forwarded-for`, which nginx only *appends* to — reopening exactly the H3 hole the previous pass declared closed | New shared resolver `packages/auth/src/client-ip.ts`: walks XFF right-to-left past `TRUSTED_PROXY_CIDRS`, falls back to `x-real-ip`, else unknown. All 10 read sites migrated; better-auth's `trustedProxies` now consumes the same exported list (single source of truth) |
| P0-2 | Any user could forge "performed via impersonation by <admin>" audit trails: client metadata passed through untouched and `listForAdmin` renders `metadata.impersonatedBy` as an identity | Server-owned keys (`performedViaImpersonation`, `impersonatedBy`) stripped from client-supplied metadata via `common/audit-metadata.ts` before the server merges its own markers; applied in both audit + notes writers |
| P0-3 | `/api/rate-limit/check` accepted any regex-clean `scope`, minting unbounded Redis keys (TTL ≤1h) per account | Closed allowlist `SERVER_ACTION_SCOPES` in `packages/roles` — the SINGLE SOURCE shared by both tiers. **First attempt listed only 3 bare names and missed the `<family>:<action>` prefixes web actually composes (`notes:create-note`, `settings:delete-account`, …) — it 400'd every rate-limited action including account deletion. Caught in the adversarial re-review before commit; the allowlist now enumerates all 9 real strings web sends, lives in `@repo/roles` so drift is impossible, and a DTO contract test pins every scope web uses** |
| P0-4 | `assertAdmin` fell back to the possibly-elevated session-snapshot role when the DB row was missing (deleted admin keeps listing audit logs) | Deny-by-default: missing row ⇒ 403; convoluted fake-session rebuild deleted |
| P0-5 | Production without `RESEND_API_KEY` silently disabled `requireEmailVerification` (unverified sign-ups) | Boot throws in production without a mail provider — same fail-fast philosophy as H2; explicit `EMAIL_VERIFICATION=relaxed` opt-out documented in both `.env.example`s |

### Correctness

| # | Defect | Fix |
|---|---|---|
| P1-6 | ~15 bare `parseInt()` env knobs: `"7d"` became a 7-*second* session, `"abc"` handed NaN to better-auth | `parseIntEnv(name, fallback)` in `packages/auth/env.ts` — empty falls back (compose injects `${VAR:-}`), non-numeric crashes at boot with a named error; same treatment for the pg pool knobs in `packages/database/client.ts` |
| P1-7 | Delete-account trimmed the password client-side, contradicting the server action's verbatim contract — whitespace-containing credentials could never confirm deletion | Trims removed (`SettingsClient.tsx`); emptiness check runs on the raw value |
| P1-8 | Notes update/delete check-then-write races surfaced raw Prisma P2025 as 500s; `{}` PATCH bumped `updatedAt` and wrote an audit row | Conditional bulk writes (`updateMany`/`deleteMany`) map lost races to clean 404s while preserving exact 403 ownership semantics; empty AND whitespace-only patches rejected 400. A delete winning *after* a committed update answers with the pre-update row instead of lying with a 404 — the audit row always reflects the committed write (regression-tested) |

### Consistency / cleanup

| # | Item | Change |
|---|---|---|
| P2-9 | Last surviving per-controller `AuthGuard` (rate-limit route) made `getSession` run twice per request | Removed — global APP_GUARD covers it, like every other domain controller |
| P2-10 | `apps/api/src/env.ts` duplicated the Joi schema with *different* rules (and was falsely reported as deleted last pass) | Deleted; Joi schema gained integer/range PORT validation; `main.ts` reads HOST/PORT via ConfigService after module-init validation |
| P3-11 | Dead code: `lib/check-permission.ts` (zero callers), unreachable admin `ImpersonationBanner` branch (`requireAdmin` redirects impersonators first), duplicated `getImpersonatedBy` in two services | Deleted / de-branched / imported from `common/session.utils` |
| P3-12 | The `@repo/auth` runtime-import fence could never fail CI: `eslint-plugin-only-warn` monkey-patches `Linter.verify`, downgrading every error regardless of config severity | New deterministic guard `scripts/check-web-auth-imports.mjs` (type-only imports exempt), wired as `pnpm guard:web-auth-imports` + CI step next to the secrets guard; ESLint rule kept for editor feedback |
| P3-13 | Docs drift: GETTING_STARTED claimed "pnpm 8" vs pinned 11.23.0 and repeated the debunked "strict env mode" myth; `me/role` vs `me/permissions` impersonation scopes undocumented; stale rate-limit comment cited old 60/30 limits; `packages/auth/.env.example` documented a var nothing reads (`SESSION_COOKIE_MAX_AGE`) and omitted one that is read (`SESSION_FRESH_AGE`) | All corrected; users.controller docblock now states the intentional scope split (role = browsed session user, permissions = acting effective user) and warns against unifying them |

Also in this pass: readiness-probe timeout timer is cleared and `unref()`ed
(was left pending after every successful probe).

### Adversarial re-review of this pass (same day, before commit)

Every fix above was re-audited by an independent deep review; the defects it
found were all repaired:

- **Guard script fail-open trap (HIGH):** the type-import eraser used an
  unconstrained lazy match that could swallow a *following* runtime root
  import (`import type … from './x'; import { auth } from '@repo/auth';`
  scanned clean). Erasure is now statement-bounded (`[^;]` + trailing `;`) and
  implemented as same-length whitespace masking, so reported line numbers stay
  exact; `export type` re-exports and all-`type` named imports are recognized
  as erased. Verified against a fixture tree (trap caught; legit forms pass).
- **`resolveClientIp` hardened (HIGH):** hops are now validated canonically —
  leading-zero octets (`010.0.0.1` masquerading as trusted `10/8`),
  hostnames, and `ip:port` tails abort the whole chain fail-closed (mirrors
  Better Auth's `getIPFromHeader`), instead of persisting attacker-influenced
  garbage into audit rows. `::1` added to the trusted set; the docblock now
  states the real trust semantics (unlimited CIDR-matching hops, i.e.
  Better-Auth-style) rather than claiming parity with Express hop-count trust.
- **Shared audit writer (duplication):** the sanitize-and-merge block existed
  twice (audit + notes services, including the gnarly conditional-type cast);
  extracted to `common/audit-writer.ts`.
- **Dead export:** `getSessionRoleRaw` lost its last caller to P0-4 and was
  removed from `common/session.utils.ts`.
- **Sign-out hook header shapes:** `session.delete.before` now falls back to
  `request.headers` too, matching `extractIpAndUserAgent`.
- **Strict digit parsing:** `parseIntEnv` rejects `"0x10"`/`"1e3"`
  (digits-only); pg pool knobs gained a min-1 guard on `DATABASE_POOL_MAX`
  (0 = pool that can never acquire a client).
- **CI ordering:** the auth-imports guard moved right after install (needs no
  build) so violations fail fastest.
- **Docs debt the first sweep missed:** GETTING_STARTED still pointed at the
  deleted `apps/api/src/env.ts` and mis-claimed web validates auth secrets;
  `apps/web/.env.example` over-claimed validation; pg-pool tuning vars were
  read by code but absent from `.env.example`; a comment now flags that
  deleting `RATE_LIMIT_MAX` yields the in-code default 20, not the sampled
  100; `EMAIL_VERIFICATION=relaxed` got a visible sample line.

---

---

## 14. Fourth-pass fixes — verified defects from the independent re-audit (same day)

Every finding below was first **reproduced against source and library
internals** (better-auth@1.6.29 dist, official docs via Context7) before
fixing; two suspected issues were investigated and deliberately NOT changed
(see "Investigated, not bugs" at the end). Typecheck / lint / test 15/15,
both web guards, `docker compose config`, and production builds all green
after these changes.

### Deployment wiring

| # | Defect | Fix |
|---|---|---|
| F1 | The documented `EMAIL_VERIFICATION=relaxed` escape hatch (P0-5) was **dead under Docker**: `packages/auth` reads it from `process.env` at module load (`auth.ts`), but neither the `api` nor `api-dev` compose env blocks injected it — and containers receive ONLY injected vars (no `.env` is baked into images), so an operator following the docs got a boot-looping prod API anyway | Injected into both compose env blocks with an explanatory comment; sample line added to `apps/api/.env.example` noting it must be kept in sync with the compose entry |
| F2 | The entire e2e harness was git-ignored: a copy-pasted Nest-starter `/test` rule in `apps/api/.gitignore` untracked `apps/api/test/*` (5 files incl. `jest-e2e.json`) — committing per this changelog's instructions would have silently dropped the suite | `.gitignore` rewritten minimal + note; suite recovered as tracked-on-next-commit |

### Security

| # | Defect | Fix |
|---|---|---|
| F3 | `secondaryStorage.getAndDelete` legacy fallback did non-atomic get→del and returned the value **even when del failed** — two consumers could both receive one verification/reset token. Violates better-auth's SecondaryStorage contract verbatim ("enforce single-use guarantees … without falling back to separate get and delete operations") | Fallback is now ONE Lua GET+DEL script (same pattern as `increment()`); Redis < 6.2 stays supported atomically; total storage failure fails CLOSED (null) instead of returning an unconsumed value |

### Correctness

| # | Defect | Fix |
|---|---|---|
| F4 | verify-email success paths pushed `/dashboard`, but verification creates no session (`autoSignInAfterVerification` intentionally off) → layout guard bounced users straight to `/auth`. Also: token-branch success timeout skipped the unmount guard the bare branch had | Both success paths now route to `/auth` ("You can now sign in to your account."); effect rewritten with a single `cancelled` flag + timer cleanup so no navigation fires post-unmount |

### Consistency

| # | Item | Change |
|---|---|---|
| F5 | Hydration fix applied only to NotesClient timestamps; `AdminUserTable` rendered SSR'd `toLocaleDateString()` bare | Same `suppressHydrationWarning` guard added |
| F6 | 2FA challenge-page handlers (`handleVerify`/`sendOtp`) awaited better-auth calls with no exception safety — a rejected request left submit buttons stuck disabled (the §7 fix covered only dashboard dialogs); `forgot-password` was worse: ANY failure silently showed "Check your email" | Both handlers wrapped try/finally; forgot-password catches client-layer rejections and surfaces enumeration-safe errors (better-auth answers success for unknown emails, so errors here are throttle/availability only) |
| F7 | Toast IDs truncated `crypto.randomUUID()` to an int32 (~collision at ~2¹⁶ live toasts) with a colliding `Date.now()` fallback — §7's claim oversold uniqueness | Full UUID strings end-to-end (`ToastItem.id: string`); non-secure-context fallback uses `Date.now()-random` composite |
| F8 | Doc drift found during verification: §3 claimed list-accounts reads were "Redis-cached" (they hit Postgres every call — verified in better-auth dist; the retune itself is real); §11 called HTTP-path audit writes "fire-and-forget" (they are awaited = best-effort-blocking; only plugin/databaseHooks writes are fire-and-forget); `issues.md` still listed P0-2/P0-4/P1-6 as open after §13 fixed them | All three corrected in place |

### Investigated, NOT bugs (left untouched)

- `auth.ts` comment "the read itself is Redis-cached" under `/get-session` —
  accurate for that endpoint: sessions DO live in Redis secondaryStorage.
  Only the list-accounts claims (F8) were false.
- Prisma generated client shipping in the api runtime image, and
  `apps/migrate/pnpm-lock.yaml` existence — both traced end-to-end and
  confirmed correct.

---

*Section 14 fixes verified against source + dependency internals before
implementation; nothing committed.*
