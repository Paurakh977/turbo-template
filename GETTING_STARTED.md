# Getting Started — Template Turbo Repo

A pnpm + Turborepo monorepo: **Next.js web** (`apps/web`), **NestJS API** (`apps/api`),
shared packages (`@repo/auth`, `@repo/database`, `@repo/ui`, ...), and a
**Docker Compose** stack with **Postgres, Redis, pgAdmin, and nginx** (TLS proxy
with rate limiting).

- Stack: Turborepo 2.x - pnpm 11.23.0 (repo-pinned) - Next.js 16 - NestJS 11 - Prisma 7 (driver adapters) - Better Auth 1.x
- The Prisma client is generated **inside** `packages/database/src/generated/prisma` (Prisma v7 no longer uses `node_modules/.prisma`).

---

## 1. Prerequisites

| Tool | Version | Why |
|---|---|---|
| Node.js | >= 20 (tested on 22) | modern APIs, Prisma 7 |
| pnpm | 11.23.0 (repo-pinned) | workspace package manager |
| Docker Desktop | latest | Postgres/Redis/pgAdmin/nginx containers |
| mkcert (optional) | latest | generate the local TLS cert in `nginx/certs/` |

```bash
corepack enable            # ensures pnpm@11.23.0 (per the packageManager field)
pnpm install
```

---

## 2. Environment variables — the single `.env`

**There is exactly one `.env`: the root one.** It is the single source of truth
for BOTH Docker and local runs.

```
.env (root)  -->  Docker Compose (${VAR} substitution, injected into containers)
             -->  Local apps     (loaded by dotenv at startup)
```

| Who loads it locally | Where |
|---|---|
| API | `apps/api/src/load-env.ts` (imported first in `main.ts`) |
| Auth package | `packages/auth/src/load-env.ts` (imported first in `auth.ts`) |
| Database package | `packages/database/prisma.config.ts` + `src/seed.ts` |
| Web | `apps/web/next.config.js` |

Rules that keep it consistent:

1. **Copy the template, fill in values:**

   ```bash
   cp .env.example .env
   ```

   `.env` is git-ignored; `.env.example` is committed and must stay in sync with
   `.env` key-for-key.

2. **Compose always wins.** Inside containers, the env injected by
   `docker-compose.yml` (e.g. `DATABASE_URL=...@postgres:5432/...`) takes
   precedence — dotenv never overrides an already-set variable. That is how the
   same `.env` works on your host (`@localhost`) and in containers
   (`@postgres` / `@redis`).

3. **Per-package `.env.example` files are documentation, not loaders** — they
   document exactly which variables each package validates:
   - `apps/api/.env.example` — what the API requires (fails boot otherwise)
   - `apps/web/.env.example` — what Next.js validates at config load
   - `packages/auth/.env.example` — what `@repo/auth` requires at import time
   - `packages/database/.env.example` — what Prisma / the seed script require
   - There is deliberately **no `apps/web/.env`**: the web keeps port 3000
     locally because `next.config.js` drops the root `PORT=3001` after loading
     it (unless Docker already injected a PORT).

4. **Strict validation — no silent fallbacks.** The apps refuse to start when a
   REQUIRED variable is missing:
   - **API**: the Joi schema in `apps/api/src/app.module.ts`
     (`HOST`, `PORT` as an integer 1-65535, `DATABASE_URL`, `REDIS_URL`,
     `NEXT_PUBLIC_APP_URL`, `BETTER_AUTH_URL`, `BETTER_AUTH_SECRET`, `APP_NAME`)
   - **Auth**: `packages/auth/src/auth.ts` (`NEXT_PUBLIC_APP_URL`,
     `APP_NAME`, `EMAIL_FROM` throw at import). `BETTER_AUTH_SECRET` is
     build-time inert but fails every production SERVER boot when missing;
     `RESEND_API_KEY` (or `EMAIL_VERIFICATION=relaxed`) is likewise required
     in production. Numeric tuning knobs go through `parseIntEnv` — a
     non-numeric value crashes at boot with a named error.
   - **Web**: `apps/web/next.config.js` (`NEXT_PUBLIC_API_URL`; also
     `NEXT_ALLOWED_DEV_ORIGINS` in dev). Web needs neither `BETTER_AUTH_URL`
     nor `BETTER_AUTH_SECRET`; `INTERNAL_API_URL` is enforced at runtime by
     the server gateways (their error messages explain how to set it).
   - **Seed**: `packages/database/src/seed.ts` (`DATABASE_URL`, `SEED_ADMIN_*`)

> Changes to `.env` require a **restart** of local processes. Changes to
> `NEXT_PUBLIC_*` require restarting/rebuilding the web app (they are inlined
> into the client bundle at build time).

---

## 3. The three Docker Compose profiles

`docker-compose.yml` defines one network (`app-network`) and three profiles.
Run only **one profile at a time**.

| Profile | Runs in Docker | Runs on your host |
|---|---|---|
| `prod` | postgres, redis, pgadmin, migrate, api, web, proxy (nginx) | nothing |
| `dev` | postgres, redis, pgadmin, api-dev, web-dev, proxy-dev — **hot reload inside containers** | nothing |
| `local` | postgres, redis, pgadmin, proxy-local (nginx) | **api + web** via `pnpm dev` |

### prod — full container stack

```bash
docker compose --profile prod up --build
```

- `migrate` runs `prisma migrate deploy` once (then exits) before `api` starts.
- Nginx serves `https://localhost` (needs certs in `nginx/certs/`), proxying
  `/api/*` -> `api` and `/` -> `web`.
- Stop with `docker compose --profile prod down`.

### dev — everything in containers, hot reload

```bash
docker compose --profile dev up --build
```

- Source is volume-mounted (`.:/app`); the dev containers run
  `pnpm turbo run dev --filter=api...` / `--filter=web...` with polling watchers.
- `api-dev` and `web-dev` must become healthy before `proxy-dev` is healthy.

### local — infra in Docker, apps on your host

```bash
docker compose --profile local up -d   # postgres, redis, pgadmin, nginx
pnpm dev                               # api -> :3001, web -> :3000 on your host
pnpm db:seed                           # optional — see section 6
```

- `proxy-local` routes `/api/*` -> `host.docker.internal:3001` and `/` ->
  `host.docker.internal:3000` (your locally running processes).
  `extra_hosts: host-gateway` makes `host.docker.internal` work on Docker
  Engine/Linux as well.
- Postgres/Redis are published to `localhost:5432` / `localhost:6379`, so the
  root `.env` connection strings (`@localhost`) just work.
- Stop with `docker compose --profile local down`.
- Docker Desktop (Windows/macOS) resolves `host.docker.internal` natively — no
  extra config needed.

---

## 4. Turbo & pnpm — how to run things

Root scripts delegate to Turborepo (`turbo run <task>`), which runs the
same-named script in every package that defines it, in dependency order, with
caching.

| Root command | What it does |
|---|---|
| `pnpm dev` | `dev` in all packages (web + api + package watchers) |
| `pnpm start` | `start` (built apps: `nest start`, `next start`) |
| `pnpm build` | build everything (`tsc -b` / `nest build` / `next build`) |
| `pnpm test` / `pnpm test:e2e` | Jest suites |
| `pnpm lint` | ESLint across packages |
| `pnpm db:generate` | Prisma client generation (v7 -> `packages/database/src/generated/prisma`) |
| `pnpm db:push` | `prisma db push` — sync schema without migration files |
| `pnpm db:migrate:dev` | `prisma migrate dev` — create + apply migrations (interactive) |
| `pnpm db:migrate:deploy` | `prisma migrate deploy` — apply existing migrations (CI-safe) |
| `pnpm db:seed` | seed the super admin via the Better Auth API |
| `pnpm db:studio` | Prisma Studio UI |
| `pnpm auth:generate` | sync Better Auth schema into `packages/database/prisma/models/betterAuth.prisma` |
| `pnpm format` | Prettier on all `*.{ts,tsx}` |

### turbo.json — the task pipeline

```jsonc
{
  "tasks": {
    "dev":   { "cache": false, "persistent": true, "dependsOn": ["^build"] },
    "start": { "dependsOn": ["^build"], "cache": false },
    "build": { "dependsOn": ["^build"], "outputs": [".next/**", "dist/**"] },
    ...
  }
}
```

- `dependsOn: ["^build"]` — build dependencies **first** (e.g. `@repo/auth` before `api`).
- `cache: false` — never cached (dev servers, DB tasks).
- `persistent: true` — long-running servers; turbo does not wait for them to exit.
- `outputs` — what gets cached/restored for `build`.
- `globalPassThroughEnv` - CI/tooling vars tasks may always read without being part of the cache hash (NOT turbo "strict env mode" - strict `envMode` is deliberately not enabled in this repo).

### Scope with --filter

`--filter` (or `-F`) picks which packages run the task. The `...` suffix
**includes dependencies** of the target.

```bash
pnpm --filter api dev                        # only the API
pnpm --filter web dev                        # only the web app
pnpm --filter @repo/database db:generate     # only one package
pnpm --filter api... dev                     # api AND everything it depends on
pnpm --filter web... build                   # web + its dependency chain
pnpm turbo run build --filter=api...         # same, explicit turbo syntax
pnpm --filter web test                       # only web tests
```

Useful checks:

```bash
pnpm turbo run build --dry                 # show the planned graph without running
pnpm turbo run build --filter=web... --dry # plan only for web + deps
pnpm ls -r --depth -1                      # list all workspace packages
```

---

## 5. Database workflow (Prisma 7)

All DB scripts live in `packages/database` and read `DATABASE_URL` from the
root `.env` (via `prisma.config.ts`). The generated client lives at
`packages/database/src/generated/prisma` — it is committed/regenerated with
`pnpm db:generate`, and `clear_cache` deletes it so it can be regenerated.

Order for a fresh environment:

```bash
pnpm db:generate       # 1. generate the v7 client (needed before builds)
pnpm db:migrate:dev    # 2. create & apply a migration (interactive) — OR —
pnpm db:push           # 2b. push schema directly without a migration file
pnpm db:seed           # 3. create the super admin (requires API up, section 6)
pnpm db:studio         # 4. (optional) inspect data
```

- `db:migrate:deploy` is what the `migrate` container runs in the `prod`
  profile and what CI should run — it only applies existing migrations.
- After changing `prisma/schema.prisma` or `prisma/models/*.prisma`, re-run
  `pnpm db:generate`.
- After changing Better Auth config, run `pnpm auth:generate` (syncs the
  `betterAuth.prisma` model file, then `pnpm db:generate` + migrate).

---

## 6. Seeding (pnpm db:seed)

The seed script (`packages/database/src/seed.ts`) does two things:

1. Connects to Postgres directly with `DATABASE_URL`.
2. Calls `POST https://localhost/api/auth/sign-up/email` (via nginx) to create
   the admin through the real Better Auth stack — password hashing is done by
   the library, never hand-rolled.

So **the API must be running and healthy** before seeding:

- `local` profile: your `pnpm dev` API on :3001 (nginx -> host).
- `dev`/`prod` profiles: the containerized API.

Prerequisites:

```bash
cp .env.example .env    # must contain SEED_ADMIN_* and BETTER_AUTH_URL
docker compose --profile local up -d   # postgres + nginx must be up
# start your local API (or the containers) and wait for it to be healthy
pnpm db:seed
```

The seed is idempotent: an existing admin with the same email is skipped (or
promoted to superAdmin if its role is missing). `NODE_TLS_REJECT_UNAUTHORIZED=0`
(in `.env`) lets the seed trust the self-signed nginx cert — dev only.

If the seed fails with `Better Auth sign-up failed: 500`, the API is up but
misconfigured (missing `DATABASE_URL` etc.) — check the API logs; with the
strict env validation it usually refuses to boot at all now.

---

## 7. TLS certificates (nginx)

Nginx requires `nginx/certs/<NGINX_SSL_CERT_FILENAME>` and
`<NGINX_SSL_KEY_FILENAME>` (defaults: `localhost.crt` / `localhost.key`).

```bash
mkcert -install
mkcert -key-file nginx/certs/localhost.key -cert-file nginx/certs/localhost.crt localhost 127.0.0.1
```

---

## 8. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `Missing required environment variable: X` | Root `.env` missing `X` or process not restarted after `.env` edit. Restart the local process / `docker compose up -d` again. |
| API boots but sign-up/seed returns 500 | API env incomplete (e.g. no `DATABASE_URL`) — with the strict checks it should now fail at boot instead. Check API logs. |
| Seed fails at `Better Auth sign-up failed: 500` | The API behind nginx is not healthy/up-to-date. In `local` mode your host API must be running. |
| Port 3001 already in use | Another API instance (e.g. an old one) still running. `Stop-Process` / `kill` it, or check `Get-NetTCPConnection -LocalPort 3001`. |
| `host.docker.internal` not resolving (Linux) | The `local` profile already adds `extra_hosts: host-gateway` — `docker compose --profile local up -d` again after pulling the new compose file. |
| Web on 3001 instead of 3000 locally | `next.config.js` drops root `PORT` unless it was pre-set — restart the web dev server after pulling the change. |
| `next start` warns about `output: standalone` | Expected: standalone images are started via the Dockerfile's runner entrypoint; for local dev use `pnpm dev` (not `pnpm start`). |
| Prisma "client password must be a string" | `DATABASE_URL` missing/empty in the process env — see strict env section. |
| Generated client missing after fresh clone | Run `pnpm db:generate` (or `pnpm install` postinstall triggers it if configured). |

---

## 9. Daily cheatsheet

```bash
pnpm install                                # install everything

# local mode (api + web on host, infra + nginx in Docker)
docker compose --profile local up -d
pnpm dev

# full stack in Docker
docker compose --profile prod up --build    # production-style
docker compose --profile dev up --build     # hot reload in containers

# database
pnpm db:generate
pnpm db:migrate:dev
pnpm db:migrate:deploy
pnpm db:seed
pnpm db:studio

# building / testing / linting
pnpm build
pnpm test
pnpm lint

# scoped runs
pnpm --filter api... dev
pnpm --filter web build
pnpm --filter @repo/database db:generate
```
