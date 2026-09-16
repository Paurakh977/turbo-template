# Codebase Documentation — AI Agent Reference

> **Purpose**: Complete reference for an AI agent to understand the architecture, every package, every app, every file, business logic, and data flow. Optimized for building observability with Grafana stack.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Root Configuration](#root-configuration)
3. [Apps](#apps)
   - [apps/api — NestJS REST API](#appsapi--nestjs-rest-api)
   - [apps/web — Next.js Frontend](#appsweb--nextjs-frontend)
   - [apps/migrate — Database Migration Runner](#appsmigrate--database-migration-runner)
4. [Packages](#packages)
   - [@repo/auth — Authentication & Authorization](#repoauth--authentication--authorization)
   - [@repo/database — Prisma ORM & Database](#repodatabase--prisma-orm--database)
   - [@repo/roles — Role-Based Access Control](#reporoles--role-based-access-control)
   - [@repo/api — Shared API Types](#repoapi--shared-api-types)
   - [@repo/ui — Shared React Components](#repoui--shared-react-components)
   - [Config Packages](#config-packages)
5. [Database Schema](#database-schema)
6. [API Endpoints](#api-endpoints)
7. [Authentication Flow](#authentication-flow)
8. [Rate Limiting Strategy](#rate-limiting-strategy)
9. [Environment Variables](#environment-variables)
10. [Docker & Deployment](#docker--deployment)
11. [Key Business Logic Locations](#key-business-logic-locations)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        NGINX REVERSE PROXY                       │
│                    (TLS termination, rate limiting)               │
└───────────┬─────────────────────────────────┬───────────────────┘
            │                                 │
            ▼                                 ▼
┌───────────────────────┐       ┌───────────────────────────┐
│      apps/web         │       │        apps/api            │
│   Next.js 16 (SSR)    │──────▶│    NestJS REST API         │
│   React 19            │       │    Better Auth             │
│   Port: 3000          │       │    Port: 3001              │
│   NO database creds   │       │    Has database creds      │
└───────────────────────┘       └───────────┬───────────────┘
                                            │
                              ┌─────────────┼─────────────┐
                              ▼             ▼             ▼
                    ┌──────────────┐ ┌──────────────┐ ┌──────────┐
                    │  PostgreSQL  │ │    Redis      │ │  Prisma  │
                    │  Port: 5432  │ │  Port: 6379   │ │  Client  │
                    └──────────────┘ └──────────────┘ └──────────┘
```

**Key Design Decision — Architecture B (Secret-Free Web Tier)**:
- The `web` container has NO database credentials, NO auth signing secret
- Server-side auth operations happen via `INTERNAL_API_URL` to the API tier
- Cookies are forwarded; the API tier owns all Postgres/Better Auth secret access
- This minimizes blast radius if the web tier is compromised

---

## Root Configuration

| File | Purpose |
|------|---------|
| `package.json` | Root workspace scripts (`dev`, `build`, `test`, `lint`, `db:*`, `auth:generate`) |
| `turbo.json` | Turborepo task pipeline — defines `dev`, `build`, `test`, `lint`, `typecheck`, `db:*`, `auth:generate` tasks with env passthrough |
| `pnpm-workspace.yaml` | Workspace packages: `apps/*`, `packages/*`. Catalog pins: `better-auth@1.6.29`, `typescript@5.9.3`, `@prisma/client@^7.9.1` |
| `docker-compose.yml` | 20+ services across profiles: `prod`, `dev`, `local`, `test`, `e2e` |
| `.env.example` | Single source of truth for all env vars (Docker + local) |
| `.prettierrc.mjs` | Prettier config |
| `tsconfig.json` | Root TypeScript config |

### Turborepo Tasks

- **`dev`**: Runs all apps in watch mode, depends on `^build` (builds packages first)
- **`build`**: Outputs `.next/**`, `dist/**`
- **`test`**: Unit tests (Jest)
- **`test:integration`**: Integration tests against real DB/Redis (Docker `test` profile)
- **`test:e2e`**: Playwright end-to-end tests (Docker `e2e` profile)
- **`db:seed`**: Seeds admin user
- **`db:generate`**: Prisma client generation
- **`db:migrate:dev`** / **`db:migrate:deploy`**: Migration management
- **`auth:generate`**: Better Auth CLI schema generation

---

## Apps

### `apps/api` — NestJS REST API

**Framework**: NestJS 11 with Express adapter
**Port**: 3001 (configurable via `PORT`)
**Entry**: `src/main.ts`

#### File-by-File Breakdown

| File | Purpose |
|------|---------|
| `src/main.ts` | Bootstrap: creates NestJS app, configures Helmet (security headers), compression, CORS (trusts origins from env), global ValidationPipe, global HttpExceptionFilter, sets `api` global prefix, starts listening |
| `src/load-env.ts` | Loads `.env` via dotenv before anything else |
| `src/app.module.ts` | Root module: imports ConfigModule (Joi validation), RedisModule, ThrottlerModule (200 req/60s global), AuthModule (Better Auth), LinksModule, NotesModule, AuditModule, UsersModule, ServerActionRateLimitModule, HealthModule. Registers ThrottlerGuard as APP_GUARD. DatabaseShutdown hook for SIGTERM |
| `src/app.controller.ts` | `GET /` — anonymous hello world endpoint |
| `src/app.service.ts` | Returns "Hello World!" |

#### `src/health/` — Health Probes

| File | Purpose |
|------|---------|
| `health.controller.ts` | Two endpoints: `GET /api/health/live` (liveness — always 200 if process up), `GET /api/health/ready` (readiness — checks Redis PING + Postgres SELECT 1, returns 503 if either fails). Both `@AllowAnonymous()`. Docker HEALTHCHECK uses `/live` not `/ready` |
| `health.module.ts` | Registers HealthController, injects REDIS_CLIENT |

#### `src/links/` — Public Link Directory (Read-Only)

| File | Purpose |
|------|---------|
| `links.controller.ts` | `GET /api/links`, `GET /api/links/:id` — anonymous, read-only. No create/update/delete (removed for security) |
| `links.service.ts` | In-memory link store (hardcoded data) |
| `links.module.ts` | Registers LinksController + LinksService |

#### `src/notes/` — Notes CRUD (Authenticated)

| File | Purpose |
|------|---------|
| `notes.controller.ts` | `GET /api/notes` (list), `POST /api/notes` (create), `PATCH /api/notes/:id` (update), `DELETE /api/notes/:id` (delete). All require session. Uses global AuthGuard (no explicit `@UseGuards`) |
| `notes.service.ts` | Business logic: `listForSession()` (paginated), `create()`, `update()`, `remove()`. Enforces per-user scoping. Records audit logs for mutations |
| `dto/note.dto.ts` | DTOs: `CreateNoteDto`, `UpdateNoteDto`, `ListNotesQuery` with validation |
| `notes.module.ts` | Registers NotesController + NotesService |

#### `src/audit/` — Audit Log System

| File | Purpose |
|------|---------|
| `audit.controller.ts` | `POST /api/audit-logs` (session-attributed write for web actions: `profile_updated`, `theme_changed`, `labs_toggled`), `GET /api/admin/audit-logs` (admin-only listing with search/pagination) |
| `audit.service.ts` | `recordFromSession()`, `listForAdmin()`, `recordSystemEvent()`. Writes to `auditLog` table. Metadata capped at 4096 chars |
| `audit.module.ts` | Registers AuditController + AuditService |

#### `src/users/` — User Identity Endpoints

| File | Purpose |
|------|---------|
| `users.controller.ts` | `GET /api/users/me/role` (fresh role from DB for session user), `GET /api/users/me/permissions` (per-action permission verdicts for EFFECTIVE user — supports impersonation). Used by web tier for UI gating |
| `users.module.ts` | Registers UsersController |

#### `src/redis/` — Redis Module

| File | Purpose |
|------|---------|
| `redis.module.ts` | Global NestJS module. Creates singleton ioredis client from `REDIS_URL`. Retry strategy: exponential backoff max 30s. Exports `REDIS_CLIENT` token. Graceful shutdown on module destroy |

#### `src/rate-limit/` — Server Action Rate Limiting

| File | Purpose |
|------|---------|
| `server-action-rate-limit.controller.ts` | `POST /api/rate-limit/check` — validates scope against `SERVER_ACTION_SCOPES` allowlist, checks Redis counter, returns `{ allowed: boolean, remaining: number }` |
| `server-action-rate-limit.service.ts` | DB-backed rate limiter for web Server Actions. Scopes: `notes:create-note`, `settings:update-display-name`, `admin:resend-verification`, etc. |
| `server-action-rate-limit.module.ts` | Registers controller + service |

#### `src/common/` — Shared Utilities

| File | Purpose |
|------|---------|
| `http-exception.filter.ts` | Global exception filter: normalizes error responses to `{ statusCode, message, error }` |
| `session.utils.ts` | `getEffectiveUserId()` — resolves the real user ID during impersonation. `ServerSession` type |
| `client-meta.ts` | `extractClientMeta(req)` — extracts IP address + user-agent from request for audit logging |
| `audit-writer.ts` | Helper for writing audit log entries from services |
| `audit-metadata.ts` | Audit metadata validation/formatting utilities |

---

### `apps/web` — Next.js Frontend

**Framework**: Next.js 16 (App Router) with React 19
**Port**: 3000 (configurable via `WEB_PORT`)
**Entry**: `src/app/layout.tsx`

#### File-by-File Breakdown

| File | Purpose |
|------|---------|
| `src/app/layout.tsx` | Root layout: HTML shell, providers, fonts |
| `src/app/page.tsx` | Landing page (public) |
| `src/app/error.tsx` | Global error boundary |
| `src/app/not-found.tsx` | 404 page |
| `src/proxy.ts` | Auth HTTP gateway — forwards requests to API with cookies. The bridge between web (no DB creds) and API (has DB creds) |
| `next.config.js` | Next.js config: webpack mode, env vars, allowed dev origins |

#### `src/app/auth/` — Authentication Pages

- Login, sign-up, email verification, password reset, 2FA pages
- Uses `@repo/auth` client-side helpers

#### `src/app/dashboard/` — Authenticated Dashboard

- Dashboard shell with sidebar navigation
- Notes management (CRUD via Server Actions → API)
- Settings page (display name, theme, labs)
- Admin panel (user management, audit logs) — only visible to admin/superAdmin roles

#### `src/app/admin/` — Admin Panel

- User list with role management
- Audit log viewer
- Impersonation controls

#### `src/lib/` — Client Utilities

- `auth-client.ts` — Better Auth client configuration
- `validation.ts` — Client-side password validation (mirrors server rules)
- Server actions for notes, settings, admin operations

#### `e2e/` — Playwright E2E Tests

- `playwright.config.ts` — Playwright configuration
- `tests/` — End-to-end test suites

---

### `apps/migrate` — Database Migration Runner

**Purpose**: Standalone container that runs `prisma migrate deploy` then exits. Used in Docker Compose to run migrations before API starts.

| File | Purpose |
|------|---------|
| `Dockerfile` | Minimal Node.js image, copies prisma schema + migrations, runs `prisma migrate deploy` |
| `package.json` | Just `@prisma/client` + `prisma` |

---

## Packages

### `@repo/auth` — Authentication & Authorization

**Location**: `packages/auth/`
**Purpose**: Complete Better Auth configuration, plugins, RBAC, email helpers, audit logging

#### File-by-File Breakdown

| File | Purpose |
|------|---------|
| `src/auth.ts` | **CORE**: Better Auth instance configuration. Plugins: `twoFactor`, `admin`, `jwt`, `auditLogPlugin`, `nextCookies`. Email+password auth, OAuth (Google, GitHub), session config (7-day expiry, DB-backed), rate limiting (per-endpoint custom rules), trusted origins, IP tracking |
| `src/index.ts` | Public API: exports `auth`, `ADMIN_ROLES`, role utilities, permission constants, password policy |
| `src/permissions.ts` | RBAC access control: `statement` (resources: notes, settings), roles: `userRole`, `operatorRole`, `adminRole`, `superAdminRole`, grant roles (`settingsThemeGrant`, `settingsLabsGrant`). `ADMIN_PLUGIN_ROLES` maps role names to Better Auth role objects |
| `src/roles.ts` | Re-exports from `@repo/roles` |
| `src/password-policy.ts` | Server-side password complexity: min 8 chars, requires uppercase + lowercase + number + symbol. Applied to sign-up and change-password (NOT reset-password) |
| `src/email-helpers.ts` | `sendEmail()` — Resend API wrapper. Graceful fallback when `RESEND_API_KEY` not set |
| `src/redis.ts` | Redis client for Better Auth secondary storage (sessions, rate limits, tokens) |
| `src/database-hooks.ts` | Better Auth database hooks: `user.update.after` (cache invalidation), `user.delete.after` (audit log + cache invalidation), `session.delete` (cleanup) |
| `src/audit-plugin.ts` | Better Auth plugin: intercepts admin endpoints (`set-role`, `ban-user`, `unban-user`, `revoke-user-sessions`, `remove-user`, `impersonate-user`, `stop-impersonating`, `delete-user`). Writes audit logs with IP + user-agent. Enforces role hierarchy guards |
| `src/hierarchy.ts` | `enforceRoleHierarchy()` — prevents acting on peers/superiors. Blocks nested impersonation |
| `src/client-ip.ts` | `resolveClientIp()` — extracts real client IP from X-Forwarded-For/X-Real-IP headers with trusted proxy CIDR list |
| `src/pending-storage.ts` | Redis-backed pending operations: cache invalidation, pending deletion context, pending stop-impersonation |
| `src/env.ts` | Environment variable loading/validation for auth package |
| `src/load-env.ts` | Dotenv loader |

#### Better Auth Plugins Active

1. **twoFactor** — TOTP (6 digits, 30s period) + OTP via email (3min period, 5 attempts) + backup codes (10 codes, 10 chars each)
2. **admin** — User management, role assignment, banning, impersonation, session revocation
3. **jwt** — JWT tokens (30min expiry, ES256, 30-day rotation, 7-day grace)
4. **auditLogPlugin** — Custom: intercepts admin mutations for audit trail
5. **nextCookies** — Set-Cookie header forwarding for Next.js Server Actions

---

### `@repo/database` — Prisma ORM & Database

**Location**: `packages/database/`
**Purpose**: Database client, schema, migrations, seed script

#### File-by-File Breakdown

| File | Purpose |
|------|---------|
| `src/client.ts` | PrismaClient singleton with `@prisma/adapter-pg` (PostgreSQL). Configurable pool: `DATABASE_POOL_MAX` (default 10), `DATABASE_CONNECTION_TIMEOUT_MS` (5s), `DATABASE_IDLE_TIMEOUT_MS` (30s). Global singleton for dev hot-reload. `disposeExternalPool: true` for clean SIGTERM shutdown |
| `src/index.ts` | Re-exports `db` client |
| `src/seed.ts` | Seeds admin user from env vars (`SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, `SEED_ADMIN_NAME`) |
| `src/env.ts` | Environment validation for database package |
| `prisma/schema.prisma` | Main schema file (generator + datasource). Models split across `models/` directory |
| `prisma/models/betterAuth.prisma` | Better Auth tables: user, session, account, verification |
| `prisma/models/note.prisma` | Note table (user-scoped) |
| `prisma/models/auditLog.prisma` | Audit log table |
| `prisma.config.ts` | Prisma configuration |
| `prisma/migrations/` | Migration history |

---

### `@repo/roles` — Role-Based Access Control

**Location**: `packages/roles/`
**Purpose**: Shared role utilities used by both auth and API tiers

#### File-by-File Breakdown

| File | Purpose |
|------|---------|
| `src/index.ts` | Role utilities: `BaseRole` type (`user`, `operator`, `admin`, `superAdmin`), `ROLE_WEIGHT` map, `parseRoles()` (handles JSON arrays, comma-separated, `{$value: []}` format), `serializeRoles()`, `getMaxRoleWeight()`, `getPrimaryRole()`, `hasRole()`, `hasAdminRole()`, `hasSuperAdminRole()`, `hasOperatorRole()`, `hasGrantRole()`, `canActOn()`. Also exports `SERVER_ACTION_SCOPES` — closed allowlist of rate-limited web action scopes |

---

### `@repo/api` — Shared API Types

**Location**: `packages/api/`
**Purpose**: TypeScript types shared between API and web tiers

| File | Purpose |
|------|---------|
| `src/entry.ts` | Entry point, re-exports |
| `src/links/` | `Link` type definition |

---

### `@repo/ui` — Shared React Components

**Location**: `packages/ui/`
**Purpose**: Shared React components (button, input, etc.) used by web app

---

### Config Packages

| Package | Purpose |
|---------|---------|
| `@repo/eslint-config` | Shared ESLint configuration |
| `@repo/jest-config` | Shared Jest configuration |
| `@repo/tailwind-config` | Shared Tailwind CSS configuration |
| `@repo/typescript-config` | Shared TypeScript configuration (tsconfig base) |
| `packages/coverage/` | Coverage configuration |

---

## Database Schema

### Tables (9 total)

#### `user` (Better Auth)
- `id`, `name`, `email`, `emailVerified`, `image`, `role`, `banned`, `banReason`, `banExpires`, `createdAt`, `updatedAt`

#### `session` (Better Auth)
- `id`, `token`, `userId`, `expiresAt`, `ipAddress`, `userAgent`, `impersonatedBy`, `createdAt`, `updatedAt`

#### `account` (Better Auth)
- `id`, `userId`, `accountId`, `providerId`, `accessToken`, `refreshToken`, `idToken`, `accessTokenExpiresAt`, `refreshTokenExpiresAt`, `password`, `createdAt`, `updatedAt`

#### `verification` (Better Auth)
- `id`, `identifier`, `token`, `expiresAt`, `createdAt`, `updatedAt`

#### `note`
- `id`, `title`, `content`, `userId`, `createdAt`, `updatedAt`

#### `auditLog`
- `id`, `userId`, `action`, `actor`, `ipAddress`, `userAgent`, `metadata` (JSON), `createdAt`

#### `link` (in-memory only, not in DB)
- `id`, `title`, `url`, `description`

---

## API Endpoints

### Public (Anonymous)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/` | Hello World |
| `GET` | `/api/health/live` | Liveness probe |
| `GET` | `/api/health/ready` | Readiness probe (checks Redis + Postgres) |
| `GET` | `/api/links` | List links |
| `GET` | `/api/links/:id` | Get link by ID |

### Authentication (Better Auth)

| Method | Path | Rate Limit | Description |
|--------|------|------------|-------------|
| `POST` | `/api/auth/sign-in/email` | 5/60s | Email + password sign-in |
| `POST` | `/api/auth/sign-up/email` | 3/60s | Email + password sign-up |
| `POST` | `/api/auth/request-password-reset` | 3/60s | Request password reset email |
| `POST` | `/api/auth/reset-password` | 5/60s | Reset password with token |
| `POST` | `/api/auth/change-password` | 5/60s | Change password (authenticated) |
| `POST` | `/api/auth/change-email` | 3/60s | Change email (authenticated) |
| `POST` | `/api/auth/send-verification-email` | 3/60s | Send verification email |
| `POST` | `/api/auth/two-factor/send-otp` | 3/60s | Send 2FA OTP |
| `POST` | `/api/auth/two-factor/verify-totp` | 3/10s | Verify TOTP code |
| `POST` | `/api/auth/two-factor/verify-otp` | 3/10s | Verify OTP code |
| `POST` | `/api/auth/two-factor/verify-backup-code` | 3/10s | Verify backup code |
| `POST` | `/api/auth/delete-user` | 2/60s | Delete own account |
| `GET` | `/api/auth/get-session` | 300/60s | Get current session |
| `GET` | `/api/auth/list-accounts` | 60/60s | List linked accounts |

### Admin (Better Auth Plugin)

| Method | Path | Rate Limit | Description |
|--------|------|------------|-------------|
| `GET` | `/api/auth/admin/list-users` | 60/60s | List users |
| `GET` | `/api/auth/admin/list-user-sessions` | 30/60s | List user sessions |
| `GET` | `/api/auth/admin/has-permission` | 30/60s | Check permission |
| `POST` | `/api/auth/admin/set-role` | 5/60s | Set user role |
| `POST` | `/api/auth/admin/ban-user` | 3/60s | Ban user |
| `POST` | `/api/auth/admin/unban-user` | 3/60s | Unban user |
| `POST` | `/api/auth/admin/impersonate-user` | 3/60s | Impersonate user |
| `POST` | `/api/auth/admin/stop-impersonating` | 6/60s | Stop impersonation |
| `POST` | `/api/auth/admin/remove-user` | 2/60s | Remove user |
| `POST` | `/api/auth/admin/revoke-user-sessions` | 5/60s | Revoke all user sessions |
| `POST` | `/api/auth/admin/revoke-user-session` | 5/60s | Revoke single session |
| `POST` | `/api/auth/admin/create-user` | 3/60s | Create user (admin) |
| `POST` | `/api/auth/admin/set-user-password` | 3/60s | Set user password (admin) |

### Application Endpoints (Authenticated)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/notes` | List user's notes (paginated) |
| `POST` | `/api/notes` | Create note |
| `PATCH` | `/api/notes/:id` | Update note |
| `DELETE` | `/api/notes/:id` | Delete note |
| `GET` | `/api/users/me/role` | Get current user's role |
| `GET` | `/api/users/me/permissions` | Get effective user's permissions |
| `POST` | `/api/audit-logs` | Record audit event (client-side) |
| `GET` | `/api/admin/audit-logs` | List audit logs (admin) |
| `POST` | `/api/rate-limit/check` | Check server action rate limit |

---

## Authentication Flow

### Email + Password Sign-In
1. Browser → `POST /api/auth/sign-in/email` (email + password)
2. Better Auth validates credentials against `account` table
3. If 2FA enabled → returns partial session, requires TOTP/OTP verification
4. If 2FA not enabled → returns session token + sets cookies
5. Session stored in `session` table (DB-backed) + Redis secondary storage

### OAuth (Google/GitHub)
1. Browser → `/api/auth/sign-in/social/google` → redirect to OAuth provider
2. Provider redirects back to `/api/auth/callback/google`
3. Better Auth exchanges code for tokens, fetches user info
4. If account exists → links via `accountLinking`
5. If new user → auto-creates account (silent sign-up)
6. Sets session cookies

### 2FA Flow
1. After initial sign-in, if 2FA enabled → `twoFactor` plugin intercepts
2. User can verify via TOTP (authenticator app) or OTP (email)
3. Backup codes available as fallback
4. `trustDevice` cookie remembers device for configurable period

### Architecture B (Web → API)
1. Web Server Action calls `auth.api.getSession()` with forwarded cookies
2. API resolves session from DB/Redis
3. Returns user + session data to web tier
4. Web tier uses data for SSR rendering + UI gating

---

## Rate Limiting Strategy

### Three-Layer Architecture

1. **Nginx Layer** — IP-wide flood protection (connection-level, broad)
2. **Better Auth Plugin** — Per-endpoint, per-user/IP limits (configured in `auth.ts`)
3. **Server Action Rate Limiter** — Custom DB-backed for web app mutations

### Better Auth Rate Limits

| Endpoint Category | Window | Max | Notes |
|-------------------|--------|-----|-------|
| Passive reads (`get-session`) | 60s | 300 | Prevents UX noise from session polling |
| Auth challenge (`sign-in`) | 60s | 5 | Strict brute-force protection |
| Destructive (`delete-user`) | 60s | 2 | Tightest limits |
| Admin mutations (`set-role`) | 60s | 5 | Strict but usable |

### Server Action Rate Limits

Scopes (from `@repo/roles`):
- `notes:create-note`, `notes:update-note`, `notes:delete-note`
- `settings:update-display-name`, `settings:toggle-theme-preference`, `settings:run-labs-setting`, `settings:delete-account`
- `admin:resend-verification`
- `dashboard:fresh-role`

---

## Environment Variables

### Required (App Won't Start Without)

| Variable | Used By | Description |
|----------|---------|-------------|
| `HOST` | API | Bind address (default: 0.0.0.0) |
| `PORT` | API | Port (default: 3001) |
| `DATABASE_URL` | API, Database | PostgreSQL connection string |
| `REDIS_URL` | API, Auth | Redis connection string |
| `BETTER_AUTH_SECRET` | Auth | Session signing secret (min 32 chars) |
| `BETTER_AUTH_URL` | Auth | Base URL for auth callbacks |
| `APP_NAME` | Auth | Application name |
| `NEXT_PUBLIC_API_URL` | Web | Browser-facing API URL (default: `/api`) |
| `NEXT_PUBLIC_APP_URL` | Web | Public app URL |

### Optional (Have Defaults)

| Variable | Default | Description |
|----------|---------|-------------|
| `WEB_HOST` | 0.0.0.0 | Web bind address |
| `WEB_PORT` | 3000 | Web port |
| `RATE_LIMIT_WINDOW` | 60 | Rate limit window (seconds) |
| `RATE_LIMIT_MAX` | 20 | Max requests per window |
| `SESSION_EXPIRES_IN` | 604800 (7d) | Session expiry |
| `SESSION_UPDATE_AGE` | 86400 (1d) | Session refresh interval |
| `SESSION_FRESH_AGE` | 900 (15m) | Fresh session for destructive ops |
| `TWO_FACTOR_TOTP_PERIOD` | 30 | TOTP period (seconds) |
| `TWO_FACTOR_OTP_PERIOD` | 3 | OTP period (minutes) |
| `TWO_FACTOR_OTP_ATTEMPTS` | 5 | OTP max attempts |
| `TWO_FACTOR_BACKUP_AMOUNT` | 10 | Number of backup codes |
| `TWO_FACTOR_BACKUP_LENGTH` | 10 | Backup code length |
| `TWO_FACTOR_COOKIE_MAX_AGE` | 600 | 2FA cookie lifetime |
| `TRUST_DEVICE_MAX_AGE` | 2592000 (30d) | Trust device duration |

### OAuth (Optional)

| Variable | Description |
|----------|-------------|
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | GitHub OAuth |
| `RESEND_API_KEY` | Resend email API |
| `EMAIL_FROM` | Sender email address |
| `DEV_EMAIL_OVERRIDE` | Dev: override all emails to this address |
| `EMAIL_VERIFICATION` | `relaxed` = skip verification requirement |

### Infrastructure

| Variable | Description |
|----------|-------------|
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | Docker PostgreSQL |
| `REDIS_PASSWORD` | Docker Redis |
| `NGINX_SERVER_NAME` / `NGINX_SSL_CERT_FILENAME` / `NGINX_SSL_KEY_FILENAME` | Nginx TLS |
| `PROXY_HTTP_PORT` / `PROXY_HTTPS_PORT` | Nginx ports |

---

## Docker & Deployment

### Docker Compose Profiles

| Profile | Services | Purpose |
|---------|----------|---------|
| `prod` | postgres, redis, pgadmin, migrate, api, web, proxy | Production stack |
| `dev` | postgres, redis, pgadmin, migrate-dev, api-dev, web-dev, proxy-dev | Development with hot-reload |
| `local` | postgres, redis, pgadmin, proxy-local | Local dev (host-run apps) |
| `test` | postgres-test, redis-test, migrate-test, api-test | Integration tests (tmpfs, disposable) |
| `e2e` | postgres-e2e, redis-e2e, migrate-e2e, api-e2e, web-e2e, proxy-e2e | Playwright E2E tests |

### Service Startup Order (prod)

```
postgres → redis → pgadmin
         → migrate (runs once, then exits)
         → api (depends on postgres + redis + migrate)
         → web (depends on api)
         → proxy (depends on api + web)
```

### Health Checks

| Service | Endpoint | Strategy |
|---------|----------|----------|
| postgres | `pg_isready -h 127.0.0.1` | TCP check |
| redis | `redis-cli ping` | PONG check |
| api | `/api/health/live` | Liveness (process up) |
| web | `GET /` | HTTP 200 check |
| proxy | `/healthz` | Nginx health |

### Volumes (Named)

- `postgres-data`, `redis-data`, `pgadmin-data` — persistent data
- `e2e-postgres-data`, `e2e-redis-data` — E2E test data
- `root-node_modules`, `apps-*-node_modules`, `packages-*-node_modules` — dev container node_modules
- `api-turbo`, `web-turbo`, `web-next` — build caches

---

## Key Business Logic Locations

### For Observability (Grafana Stack)

| What to Monitor | Where to Instrument | Key Files |
|-----------------|---------------------|-----------|
| **HTTP Request Metrics** | NestJS middleware/interceptor | `apps/api/src/main.ts` (add interceptor) |
| **Auth Events** | Better Auth hooks | `packages/auth/src/audit-plugin.ts`, `packages/auth/src/database-hooks.ts` |
| **Rate Limit Hits** | Redis counters | `packages/auth/src/auth.ts` (rateLimit config), `apps/api/src/rate-limit/` |
| **Database Queries** | Prisma logging | `packages/database/src/client.ts` (log config) |
| **Redis Operations** | ioredis events | `packages/auth/src/redis.ts`, `apps/api/src/redis/redis.module.ts` |
| **Health Status** | Health endpoints | `apps/api/src/health/health.controller.ts` |
| **Audit Trail** | Audit log writes | `apps/api/src/audit/audit.service.ts`, `packages/auth/src/audit-plugin.ts` |
| **User Actions** | Controller instrumentation | `apps/api/src/notes/`, `apps/api/src/users/`, `apps/api/src/audit/` |
| **Session Activity** | Better Auth session hooks | `packages/auth/src/database-hooks.ts` |
| **Email Delivery** | Resend API calls | `packages/auth/src/email-helpers.ts` |
| **Error Rates** | Exception filter | `apps/api/src/common/http-exception.filter.ts` |
| **Container Health** | Docker healthchecks | `docker-compose.yml` (all services) |

### Observability Integration Points

1. **Prometheus Metrics Export**: Add `@nestjs/prometrics` to `apps/api/src/app.module.ts`
2. **OpenTelemetry Tracing**: Wrap `apps/api/src/main.ts` bootstrap with OTel SDK
3. **Structured Logging**: Replace `console.error` with Pino/Winston in `packages/auth/src/redis.ts`, `packages/auth/src/email-helpers.ts`, `packages/auth/src/audit-plugin.ts`
4. **Grafana Dashboards**: Use `/api/health/ready` as datasource health check, audit logs as user activity data source
5. **Alerting Rules**: Rate limit breaches, auth failures, health check failures, email delivery errors

---

## Scripts

| Script | Purpose |
|--------|---------|
| `scripts/check-web-secrets.mjs` | Guard: ensures web tier has NO database/auth secrets |
| `scripts/check-web-auth-imports.mjs` | Guard: ensures web tier doesn't import server-only auth code |
| `generate_tree.ps1` / `generate_tree.sh` | Generate directory tree visualization |
| `clear_cache.ps1` / `clear_cache.sh` | Clear Turborepo + Next.js caches |

---

## Patches

| Patch | Purpose |
|-------|---------|
| `patches/@prisma__client@7.9.1.patch` | Prisma client patch |
| `patches/better-auth@1.6.29.patch` | Better Auth patch (pinned to 1.6.29 — 1.7.x is ESM-only, incompatible with CJS API) |

---

*This document is the single source of truth for AI agent codebase understanding. Update it when adding new modules, endpoints, or significant business logic.*
