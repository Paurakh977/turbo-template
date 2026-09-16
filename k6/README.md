# k6 Load Testing & Observability Validation Suite

> **Phase 5 Implementation** of the Turborepo Observability Stack.  
> Exercises every API endpoint, edge case, RBAC role, and rate limiting tier while providing end-to-end telemetry verification in Grafana, Prometheus, Tempo, Loki, and Pyroscope.

---

## 1. Directory Structure

```text
k6/
├── config.js                 # Centralized configuration, default thresholds & credentials
├── helpers/
│   ├── auth.js               # Better Auth lifecycle (sign-in, session, cookies)
│   ├── data.js               # Dynamic payload generators (notes, users, audit)
│   └── http.js               # HTTP client with automated W3C traceparent injection
├── scenarios/
│   ├── public-flow.js        # Health probes (/api/health/live, /api/health/ready) & /api/links
│   ├── auth-flow.js          # Authentication, session validation, role & permissions query
│   ├── notes-flow.js         # Notes CRUD operations (list, create, update, delete)
│   ├── audit-flow.js         # Client audit logs write & admin audit listing with filters
│   ├── rate-limit-flow.js    # Server-action Redis rate limiting (/api/rate-limit/check)
│   ├── web-flow.js           # Next.js SSR pages (/, /auth, /dashboard) & Faro telemetry (/collect)
│   └── edge-cases-flow.js    # Boundary tests: 400 Bad Request, 401 Unauthorized, 403 Forbidden, 404 Not Found
├── suites/
│   ├── smoke.js              # 1-5 VUs, 30s: Fast sanity check for CI/CD pre-merge
│   ├── load.js               # Ramp 0→25→50 VUs (7m): Realistic production user load
│   ├── stress.js             # Ramp 25→200 VUs (5.5m): Concurrency limits & pool saturation
│   ├── spike.js              # Instant surge to 150 VUs: Tests Nginx & Better Auth 429 defenses
│   ├── soak.js               # Sustained 20 VUs (10m+): Memory & database connection leak check
│   └── edge-cases.js         # Explicit 4xx response code validation & error metrics
├── run.ps1                   # Smart runner (auto-detects local k6 CLI or runs via Docker)
├── package.json              # Local runner scripts
└── README.md                 # You are here
```

---

## 2. Quick Start

### Running from Repo Root (Recommended)

You can run any test suite directly from the root using npm/pnpm scripts. The script automatically uses native `k6` if installed, or falls back to the official `grafana/k6:latest` Docker image:

```bash
# 1. Smoke Test (Sanity verification across all subsystems)
pnpm run k6:smoke

# 2. Edge Cases Test (400, 401, 403, 404 validation)
pnpm run k6:edge

# 3. Production Load Test (Simulates daily user concurrency)
pnpm run k6:load

# 4. Stress Test (Pushes PG pool, Redis bandwidth, Pyroscope CPU)
pnpm run k6:stress

# 5. Spike Test (Surge traffic testing Layer 1 Nginx 429 rate limiting)
pnpm run k6:spike

# 6. Soak Test (Extended duration leak detection)
pnpm run k6:soak
```

### Running via PowerShell Runner Script

```powershell
# Run smoke test against default https://localhost
.\k6\run.ps1 smoke

# Run load test against custom base URL
.\k6\run.ps1 load -BaseUrl https://localhost

# Run edge-cases test
.\k6\run.ps1 edge-cases
```

### Running Directly with Native k6 CLI

```bash
k6 run -e BASE_URL=https://localhost --insecure-skip-tls-verify k6/suites/smoke.js
```

### Running with Docker Directly

```bash
docker run --rm -i \
  -v "${PWD}/k6:/scripts" \
  --network host \
  grafana/k6:latest run \
  -e BASE_URL=https://localhost \
  --insecure-skip-tls-verify \
  /scripts/suites/smoke.js
```

### Loosening rate limits for k6 (host-run stacks)

All k6 VUs share a handful of IPs, so production limits 429 the suite itself.
When the apps run **on the host** (`pnpm dev`), the `.env.k6` overlay relaxes
exactly those knobs — it loads only when `K6_TESTING=true` (Docker Compose
never reads it):

```bash
cp .env.k6.example .env.k6
K6_TESTING=true pnpm dev   # PowerShell: $env:K6_TESTING='true'; pnpm dev
pnpm k6:load
```

---

## 3. Test Suites & Objectives

| Suite | Profile & Duration | Primary Objective & Observability Verification |
|---|---|---|
| **`smoke.js`** | 2 VUs, 30s | Validates all routes respond with HTTP 200/201, p95 latency < 250ms, 0% failure rate. |
| **`load.js`** | 10 → 25 → 50 VUs (7m) | Verifies RED metrics in **02 - API Performance**: Request Rate (RPS), Latency p50/p95/p99, Error Rate. |
| **`stress.js`** | 25 → 75 → 150 → 200 VUs (5.5m) | Pushes PostgreSQL pool saturation and Redis command volume in **03 - Database & Redis**. Triggers CPU profiling in **05 - Continuous Profiling**. |
| **`spike.js`** | 5 → 150 VUs in 10s | Validates Layer 1 Nginx `limit_req` and Layer 2 Better Auth rate limiting (429 handling) in **04 - Auth & Security**. Ensures system survives without 500s. |
| **`soak.js`** | 20 VUs steady for 10m+ | Validates absence of memory leaks and connection leaks in Node.js and PostgreSQL. |
| **`edge-cases.js`** | 2 VUs, 30s | Validates negative HTTP paths: 400 Bad Request, 401 Unauthorized, 403 Forbidden, 404 Not Found, 429 Too Many Requests. |

---

## 4. Endpoints & Features Covered

### Public & Monitoring Endpoints
- `GET /api/health/live`: Unauthenticated liveness probe.
- `GET /api/health/ready`: Readiness probe verifying PostgreSQL and Redis health.
- `GET /api/links`: Read-only link directory.
- `GET /api/links/0`: Single link fetch.
- `GET /api/links/999999`: 404 Not Found validation.

### Better Auth & Session Lifecycle
- `POST /api/auth/sign-in/email`: SuperAdmin sign-in with session cookie issuance.
- `GET /api/auth/get-session`: Authenticated session retrieval with cookie.
- `POST /api/auth/sign-in/email` (invalid password): 401 Unauthorized negative test.
- `POST /api/auth/sign-out`: Session termination.

### RBAC Roles & Permissions
- `GET /api/users/me/role`: Current user role verification from PostgreSQL.
- `GET /api/users/me/permissions`: Effective permissions check across `notes` and `settings`.
- **RBAC Security Gate**: Regular user attempting `POST /api/notes` or `DELETE /api/notes/:id` is blocked with **403 Forbidden**.

### Notes CRUD Operations
- `GET /api/notes?limit=10&offset=0`: Authenticated note listing.
- `POST /api/notes`: Note creation with business span `notes.create`.
- `PATCH /api/notes/:id`: Note update with business span `notes.update`.
- `DELETE /api/notes/:id`: Note removal (superAdmin only) with business span `notes.delete`.
- `POST /api/notes` (empty title): 400 Bad Request validation.
- `PATCH /api/notes/nonexistent_id`: 404 Not Found validation.

### Audit Logging
- `POST /api/audit-logs`: User-attributed client audit recording (`profile_updated`, `theme_changed`).
- `GET /api/admin/audit-logs`: Admin audit querying with action filtering and pagination.
- `POST /api/audit-logs` (forged action): 400 Bad Request rejection.

### Server Action Rate Limiting
- `POST /api/rate-limit/check`: Redis token bucket rate limit check for action scopes (`notes:create`, `settings:theme`).

### Web SSR & Faro Telemetry
- `GET /`, `GET /auth`, `GET /dashboard`: Next.js server-side rendered pages.
- `POST /collect`: Faro browser RUM ingestion proxied through Nginx to Grafana Alloy.

---

## 5. Observability Stack Corroboration

Open Grafana at **[http://localhost:3002](http://localhost:3002)** (admin / admin) while running tests:

### 1. `02 - API Performance` Dashboard
- **Total Request Rate (RPS)**: Matches the load generated by k6.
- **Latency Percentiles (p50, p95, p99)**: Matches k6 `http_req_duration` statistics.
- **Status Code Distribution**: Displays 200, 201, 400, 401, 403, 404, 429 distributions.

### 2. `03 - Database & Redis` Dashboard
- **Active PostgreSQL Connections**: Rises with VU concurrency and recovers cleanly.
- **Database Transactions & Row Activity**: Correlates with Notes and Audit CRUD operations.
- **Redis Command Rate & Latency**: Shows session lookups and sliding-window rate limit checks.

### 3. `04 - Auth & Security` Dashboard
- **Sign-in Rate (Success vs Failure)**: Captures both successful logins and simulated credential attacks.
- **Rate Limit Hits**: Displays rate-limiting events triggered during spike and stress testing.

### 4. `05 - Continuous Profiling` Dashboard
- **API Service CPU Flamegraph**: Renders live CPU flamegraphs from Pyroscope showing hot code paths under load.

### 5. Tempo & Loki Correlated Tracing
- **Tempo**: Search by `service.name = "api"`. Every request includes:
  - Root HTTP span: `POST /api/notes`
  - Business span: `notes.create`
  - PostgreSQL child spans: `pg.query:INSERT INTO "notes"`
  - Redis child spans: `redis:INCR`
- **Trace to Logs**: Click **"Logs for this span"** on any Tempo trace to open correlated structured JSON logs in Loki matching the exact `trace_id`.
