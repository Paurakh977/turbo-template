# End-to-End Testing (Playwright)

This stack is tested through the **real** runtime: the browser drives the app
through the Nginx TLS reverse proxy exactly like a user would. Nothing is
mocked — Postgres, Redis, Better Auth, the NestJS API and the Next.js web app
all run for real (via the `e2e` docker compose profile).

## Architecture

```
Playwright (host/CI runner)
        │  https://localhost:8443  (ignoreHTTPSErrors)
        ▼
      Nginx  (proxy-e2e, TLS, CSP, rate-limit)
        │  /api/*  ──►  api-e2e (NestJS + Better Auth + Prisma)
        │  /*      ──►  web-e2e (Next.js)
        ▼
   postgres-e2e ──►  E2E_DATABASE_URL (direct assertions / seed)
   redis-e2e    ──►  E2E_REDIS_URL    (direct cache assertions / flush)
```

- **No mocking.** `pg` and `ioredis` are used *only* for setup, assertions and
  cleanup (truncate tables, flush Redis). The browser always goes through nginx.
- **Storage states** (`apps/web/e2e/.auth/{role}.json`) are produced by
  `scripts/seed.ts` during `globalSetup` by capturing the real `Set-Cookie`
  from a sign-in request — so role projects start already authenticated.
- **Isolation.** The entire suite uses `.env.e2e` (isolated Postgres/Redis/
  secrets/origins). It never touches local-dev or production data.

## Prerequisites

```bash
pnpm install
pnpm --filter @repo/database db:generate
pnpm --filter web exec playwright install chromium   # + --with-deps on Linux CI
```

## Running

Bring the stack up (builds the dev images once):

```bash
docker compose --env-file .env.e2e --profile e2e up -d --build
```

Run the suite (globalSetup seeds accounts + health-checks the API; globalTeardown
cleans the DB/Redis):

```bash
pnpm --filter web test:e2e                 # headless
pnpm --filter web test:e2e:ui              # interactive
pnpm --filter web e2e:codegen             # record new steps
```

Tear down:

```bash
docker compose --env-file .env.e2e --profile e2e down -v
```

## Test projects

| Project          | Authenticated as        |
| ---------------- | ----------------------- |
| `user`           | `user@test.local`       |
| `operator`       | `operator@test.local`   |
| `admin`          | `admin@test.local`      |
| `superadmin`     | `superadmin@test.local` |
| `unauthenticated`| none                    |
| `mobile`         | `user` (Pixel 5)        |

Some specs are scoped to a single project (e.g. auth UI flows only run in
`unauthenticated`, admin actions only in `superadmin`) via
`test.info().project.name` guards.

## Layout

```
apps/web/e2e/
  config/      playwright.env.ts, users.ts, routes.ts
  helpers/     database, redis, auth, session, api, permissions,
               audit, security, screenshot, accessibility
  pages/       Page Objects (login, register, dashboard, notes,
               settings, admin, audit, two-factor)
  factories/   user, note
  fixtures/    composed test fixtures (db, redis, api)
  scripts/     seed.ts, cleanup.ts
  tests/       auth, rbac, admin, notes, settings, audit, security,
               ratelimit, proxy, health, a11y, responsive, visual,
               errors, performance
global.setup.ts / global.teardown.ts / playwright.config.ts
```

## Coverage map

See the implementation spec for the full category list. Each category under
`tests/` has at least one spec; security headers, CSP, rate limits, RBAC, audit
logging, 2FA, accessibility (axe-core), responsive (mobile viewport), visual
snapshots and performance (LCP/CLS) are all exercised against the real stack.

## Adding a test

1. Add a Page Object method under `pages/` if you drive new UI.
2. Prefer the composed `test` from `fixtures/page.fixture`.
3. For API assertions use the `api` fixture (`ApiClient`) — it already hits
   nginx and carries the superadmin cookie.
4. For data setup/assertions use `db` / `redis` fixtures.
5. Seed/cleanup of volatile data is automatic; never commit test data.
