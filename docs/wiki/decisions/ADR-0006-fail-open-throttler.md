---
title: "ADR-0006 Fail-Open Throttler"
type: adr
status: accepted
authority: normative-history
owners: ["subsystems/redis.md"]
sources: ["apps/api/src/rate-limit/redis-throttler.storage.ts", "apps/api/src/app.module.ts", "packages/roles/src/index.ts"]
depends_on: ["invariants/06-rate-limits.md", "flows/rate-limited.md", "subsystems/redis.md"]
guards: ["apps/api/test/integration/modules/rate-limit-thresholds.integration.spec.ts", "apps/api/src/rate-limit/redis-throttler.storage.spec.ts"]
updated: 2026-10-01
expires: null
superseded-by: null
template: true
---
# ADR-0006 Fail-Open Throttler
> Up: ../00-INDEX.md | Status: accepted | Routes T5.
## Status
- Fact: Accepted. Nest throttler fails open to bounded in-memory fallback on Redis blip. See apps/api/src/rate-limit/redis-throttler.storage.ts 29-127.
## Context / Problem
- Fact: Guard has no try-catch that would 500-all on Redis blip. Strict fail-closed turns a cache outage into a full API outage for legit users.
- Interpretation: Availability outweighs strictness for throttle state; flood shield degrades but service stays up.
- Fact: Memory fallback is bounded at 5000 entries to avoid leak. See redis-throttler.storage.ts bound plus apps/api/src/app.module.ts 40-51 throttler wiring.
## Decision
- Fact: Keep Redis primary plus in-memory fallback capped at 5000 plus SCOPES Lua for server actions. Fail-open applies to throttle checks, never to auth verdicts.
- Recommendation: New throttle scopes MUST add SCOPES entry first plus Lua service plus throttler wiring, never rely on memory fallback as primary.
- Fact: Server-action paths keep separate allowlisted scopes with exact strings. See packages/roles/src/index.ts 152-162.
## Rejected alternatives
- Fail-closed 500 on Redis error: preserves strict rate accuracy during outage but 500s all traffic on a non-critical dep blip. Rejected for outage amplification.
- Unbounded in-memory fallback: absorbs longer outages but leaks workers under sustained flood. Rejected for memory exhaustion.
- In-process only with no Redis: removes Redis dep but splits limits per worker and per replica with no shared view. Rejected for multi-worker incoherence.
## Consequences
- Fact: Positive Redis blip degrades to approximate limits instead of outage. Negative permissive window during outage lets some excess through until Redis recovers.
- Interpretation: 429 stays expected signal; 5xx stays zero even during Redis blip per k6 spike gate.
## Revisit-when
- Recommendation: Revisit on prolonged Redis outage data showing permissive window abuse. Add alert plus tighten window then, via new ADR.
## Related invariants and implementation
- Recommendation: Constrained by INV-006 three layers plus no bypass. Traversed by flows/rate-limited.md. Owned by subsystems/redis.md plus subsystems/api-runtime.md.
- Fact: Refs apps/api/src/rate-limit/redis-throttler.storage.ts plus app.module.ts throttler plus SCOPES plus server-action-rate-limit service.
- Uncertainty: Prolonged outage permissive duration unmeasured; no sustained-outage load data in repo. Do not assert safe window length.
- Uncertainty: Rate-bucket identity plus REDIS_PREFIX scope interaction not fully pinned. Cite pending-storage plus SCOPES, assert nothing beyond code.
## Verification
- Fact: Verify with rate-limit-thresholds plus e2e ratelimit plus k6 smoke plus spike showing 429 fires with 5xx zero before merge.
