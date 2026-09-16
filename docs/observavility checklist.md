# Production-Grade Observability & Monitoring Guide

## Turborepo: Next.js + NestJS + Better Auth + Prisma + PostgreSQL + Redis + Nginx + Docker

**Observability stack:** Grafana, Prometheus, Loki, Tempo, k6, Grafana Alloy, Pyroscope, Grafana Faro, and Grafana OnCall  
**Not included:** Mimir

> **Goal:** Build an observability foundation that automatically covers new endpoints and standard dependencies while giving you deliberate manual control for important business workflows.

---

# Table of Contents

1. Core Goal
2. Mental Model
3. Target Architecture
4. Golden Principles
5. Observability Contract
6. Monorepo Architecture
7. Implementation Order
8. OpenTelemetry Instrumentation
9. Traces and Spans
10. Automatic vs Manual Instrumentation
11. Metrics Strategy
12. Logging Strategy
13. Prometheus
14. Loki
15. Tempo
16. Alloy
17. Pyroscope
18. Faro
19. k6
20. Grafana
21. OnCall and Alerting
22. Correlation
23. PostgreSQL and Redis
24. Infrastructure and Docker
25. Dashboards
26. Sampling, Cardinality, Privacy, Retention
27. Deployment Correlation
28. Testing Observability
29. Do's and Don'ts
30. New Feature Checklist
31. Incident Runbooks
32. Definition of Done

---

# 1. Core Goal

The goal is **not**:

> Install many observability containers and call the system observable.

The real goal is:

```text
Something goes wrong
        ↓
Alert or dashboard detects it
        ↓
Identify the affected host/container/service
        ↓
Identify the affected endpoint or business operation
        ↓
Open a representative trace
        ↓
Find the slow/failing span
        ↓
Open correlated logs
        ↓
Open a profile if code/resource usage is involved
        ↓
Find the responsible code path or dependency
        ↓
Fix the problem
```

Your success criterion:

```text
METRIC
  ↓
Which service is unhealthy?
  ↓
TRACE
  ↓
Which operation/request is unhealthy?
  ↓
LOGS
  ↓
What happened?
  ↓
PROFILE
  ↓
Which code path consumed resources?
```

---

# 2. Mental Model

## Metrics

Metrics answer:

```text
What is happening over time?
```

Examples:

- CPU usage
- memory usage
- request rate
- error rate
- p50/p95/p99 latency
- payment failures
- orders created

Backend:

```text
Prometheus
```

## Logs

Logs answer:

```text
What happened?
```

Example:

```json
{
  "level": "error",
  "service": "api",
  "trace_id": "abc",
  "span_id": "xyz",
  "message": "Payment provider timeout"
}
```

Backend:

```text
Loki
```

## Traces

Traces answer:

```text
Where did this particular request go?
```

Example:

```text
POST /orders
        ↓
Authentication
        ↓
Authorization
        ↓
Order workflow
        ↓
PostgreSQL
        ↓
Redis
        ↓
External API
```

Backend:

```text
Tempo
```

## Profiles

Profiles answer:

```text
Which code path/function is consuming CPU, allocating memory,
or otherwise consuming runtime resources?
```

Backend:

```text
Pyroscope
```

## Visualization

```text
Grafana
```

## Telemetry collection and routing

```text
Grafana Alloy
```

## Load generation

```text
k6
```

## Browser/frontend observability

```text
Grafana Faro
```

## Incident notification/escalation

```text
Grafana OnCall
```

---

# 3. Target Architecture

```text
                           ┌────────────────────┐
                           │      Browser       │
                           │ Faro / RUM / Errors│
                           │ Frontend Tracing   │
                           └─────────┬──────────┘
                                     │
                                     │ trace context
                                     ▼
┌────────────────────────────────────────────────────────────┐
│                         Next.js                            │
│                                                            │
│ Frontend observability and server instrumentation          │
└─────────────────────────────┬──────────────────────────────┘
                              │
                              ▼
                        ┌───────────┐
                        │   Nginx   │
                        └─────┬─────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────┐
│                         NestJS                             │
│                                                            │
│ OpenTelemetry                                              │
│ Auto instrumentation                                      │
│ Manual business spans                                      │
│ Structured logs                                            │
│ Business metrics                                           │
│ Continuous profiling                                      │
└───────┬────────────────┬────────────────┬──────────────────┘
        │                │                │
        ▼                ▼                ▼
   PostgreSQL           Redis       External APIs

Application telemetry
        │
        ▼
┌────────────────────────────────────────────────────────────┐
│                       Grafana Alloy                        │
│                                                            │
│ receive → filter → redact → enrich → batch → route        │
└───────┬──────────────┬──────────────┬──────────────────────┘
        │              │              │
        ▼              ▼              ▼
   Prometheus         Loki           Tempo
    Metrics           Logs           Traces
        │                              │
        │                              ├── Trace ↔ Logs
        │                              └── Trace ↔ Profiles
        ▼
    Grafana  ◄──────────────────── Pyroscope
                                      Profiles

Host/container sources:
- Node/host metrics collector
- cAdvisor
- PostgreSQL metrics source
- Redis metrics source

Load testing:
k6 → application → metrics/traces/logs/profiles → Grafana
```

---

# 4. Golden Principles

## Principle 1: Instrument boundaries once

Instrument common boundaries globally:

- incoming HTTP
- outgoing HTTP
- database
- Redis
- queues/messaging when added
- framework/runtime
- exceptions

Then future endpoints inherit baseline observability.

## Principle 2: Manual spans are for business meaning

Automatic instrumentation can show:

```text
HTTP request → SQL → Redis → HTTP call
```

Manual spans add business meaning:

```text
payment.validate
payment.reserve-inventory
payment.process
payment.finalize
```

## Principle 3: Do not trace every function

Do not create a span for every tiny function.

Create manual spans only when an operation is:

- business-important
- potentially slow
- externally dependent
- complex
- a meaningful debugging boundary

## Principle 4: Profiles are not traces

Do not create spans for every function just to find CPU usage.

Use Pyroscope for continuous profiling.

## Principle 5: Correlation is mandatory

Target relationships:

```text
Metric → Trace
Trace → Logs
Trace → Profile
Frontend trace → Backend trace
```

## Principle 6: Do not collect sensitive data

Never intentionally record:

- passwords
- access tokens
- refresh tokens
- session cookies
- authorization headers
- secrets
- payment secrets
- unnecessary personal data

## Principle 7: Prefer standards

Use OpenTelemetry conventions and consistent naming.

---

# 5. Define the Observability Contract

Before configuring tools, document how your application identifies and describes telemetry.

## Required resource attributes

Every service should consistently identify itself.

```text
service.name
service.namespace
service.version
deployment.environment.name
```

Example:

```text
service.namespace = my-platform
service.name = api
service.version = <git-commit-sha>
deployment.environment.name = production
```

For the web application:

```text
service.namespace = my-platform
service.name = web
service.version = <git-commit-sha>
deployment.environment.name = production
```

These are **resource metadata**, not spans.

They answer:

```text
Which service produced this?
Which environment?
Which deployment version?
```

## Environment naming

Choose a fixed vocabulary:

```text
development
test
staging
production
```

Checklist:

- [ ] Every service has stable `service.name`
- [ ] Namespace is consistent
- [ ] Every deployment has version/build identity
- [ ] Every signal includes environment identity
- [ ] Naming is documented
- [ ] Names do not accidentally change

---

# 6. Recommended Monorepo Architecture

Conceptual structure:

```text
apps/
├── web/
│   ├── src/
│   └── instrumentation/
│
└── api/
    ├── src/
    └── instrumentation/

packages/
├── observability/
│   ├── config/
│   ├── telemetry/
│   ├── logging/
│   ├── metrics/
│   └── tracing/
│
└── shared/
```

Centralize conventions for:

- service metadata
- standard attributes
- tracing helpers
- logging helpers
- custom metric conventions
- environment configuration
- redaction rules

Do not overengineer this package on day one.

---

# 7. Recommended Implementation Order

## Phase 0 — Architecture

- [ ] Document all services
- [ ] Document environments
- [ ] Define resource attributes
- [ ] Define structured log format
- [ ] Define metric naming rules
- [ ] Define sensitive-data policy
- [ ] Define alert ownership

## Phase 1 — Infrastructure visibility

Start:

- [ ] Grafana
- [ ] Prometheus
- [ ] Loki
- [ ] Tempo
- [ ] Alloy
- [ ] Pyroscope
- [ ] host metrics collector
- [ ] cAdvisor

Success:

```text
I can see the VPS and containers.
```

## Phase 2 — NestJS baseline

Add:

- [ ] incoming HTTP tracing
- [ ] outgoing HTTP tracing
- [ ] runtime metrics
- [ ] Prisma/database tracing
- [ ] Redis tracing
- [ ] exception recording

Success:

```text
GET /users → trace visible
```

## Phase 3 — Logs

Success:

```text
Trace → related logs
```

## Phase 4 — Metrics

Success:

```text
Latency/error metric → representative trace
```

## Phase 5 — Pyroscope

Success:

```text
CPU high → service/container → code path
```

## Phase 6 — Faro

Success:

```text
Browser action → frontend trace → backend trace
```

## Phase 7 — Alerts and OnCall

Success:

```text
Real problem → actionable alert → correct owner
```

## Phase 8 — k6

Success:

```text
Load test → metrics → traces → logs/profiles → bottleneck identified
```

---

# 8. OpenTelemetry Instrumentation Strategy

## Initialize instrumentation early

Checklist:

- [ ] Telemetry bootstrap executes before NestJS bootstraps
- [ ] Auto-instrumentation loads before supported libraries
- [ ] Resource attributes are configured globally
- [ ] Context propagation is enabled
- [ ] Export endpoints are environment-driven

## Baseline automatic coverage

Aim for:

- [ ] incoming HTTP
- [ ] outgoing HTTP
- [ ] database client/driver
- [ ] Redis
- [ ] supported framework operations
- [ ] exceptions
- [ ] runtime/process metrics

Future routes such as:

```text
/users
/books
/orders
/payments
/subscriptions
```

should automatically receive baseline request-level visibility.

---

# 9. Traces and Spans

## Definitions

```text
Trace = complete request/job journey

Span = one timed operation inside that journey
```

Example:

```text
TRACE: POST /orders

HTTP POST /orders
│
├── auth.check
├── order.validate
├── order.reserve-inventory
│   └── Redis GET
├── order.process-payment
│   └── HTTP payment provider
└── order.persist
    └── PostgreSQL INSERT
```

## Parent and child spans

The incoming request is commonly the root/request span.

Operations inside it can become child spans.

Example:

```text
HTTP POST /orders
└── order.process-payment
    └── HTTP POST payment-provider
```

Checklist:

- [ ] Incoming requests create request traces automatically
- [ ] Context propagates to child operations
- [ ] Context propagates to future downstream services
- [ ] Errors mark spans as errors
- [ ] Exceptions are recorded
- [ ] Important workflows have manual spans
- [ ] Span names are stable
- [ ] Sensitive attributes are excluded
- [ ] Span names do not contain unique IDs

---

# 10. Automatic vs Manual Instrumentation

## Automatic spans

Typical examples:

```text
HTTP GET /users
HTTP POST /orders
PostgreSQL SELECT
PostgreSQL INSERT
Redis GET
Redis SET
Outgoing HTTP request
```

You configure the instrumentation once.

## Manual spans

Use for meaningful operations:

```text
payment.process
order.reserve-inventory
order.calculate-discount
report.generate
ai.generate-response
file.process
subscription.renew
```

## Manual span decision checklist

- [ ] Is this operation business-important?
- [ ] Would I investigate it during an incident?
- [ ] Can it be slow?
- [ ] Does it coordinate dependencies?
- [ ] Is it a meaningful workflow step?

## Do not create spans for

- [ ] every function
- [ ] trivial helpers
- [ ] formatting
- [ ] every loop
- [ ] every getter
- [ ] every line of code

---

# 11. Metrics Strategy

## Core distinction

Trace:

```text
Why was THIS order slow?
```

Metric:

```text
Are orders becoming slow over time?
```

## Metric categories

### Infrastructure

- CPU
- memory
- disk
- network
- container restarts

### Service

- request rate
- error rate
- latency
- saturation

### Dependencies

- PostgreSQL connections
- locks
- Redis memory
- cache hits/misses
- dependency latency

### Business

Examples:

```text
auth_logins_total
auth_login_failures_total

orders_created_total
orders_cancelled_total

payments_attempted_total
payments_failed_total
payment_amount_total
```

## Do not create metrics for every function

Create metrics for behavior you need to monitor as a trend.

For each important business capability ask:

- [ ] How many operations happen?
- [ ] How many succeed?
- [ ] How many fail?
- [ ] How long do they take?
- [ ] Is there a backlog?
- [ ] Is business volume worth tracking?

Checklist:

- [ ] Metric names describe stable concepts
- [ ] Labels have bounded values
- [ ] No user ID labels
- [ ] No request ID labels
- [ ] No email labels
- [ ] No unique order/payment IDs
- [ ] Counters for cumulative events
- [ ] Histograms for latency distributions
- [ ] Gauges for current values

---

# 12. Logging Strategy

Use structured JSON.

Example:

```json
{
  "timestamp": "...",
  "level": "error",
  "service": "api",
  "trace_id": "...",
  "span_id": "...",
  "message": "Payment provider timeout"
}
```

Required fields:

```text
timestamp
level
message
service identity
environment
trace_id when context exists
span_id when available
error type when relevant
```

Checklist:

- [ ] Structured JSON logs
- [ ] Trace ID injected into active request logs
- [ ] Span ID injected where supported
- [ ] Service/environment included
- [ ] Error stack traces captured appropriately
- [ ] Sensitive fields redacted
- [ ] Log levels consistent
- [ ] Success-path logging is not excessive
- [ ] Retention configured

Typical levels:

```text
DEBUG = development/debugging
INFO  = important normal events
WARN  = suspicious/recoverable conditions
ERROR = failures requiring investigation
```

---

# 13. Prometheus Checklist

## Responsibilities

- application metrics
- infrastructure metrics
- container metrics
- database/cache metrics
- business metrics
- alert query source

### Application

- [ ] Request rate
- [ ] Error rate
- [ ] Request duration
- [ ] Runtime/process metrics
- [ ] Custom business metrics

### Infrastructure

- [ ] Host CPU
- [ ] Host memory
- [ ] Disk usage
- [ ] Disk pressure
- [ ] Network
- [ ] Load

### Docker

- [ ] Container CPU
- [ ] Container memory
- [ ] Container network
- [ ] Restart/health state

### Alerts

- [ ] Actionable thresholds
- [ ] Service/environment identity
- [ ] Investigation links/runbooks
- [ ] Alerts tested

---

# 14. Loki Checklist

Loki stores and queries logs.

- [ ] Structured JSON logs
- [ ] Reliable log collection
- [ ] Service/environment labels available
- [ ] Trace ID correlation
- [ ] Sensitive data redacted
- [ ] Label cardinality controlled
- [ ] Retention configured
- [ ] Error logs easy to search

## Important warning

Do not make highly unique values Loki labels:

```text
user_id
request_id
trace_id
email
order_id
```

Use them as fields when necessary, not indexed labels.

---

# 15. Tempo Checklist

Tempo stores traces.

- [ ] Incoming HTTP traced
- [ ] Database operations traced
- [ ] Redis traced
- [ ] Outgoing HTTP traced
- [ ] Errors represented correctly
- [ ] Important workflows have manual spans
- [ ] Trace context propagates
- [ ] Cross-service propagation ready
- [ ] Trace-to-log correlation
- [ ] Trace-to-profile correlation
- [ ] Sampling documented

Good stable names:

```text
GET /users
POST /orders
order.process-payment
payment.calculate-fees
```

Avoid names containing IDs:

```text
GET /users/123456
payment-839483
```

---

# 16. Alloy Checklist

Alloy is your telemetry pipeline:

```text
receive
  ↓
filter
  ↓
redact
  ↓
enrich
  ↓
batch
  ↓
route
```

Checklist:

- [ ] Receive OTLP telemetry
- [ ] Collect/receive logs
- [ ] Collect host/container telemetry where designed
- [ ] Add consistent resource metadata
- [ ] Batch telemetry
- [ ] Filter unnecessary telemetry
- [ ] Redact sensitive data
- [ ] Route traces to Tempo
- [ ] Route logs to Loki
- [ ] Route metrics to the metrics backend
- [ ] Route profiles to Pyroscope
- [ ] Monitor Alloy itself
- [ ] Use bounded retries/buffers
- [ ] Avoid public exposure of unnecessary collector ports

---

# 17. Pyroscope Checklist

## What it solves

```text
API CPU = 95%
        ↓
Which service/container?
        ↓
Which code path?
        ↓
Which function?
```

Example:

```text
API CPU = 95%
        ↓
PaymentService.process
        ↓
calculateTax
        ↓
nestedLoop
```

Checklist:

- [ ] Continuous profiling enabled where supported
- [ ] CPU profiles collected
- [ ] Allocation/memory profiling evaluated
- [ ] Profiling overhead tested
- [ ] Service/version/environment metadata consistent
- [ ] Trace/profile correlation configured
- [ ] Access controls configured
- [ ] Retention configured

Incident path:

```text
CPU high
  ↓
Prometheus
  ↓
Which service/container?
  ↓
Pyroscope
  ↓
Which code path?
  ↓
Tempo
  ↓
Which requests/workflows correlate?
  ↓
Loki
  ↓
What happened?
```

---

# 18. Faro and Frontend Observability Checklist

Target:

- frontend errors
- browser performance
- Web Vitals
- frontend logs
- navigation
- browser traces
- backend correlation

Checklist:

- [ ] Frontend errors captured
- [ ] Source maps handled appropriately
- [ ] Core Web Vitals captured
- [ ] Frontend trace propagation configured
- [ ] API requests correlate with backend traces
- [ ] Sensitive data excluded
- [ ] Browser telemetry endpoints protected/rate-limited
- [ ] Sampling strategy documented

Success test:

```text
User clicks "Create Order"
        ↓
Browser span
        ↓
HTTP request
        ↓
NestJS request span
        ↓
Business spans
        ↓
Database/cache spans
```

---

# 19. k6 Checklist

## Purpose

k6 is not only:

```text
Can my API survive 1,000 users?
```

It also answers:

```text
What breaks first?
What gets slower?
Does the database saturate?
Does Redis become a bottleneck?
Which code path consumes CPU?
```

Test scenarios:

### Smoke

- [ ] Small load
- [ ] Basic correctness

### Load

- [ ] Expected normal traffic

### Stress

- [ ] Above expected capacity

### Spike

- [ ] Sudden traffic increase

### Soak

- [ ] Long-running traffic
- [ ] Memory leak/gradual degradation detection

Checklist:

- [ ] Authentication handled safely
- [ ] Test data isolated
- [ ] Tests reproducible
- [ ] Thresholds defined
- [ ] Infrastructure metrics monitored
- [ ] Traces available for investigation
- [ ] Profiles available for bottlenecks

---

# 20. Grafana Checklist

## Datasources

- [ ] Prometheus
- [ ] Loki
- [ ] Tempo
- [ ] Pyroscope

## Dashboards

### Service overview

- [ ] Request rate
- [ ] Error rate
- [ ] p50/p95/p99 latency
- [ ] CPU
- [ ] Memory
- [ ] Deployment version

### API

- [ ] Routes
- [ ] Errors
- [ ] Latency
- [ ] Dependency performance

### Database

- [ ] Connections
- [ ] Locks
- [ ] Transactions
- [ ] Resource pressure

### Redis

- [ ] Memory
- [ ] Clients
- [ ] Hits/misses
- [ ] Evictions
- [ ] Latency

### Infrastructure

- [ ] VPS health
- [ ] Disk
- [ ] CPU
- [ ] Memory
- [ ] Network
- [ ] Containers

### Business

- [ ] Logins
- [ ] Orders
- [ ] Payments
- [ ] Failures

Verify navigation:

- [ ] Metric → Trace
- [ ] Trace → Logs
- [ ] Trace → Profile
- [ ] Service → Dashboard
- [ ] Alert → Dashboard

---

# 21. OnCall and Alerting Checklist

## Philosophy

Alert on symptoms requiring action.

Ask:

```text
Does someone need to investigate?
What should they do?
```

Good alert categories:

### Availability

- [ ] Service unavailable
- [ ] Container repeatedly crashing

### User impact

- [ ] Error rate high
- [ ] p95/p99 latency high

### Resource saturation

- [ ] CPU sustained high
- [ ] Memory pressure
- [ ] Disk almost full

### Dependency health

- [ ] Database connection exhaustion
- [ ] Redis memory exhaustion
- [ ] Dependency errors high

### Business critical

- [ ] Payment failure rate high
- [ ] Login failures spike
- [ ] Critical queue backlog

Every alert should ideally include:

- [ ] Severity
- [ ] Service
- [ ] Environment
- [ ] Description
- [ ] Dashboard/investigation link
- [ ] Runbook
- [ ] Owner

Avoid:

- [ ] Alert storms
- [ ] Duplicate alerts
- [ ] Alerts with no action
- [ ] Paging for low-priority issues
- [ ] Alerts on tiny temporary spikes without duration logic

---

# 22. Correlation: Metrics → Traces → Logs → Profiles

This is the heart of the design.

## Scenario A: API is slow

```text
Metric:
p95 latency increased
        ↓
Trace:
POST /orders is slow
        ↓
Span:
order.process-payment is slow
        ↓
Logs:
Payment provider timeout
        ↓
Conclusion:
External dependency is slow
```

## Scenario B: CPU is high

```text
Metric:
API CPU = 95%
        ↓
Container:
api container responsible
        ↓
Pyroscope:
calculateDiscount consumes 80% CPU
        ↓
Trace:
order.calculate-discount correlates
        ↓
Logs:
Large order payloads involved
        ↓
Conclusion:
Algorithm/data-size problem
```

## Scenario C: Errors after deployment

```text
Metric:
Error rate increased
        ↓
Resource metadata:
service.version = new deployment
        ↓
Trace:
Specific endpoint failing
        ↓
Logs:
Exception details
        ↓
Conclusion:
Deployment regression
```

Correlation checklist:

- [ ] Stable service/resource metadata
- [ ] Logs include trace ID when context exists
- [ ] Logs include span ID where supported
- [ ] Metrics/traces share service/environment dimensions
- [ ] Trace links/exemplars configured where supported
- [ ] Profiles use consistent service identity
- [ ] Trace/profile correlation tested
- [ ] Deployment version visible across signals

---

# 23. PostgreSQL and Redis Observability

## PostgreSQL

Monitor:

- [ ] Connections
- [ ] Connection pool saturation
- [ ] Transaction rate
- [ ] Query latency
- [ ] Locks
- [ ] Deadlocks
- [ ] Cache hit ratio
- [ ] Disk growth

Application trace:

```text
Business span
    ↓
Prisma/database operation
    ↓
Duration/error
```

## Redis

Monitor:

- [ ] Memory
- [ ] Connected clients
- [ ] Commands
- [ ] Hit rate
- [ ] Miss rate
- [ ] Evictions
- [ ] Latency

Trace:

```text
Business operation
    ↓
Redis operation
```

---

# 24. Infrastructure and Docker Monitoring

## Host

- [ ] CPU
- [ ] Memory
- [ ] Disk
- [ ] Filesystem usage
- [ ] Network
- [ ] Load

## Containers

- [ ] CPU
- [ ] Memory
- [ ] Network
- [ ] Restarts
- [ ] Health
- [ ] Resource limits

Your stack may include:

```text
nginx
web
api
postgres
redis
grafana
prometheus
loki
tempo
pyroscope
alloy
```

Security:

- [ ] Internal Docker networks used
- [ ] Authentication configured
- [ ] Only necessary services exposed
- [ ] Firewall rules configured
- [ ] TLS for public endpoints
- [ ] Observability backends not blindly exposed

---

# 25. Production Dashboard Checklist

## API dashboard

- [ ] Request rate
- [ ] Error rate
- [ ] p50 latency
- [ ] p95 latency
- [ ] p99 latency
- [ ] Top failing routes
- [ ] Top slow routes
- [ ] Dependency latency
- [ ] Deployment version

## Infrastructure dashboard

- [ ] Host CPU
- [ ] Host memory
- [ ] Disk
- [ ] Container CPU
- [ ] Container memory
- [ ] Container restarts

## Database dashboard

- [ ] Connections
- [ ] Latency
- [ ] Locks
- [ ] Saturation

## Business dashboard

Examples:

```text
Login attempts
Login failures
Orders created
Orders cancelled
Payments attempted
Payments failed
```

---

# 26. Sampling, Cardinality, Privacy, and Retention

## Traces

Define a sampling strategy.

Keep sufficient traces for:

- errors
- slow requests
- representative normal traffic

Do not aggressively sample away all useful evidence.

## Metric cardinality

Never use highly unique values as metric dimensions:

```text
user_id
request_id
email
order_id
payment_id
```

Better:

```text
status = success|failure
method = card|wallet
route = stable route template
environment = production|staging
```

## Logs

Redact:

- passwords
- tokens
- cookies
- authorization headers
- secrets

Checklist:

- [ ] Retention configured
- [ ] Sampling documented
- [ ] Cardinality reviewed
- [ ] Sensitive-data policy implemented
- [ ] Storage growth monitored
- [ ] Collector failure behavior understood

---

# 27. Deployment and Version Correlation

Every deployment should be identifiable.

Recommended:

```text
service.version = git commit SHA
```

Success scenario:

```text
Version A
Error rate = 0.2%

Deploy Version B
Error rate = 8%

Filter:
service.name = api
service.version = Version B
```

Checklist:

- [ ] Version injected by CI/CD
- [ ] Version attached to telemetry
- [ ] Environment attached to telemetry
- [ ] Deployment changes visible in dashboards
- [ ] Rollback documented

---

# 28. Testing the Observability System

Do not assume telemetry works because containers are running.

## Successful request

- [ ] Send request
- [ ] Find trace
- [ ] Verify child spans
- [ ] Verify DB/cache spans
- [ ] Verify logs

## Application exception

- [ ] Trigger controlled error
- [ ] Verify error trace
- [ ] Verify exception
- [ ] Verify correlated logs
- [ ] Verify error metric

## Slow operation

- [ ] Create controlled delay
- [ ] Verify latency metric
- [ ] Find trace
- [ ] Identify slow span

## CPU pressure

Use a safe controlled environment:

- [ ] Generate CPU load
- [ ] Verify host/container metric
- [ ] Verify Pyroscope profile
- [ ] Find expensive code path

## Deployment regression

- [ ] Deploy identifiable version
- [ ] Verify version metadata
- [ ] Verify version filtering

## Load test

- [ ] Run k6
- [ ] Observe metrics
- [ ] Inspect slow traces
- [ ] Inspect profiles
- [ ] Inspect logs

---

# 29. Do's and Don'ts

## DO

- [x] Instrument common boundaries once
- [x] Use automatic instrumentation as baseline
- [x] Add manual spans for important workflows
- [x] Use Pyroscope for code-level CPU/memory investigation
- [x] Use metrics for trends
- [x] Use traces for individual request journeys
- [x] Use structured logs
- [x] Propagate trace context
- [x] Use stable service names
- [x] Include version/environment metadata
- [x] Test every correlation path
- [x] Build actionable alerts
- [x] Run realistic k6 scenarios
- [x] Redact secrets
- [x] Monitor the observability stack itself

## DON'T

- [ ] Don't create a span for every function
- [ ] Don't create a metric for every function
- [ ] Don't use user IDs as metric labels
- [ ] Don't use request IDs as Loki labels
- [ ] Don't put passwords/tokens in telemetry
- [ ] Don't expose every backend publicly
- [ ] Don't assume dashboards equal observability
- [ ] Don't configure untested alerts
- [ ] Don't retain everything forever without a policy
- [ ] Don't use inconsistent service names
- [ ] Don't let AI make huge changes without verification
- [ ] Don't assume correlation works without testing it
- [ ] Don't manually instrument operations already covered well automatically

---

# 30. New Feature Checklist

When adding:

```text
payments
subscriptions
notifications
AI generation
file processing
```

## Step 1: Baseline coverage

- [ ] Incoming HTTP automatically traced?
- [ ] Database operations automatically traced?
- [ ] Redis operations automatically traced?
- [ ] Outgoing HTTP automatically traced?

## Step 2: Business spans

Ask:

```text
Which workflow steps would I need during an incident?
```

Add manual spans only for meaningful steps.

## Step 3: Business metrics

Ask:

```text
What should I monitor as a trend?
```

Examples:

```text
payments_attempted_total
payments_failed_total
orders_created_total
```

## Step 4: Logging

- [ ] Important failures have useful structured logs
- [ ] Trace correlation exists
- [ ] No secrets logged

## Step 5: Alerts

Ask:

```text
Should someone be notified if this breaks?
```

If yes:

- [ ] Threshold
- [ ] Severity
- [ ] Runbook
- [ ] Owner

---

# 31. Incident Runbooks

## High CPU

```text
1. Check host/container metrics
2. Identify affected service
3. Check traffic increase
4. Open Pyroscope
5. Find expensive code path
6. Check traces in same period
7. Check logs
8. Determine:
   - traffic?
   - code regression?
   - expensive algorithm?
   - retries?
9. Mitigate
10. Document root cause
```

## High latency

```text
1. Check p95/p99
2. Identify route/service
3. Open representative slow trace
4. Find slow span
5. Determine:
   - database?
   - Redis?
   - external API?
   - application code?
6. If application CPU: open Pyroscope
7. Open logs
8. Mitigate
```

## High error rate

```text
1. Identify route/service
2. Open error traces
3. Inspect failed span
4. Open logs
5. Check deployment version
6. Check dependency health
7. Mitigate or rollback
```

## Database saturation

```text
1. Check PostgreSQL metrics
2. Check connections/locks/resources
3. Find slow DB spans
4. Identify workflows
5. Inspect logs
6. Investigate query/application behavior
```

---

# 32. Definition of Done

Do not call the platform production-ready until all are true.

## Architecture

- [ ] Stable service identity
- [ ] Environment/version present
- [ ] Automatic instrumentation configured

## Tracing

- [ ] New endpoints receive baseline traces automatically
- [ ] Database/cache/external operations visible
- [ ] Important workflows have manual spans
- [ ] Cross-service propagation ready

## Logging

- [ ] Structured
- [ ] Correlated with traces
- [ ] Secrets redacted

## Metrics

- [ ] RED metrics available
- [ ] Infrastructure metrics available
- [ ] DB/cache metrics available
- [ ] Important business metrics exist
- [ ] Cardinality controlled

## Profiles

- [ ] Pyroscope identifies expensive code paths
- [ ] Consistent service metadata
- [ ] Trace/profile investigation works

## Frontend

- [ ] Frontend errors visible
- [ ] Web Vitals visible
- [ ] Frontend/backend correlation tested

## Load testing

- [ ] k6 smoke test
- [ ] Expected-load test
- [ ] Stress/spike tests where appropriate
- [ ] Results investigable through the stack

## Alerting

- [ ] Critical alerts actionable
- [ ] Alerts route correctly
- [ ] Runbooks exist
- [ ] Delivery tested

## Correlation

These paths have been tested:

```text
Metric → Trace
Trace → Logs
Trace → Profile
Frontend → Backend
Deployment version → Incident
```

---

# Final Operating Philosophy

```text
AUTOMATIC INSTRUMENTATION
        ↓
Everything gets baseline visibility

MANUAL SPANS
        ↓
Important business workflows get meaning

CUSTOM METRICS
        ↓
Important behavior becomes measurable over time

STRUCTURED LOGS
        ↓
Events and failures gain context

PYROSCOPE
        ↓
Code-level resource usage becomes visible

CORRELATION
        ↓
Metrics → Traces → Logs → Profiles

k6
        ↓
The complete system is tested under load

ALERTING / ONCALL
        ↓
The right person knows when action is required
```

> **The target is not maximum telemetry. The target is minimum time-to-understand when something goes wrong.**
