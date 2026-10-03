# Architecture — Template Turbo Repo

> This document describes the system architecture, design decisions, and key subsystems. It is intended for developers building on top of this template and for AI agents understanding the codebase.

---

## System diagram

```mermaid
flowchart TD
    Browser([Browser]) -->|HTTPS| Nginx

    subgraph Nginx["nginx reverse proxy - TLS termination / rate limiting / routing"]
        direction LR
        N1["/api/* route"]
        N2["/* route"]
    end

    N1 -->|port 3001| API
    N2 -->|port 3000| Web

    subgraph API["apps/api - NestJS 11 REST API - port 3001 - HAS DB creds"]
        direction TB
        BA["Better Auth handler<br/>sessions / RBAC / 2FA / admin"]
    end

    subgraph Web["apps/web - Next.js 16 SSR + React 19 - port 3000 - NO DB creds"]
        direction TB
        SSR["SSR / Server Actions"]
    end

    SSR -->|INTERNAL_API_URL<br/>SSR + Server Actions| BA

    API --> PGB[("PgBouncer<br/>port 6432<br/>connection pool")]
    API --> RD[("Redis<br/>sessions cache<br/>rate limits")]
    PGB --> DB[("PostgreSQL<br/>port 5432<br/>all tables")]
```

---

## Docker profiles

| Profile | What runs in Docker | What runs on host |
|---------|---------------------|-------------------|
| `prod` | postgres, redis, pgadmin, pgbouncer, migrate, api, web, nginx | nothing |
| `dev` | postgres, redis, pgadmin, pgbouncer, migrate-dev, api-dev, web-dev, nginx | nothing |
| `local` | postgres, redis, pgadmin, pgbouncer, nginx | api + web (`pnpm dev`) |
| `test` | postgres-test, redis-test, migrate-test, api-test | nothing |
| `e2e` | postgres-e2e, redis-e2e, migrate-e2e, api-e2e, web-e2e, nginx-e2e | Playwright |

With `docker-compose.observability.yml` merged, the `prod`, `dev`, and `local` profiles also start: Grafana, Prometheus, Alloy, Loki, Tempo, Pyroscope, cAdvisor, Node Exporter, Postgres Exporter, Redis Exporter.

---

## Service startup order (prod)

```mermaid
flowchart TD
    PG["postgres"] --> REDIS["redis"]
    PG --> PGA["pgadmin"]
    PG --> PGB["pgbouncer<br/>waits for postgres healthy"]
    PGB --> MIG["migrate<br/>waits for postgres + pgbouncer healthy<br/>exits after deploy"]
    REDIS --> API["api<br/>waits for migrate exit 0 + redis healthy"]
    MIG --> API
    API --> WEB["web<br/>waits for api healthy"]
    WEB --> PROXY["proxy / nginx<br/>waits for api + web healthy"]
```

---

## Health probes

| Service | Endpoint | Strategy |
|---------|----------|---------|
| postgres | `pg_isready -h 127.0.0.1` | TCP |
| redis | `redis-cli ping` | PONG |
| pgbouncer | TCP port check | TCP |
| api | `GET /api/health/live` | Liveness only (no deps) |
| api readiness | `GET /api/health/ready` | Checks Redis PING + Postgres SELECT 1 |
| web | `GET /` | HTTP 200 |
| nginx | `GET /healthz` | HTTP 200 |

**Liveness vs readiness:** The Docker `HEALTHCHECK` for `api` uses `/live` (no dependencies). The `/ready` endpoint is for load balancer probes — it checks Redis + Postgres and returns 503 if either is down.

---

## Request flow — authenticated API call

```mermaid
flowchart TD
    B([Browser]) -->|HTTPS| N["nginx"]
    N -->|/api/*| NG["NestJS - port 3001"]
    NG --> TG["ThrottlerGuard<br/>NestJS global guard, Redis-backed"]
    TG --> AG["AuthGuard<br/>@repo/auth, reads session cookie"]
    AG --> FR["Fresh role lookup<br/>DB / Redis"]
    FR --> CH["Controller handler"]
    CH --> SV["Service - business logic"]
    SV --> PR["Prisma client"]
    PR -->|transaction pool| PGB[("PgBouncer")]
    PGB --> DBQ[("PostgreSQL")]
    DBQ -.->|"response"| SV
```

---

## Request flow — web SSR (server-side auth)

```mermaid
flowchart TD
    B([Browser]) -->|HTTPS| N["nginx"]
    N -->|/*| NX["Next.js - port 3000"]
    NX --> RC["Server Component / Route Handler"]
    RC --> PX["proxy.ts<br/>forwards request + cookies"]
    PX -->|INTERNAL_API_URL| NEST["NestJS - port 3001"]
    NEST --> AUTH["Better Auth<br/>resolves session from cookie"]
    AUTH -.->|"returns user + session"| PX
    PX -.->|"HTML rendered with user data"| NX
    NX -.->|HTTPS response| B
```

The web server **never** touches Postgres or Better Auth directly — always via the API proxy.

---

## Observability pipeline

```mermaid
flowchart TD
    API["apps/api"] -->|OTel OTLP gRPC :4317| AL["Grafana Alloy"]
    WEB["apps/web"] -->|OTel OTLP gRPC :4317| AL
    BR(["Browser"]) -->|Faro HTTP /collect| NGX["nginx"]
    NGX -->|Faro HTTP :12347| AL
    NGX -->|log files, volume mount| AL
    API -->|Pyroscope SDK :4040| PYR["Pyroscope<br/>continuous profiling"]

    AL --> LOK["Loki<br/>logs"]
    AL --> PROM["Prometheus<br/>metrics"]
    AL --> TMP["Tempo<br/>traces"]

    LOK --> GRAF["Grafana<br/>dashboards + alerts"]
    PROM --> GRAF
    TMP --> GRAF
```

---

## Security boundaries

1. **Web tier isolation:** No database credentials or auth secrets in web container. Enforced by CI guards.
2. **nginx rate limiting:** Three zones (auth, API, general) per IP. No bypass mechanism exists.
3. **Better Auth rate limits:** Per-endpoint, per-IP/user limits with Redis storage.
4. **NestJS Throttler:** Global guard, additional layer.
5. **Role hierarchy:** Admins cannot act on peers or superiors (`enforceRoleHierarchy()`).
6. **Password policy:** Min 8 chars, requires uppercase + lowercase + number + symbol.
7. **Session freshness:** Destructive operations (delete account, change email) require a session younger than `SESSION_FRESH_AGE` (15 min default).
8. **Audit trail:** All admin operations written to `auditLog`. Domain mutations via outbox.

---

## Key technical decisions

| Decision | Rationale |
|----------|-----------|
| **Prisma 7 with adapter-pg** | Native PostgreSQL driver, no libpq dependency, runs in edge environments |
| **PgBouncer transaction mode** | Reduces Postgres connection count under load; requires `DIRECT_URL` bypass for migrations |
| **Better Auth 1.6.29 pinned** | 1.7.x is ESM-only, incompatible with current CJS API setup |
| **Architecture B (secret-free web)** | Minimises blast radius; web compromise cannot access DB or sign auth tokens |
| **Redis for sessions** | Better Auth secondary storage for fast session lookups without DB round-trips |
| **Outbox pattern for domain audit** | Guarantees audit delivery even if the audit write fails (retried by poller) |
| **Three-layer rate limiting** | Defense-in-depth; each layer independently mitigates different attack vectors |
| **mkcert for local TLS** | Browser-trusted certs without any CA bundle hacks |
| **Single root .env** | One source of truth; no per-package env files; Docker and local use the same file |
