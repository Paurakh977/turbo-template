# Architecture B Migration Plan — Secret-Free Web Tier (BFF)

**Status:** Implemented (Phases 0-2 landed; Phase 3 gate executed in-repo)
**Date:** 2026-08-24
**Context:** Follow-up to the production incident chain (`ECONNREFUSED` storms →
`08P01 insufficient data left in message`) root-caused to duplicated `pg` driver
copies bundled inside the Next.js server. Immediate fixes shipped:

- `serverExternalPackages` + explicit deps in `apps/web` (single driver instance)
- TCP-explicit postgres healthcheck (fresh-volume init race)
- `PGHOST/PGUSER/...` libpq fallbacks (defense-in-depth)

This document defines **why** the current architecture is still structurally
inferior, and the **complete plan** to reach Architecture B.

---

## 1. Current architecture (A)

```
            ┌─────────────── internet ────────────────┐
            ▼                                          ▼
      ┌──────────┐   /api/*  ┌─────────┐        ┌────────────┐
      │  nginx   │──────────▶│  api    │──────┐ │    web     │◀── browser
      │ (proxy)  │           │ NestJS  │      │ │  Next.js   │
      └──────────┘           │BetterAuth│     │ │ BetterAuth │
                             └────┬────┘     │ │  (2nd run) │
                                  │          │ └─────┬──────┘
                                  ▼          ▼       ▼
                            ┌────────────────────────────┐
                            │         postgres           │
                            │  TWO pools, TWO secrets,   │
                            │  TWO runnable auth instances│
                            └────────────────────────────┘
```

Both `api` and `web` containers receive `DATABASE_URL` **and**
`BETTER_AUTH_SECRET`. Each runs a complete Better Auth instance
(`@repo/auth`). The browser-facing client (`authClient`) already talks to the
API via nginx (`/api/auth/*` upstream) — only *server-side* web code touches
the DB directly.

### Inventory of web's server-side `auth.api.*` call sites

| File | Calls |
|---|---|
| `src/app/dashboard/layout.tsx` | `getSession` |
| `src/app/dashboard/page.tsx` | (client hooks + actions below) |
| `src/app/dashboard/actions.ts` | `getSession` |
| `src/app/dashboard/settings/actions.ts` | `getSessionOrRedirect` |
| `src/app/dashboard/notes/page.tsx` | `getSession`, `userHasPermission` ×4 |
| `src/app/dashboard/notes/actions.ts` | `getSession`, `userHasPermission` ×3 |
| `src/lib/require-admin.ts` | `getSession`, role checks |
| `src/lib/require-operator.ts` | `getSession`, role checks |
| `src/lib/check-permission.ts` | `userHasPermission` |
| `src/app/admin/page.tsx` | `listUsers` |
| `src/app/admin/actions.ts` | `sendVerificationEmail` |
| `src/lib/server-audit.ts` | header plumbing (stays) |

---

## 2. Issue register — why architecture A is not prod-grade

### Security

| ID | Severity | Issue |
|----|----------|-------|
| S1 | **Critical** | `DATABASE_URL` lives in the internet-facing tier. Any web-tier compromise (Next.js CVE, malicious npm dep, SSRF→env) yields **full DB access** — arbitrary reads/writes/deletes, not just auth bypass. |
| S2 | **Critical** | `BETTER_AUTH_SECRET` is duplicated across two tiers. Whoever steals web's env can forge sessions/tokens offline — no DB needed. |
| S3 | High | Web image ships `pg`, Prisma WASM runtimes, driver adapters — extra supply-chain surface in the most exposed tier, for functionality that belongs behind the API. |
| S4 | Medium | Secrets appear in more places to leak: crash dumps, `printenv` debugging, orchestrator inspect output, log-redaction mistakes. |

### Reliability

| ID | Severity | Issue |
|----|----------|-------|
| R1 | High *(realized)* | Bundled-driver duplication caused live wire-protocol corruption (`08P01`) and connection chaos. Externals fixed today's manifestation, but the hazard reappears whenever bundling config drifts. |
| R2 | Medium | Two connection pools must share Postgres `max_connections`. Defaults here are `max=10` each; adding replicas multiplies silently → exhaustion manifests as random failures under load. |
| R3 | Medium | **Schema-deploy skew:** the generated Prisma client is compiled *into* web's chunks. A schema change requires rebuilding/redeploying **both** images in lockstep; during rollout the old web bundle queries the newly migrated schema. |

### Operations & consistency

| ID | Severity | Issue |
|----|----------|-------|
| O1 | Medium | Secret rotation touches every tier holding copies (violates single-point-of-rotation hygiene). |
| O2 | Low | Web image carries DB-layer weight (driver, wasm, store dirs) — build surface and attack surface for zero web-owned value. |
| C1 | **High** | **API-tier protections are bypassed.** NestJS's throttler, logging interceptors, helmet, and the audit plugin apply to requests hitting the API. Operations web performs locally (`sendVerificationEmail`, admin queries) skip all of them — uncounted, unrate-limited, unaudited. |
| C2 | Medium | Permission enforcement is *duplicated*: RBAC decisions execute inside web against the DB directly, so future policy changes must be wired in two places or they silently diverge. |
| C3 | Low | Every new feature must consciously decide which tier owns DB access; the current setup makes the wrong choice the lazy default. |

> Note: `ECONNREFUSED`/`08P01` were symptoms of R1. Architecture B makes that
> entire failure class impossible *by construction* rather than by config.

---

## 3. Target architecture (B)

```
            ┌─────────────── internet ────────────────┐
            ▼                                          ▼
      ┌──────────┐   /api/*  ┌─────────┐        ┌────────────┐
      │  nginx   │──────────▶│  api    │◀───cookie-forwarded
      │ (proxy)  │           │ NestJS  │        │    web     │
      └──────────┘           │BetterAuth│       │ (NO secrets)│
                             └────┬────┘        └────────────┘
                                  ▼
                            ┌──────────────────┐
                            │     postgres     │
                            │ ONE pool, ONE    │
                            │ secret holder    │
                            └──────────────────┘
```

**Principle:** the internet-facing tier holds no database credentials and no
auth-signing secret. Web performs server-side auth operations by calling the
API's existing Better Auth HTTP endpoints, forwarding the incoming request's
cookies. Session *state* continues to live wherever Better Auth stores it
(DB or Redis secondary storage) — owned solely by the API.

Key insight enabling low-cost migration: the browser already uses these exact
HTTP endpoints. Server components simply become another HTTP client — no new
API surface required for phase 1.

---

## 4. Changes to be made

### Phase 0 — groundwork (no behavior change)

| # | Change | File(s) |
|---|--------|---------|
| 0.1 | Add typed HTTP auth gateway: cookie-forwarding wrappers `getSessionFromApi()`, `listUsersFromApi()`, `sendVerificationEmailFromApi()` using `INTERNAL_API_URL`; 5 s timeout; maps JSON error codes (`EMAIL_NOT_VERIFIED`, etc.) to the same shapes call sites expect | `apps/web/src/lib/server/auth-http.ts` (new) |
| 0.2 | Propagate client IP on internal hops (`X-Forwarded-For`) so API-side Better Auth rate limiting keeps working for server-initiated calls; set `Origin` header to the public app URL to satisfy CSRF/trusted-origin checks | same file |
| 0.3 | Verify `@repo/auth` subpath exports used by web (`/roles`, `/permissions`, `/password-policy`) are **pure modules** (no `db`/`auth` import) — they stay | `packages/auth/package.json` |

> **Permission checks (post-migration correction):** web must NOT call
> `/api/auth/admin/has-permission`. With forwarded cookies that endpoint
> always evaluates the SESSION user's permissions and ignores `body.userId`,
> which silently breaks impersonation semantics (an admin impersonating a
> plain user would lose their own powers in the UI, or worse, UI verdicts
> would diverge from API enforcement). Web instead calls
> `GET /api/users/me/permissions` (`apps/api/src/users/users.controller.ts`),
> which evaluates the EFFECTIVE user's fresh DB role against the same
> access-control roles the admin plugin registers. Cookie forwarding is
> MANDATORY on every internal call: the domain gateway (`internal-api.ts`)
> auto-pulls `next/headers` when a caller doesn't pass headers explicitly;
> the auth gateway (`auth-http.ts`) requires headers to be passed explicitly
> by the caller.

### Phase 1 — migrate call sites (one PR per group, deployable independently)

| # | Group | Files | Notes |
|---|-------|-------|-------|
| 1.1 | Dashboard shell | `dashboard/layout.tsx`, `dashboard/page.tsx`, `dashboard/actions.ts` | Highest traffic — proves pattern |
| 1.2 | Guards | `lib/require-admin.ts`, `lib/require-operator.ts`, `lib/check-permission.ts` | Pure swap of data source |
| 1.3 | Notes RBAC | `dashboard/notes/page.tsx`, `notes/actions.ts` | `userHasPermission` ×7 |
| 1.4 | Settings + audit plumbing | `settings/actions.ts`, `lib/server-audit.ts` | |
| 1.5 | Admin surface | `admin/page.tsx`, `admin/actions.ts` | `listUsers`, `sendVerificationEmail` |

Each replacement: `auth.api.X({headers})` → `XFromApi(headers)`; delete the
file's `import { auth } from '@repo/auth'`.

### Phase 2 — strip secrets & DB stack from web

| # | Change | File(s) |
|---|--------|---------|
| 2.1 | Remove `DATABASE_URL`, `BETTER_AUTH_SECRET`, `PG*` vars from web service | `docker-compose.yml` |
| 2.2 | Remove `pg`, `@prisma/client`, `@prisma/adapter-pg` from deps; drop corresponding `serverExternalPackages` entries (evaluate `ioredis`: remove if web no longer uses redis server-side) | `apps/web/package.json`, `next.config.js` |
| 2.3 | Remove dotenv root-.env loading if no longer needed | `next.config.js` |
| 2.4 | Guardrail: CI/dev script asserting web's runtime env contains **no** `DATABASE_URL`/`BETTER_AUTH_SECRET` (fail build otherwise) | `scripts/check-web-secrets.(ps1|sh)` + CI hook |
| 2.5 | Update `.env.example` docs and compose comments | `.env.example`, `docker-compose.yml` |

### Phase 3 — verification gate (all must pass)

| # | Test | Pass criteria |
|---|------|---------------|
| 3.1 | Cold boot `--profile prod` from empty volumes | all healthy, 0 errors |
| 3.2 | signup → sign-in → dashboard ×10 sequential + ×10 concurrent | all 200, no 500/timeout |
| 3.3 | logout, 2FA enable/verify, password change | flows intact |
| 3.4 | Notes CRUD across roles (user/operator/admin) | RBAC verdicts identical to pre-migration |
| 3.5 | Admin: listUsers, ban/unban, setRole, revokeSessions, impersonation | intact; audited via API |
| 3.6 | `docker exec web printenv` | **no** `DATABASE_URL`, `BETTER_AUTH_SECRET`, `PG*` |
| 3.7 | Kill API container mid-dashboard-render | graceful 503/error boundary, no hang |
| 3.8 | Image diff | web no longer contains pg/prisma artifacts |

### Rollback

Per-group revert of Phase 1 commits restores local `auth.api` usage; Phase 2
env/dep removal reverts in one commit. No data migrations involved — fully
reversible until Phase 2.1 lands (and even then reversible by restoring env).

---

## 5. Explicit non-goals / kept as-is

- Browser `authClient` — already API-backed via nginx; untouched.
- `migrate` one-shot job remains the sole schema owner.
- Seeding already goes through the API's HTTP auth (it was the precedent).
- Better Auth storage choice (DB vs Redis secondary) becomes irrelevant to web.

## 6. Follow-ups (separate track)

- pnpm ≥9.5 + `catalog:` to single-source `@prisma/*` / `pg` versions monorepo-wide.
- Consider moving `getFreshRoleAction`-style server actions onto the same
  gateway helper for uniform error mapping.

---

## 7. Effort estimate

| Phase | Estimate |
|-------|----------|
| 0 | ~½ day (gateway + IP/origin handling + tests) |
| 1 | ~1–1.5 days across 5 small PRs |
| 2 | ~¼ day |
| 3 | ~½ day |
| **Total** | **~2.5–3 focused days**, each phase independently shippable/revertible |
