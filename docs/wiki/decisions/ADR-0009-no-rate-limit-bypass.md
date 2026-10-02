---
title: "ADR-0009 No Rate Limit Bypass"
type: adr
status: accepted
authority: normative-history
owners: ["subsystems/nginx-edge.md"]
sources: ["nginx/nginx.conf", "packages/auth/src/server/auth.ts", "packages/roles/src/index.ts", "apps/api/src/health/health.controller.ts"]
depends_on: ["invariants/06-rate-limits.md", "invariants/07-health.md", "flows/rate-limited.md", "subsystems/nginx-edge.md"]
guards: ["apps/api/test/integration/modules/rate-limit-thresholds.integration.spec.ts", "apps/web/e2e/tests/ratelimit/rate-limit.spec.ts"]
updated: 2026-10-01
expires: null
superseded-by: null
template: true
---
# ADR-0009 No Rate Limit Bypass
> Up: ../00-INDEX.md | Status: accepted | Routes T5.
## Status
- Fact: Accepted. No bypass header, no SkipThrottle, no zone removal for tests. See nginx/nginx.conf no-bypass comment plus health throttled 210-hit.
## Context / Problem
- Fact: Empty-key requests would be unlimited per nginx docs if bypass existed. Health plus k6 plus admin paths tempt exemptions that become attacker paths.
- Interpretation: Every exemption is a flood path; tuning rates preserves signal while bypass destroys it.
- Fact: SCOPES allowlist plus IsIn gates server actions with exact strings. See packages/roles/src/index.ts plus auth.ts 430-478 customRules.
## Decision
- Fact: Keep three layers nginx plus BetterAuth plus Nest with env-tuned rates plus 429-expected k6 methodology. Health stays throttled proving edge exemption shape.
- Recommendation: New limits MUST tune zone plus customRule plus throttler plus SCOPES together, MUST NOT add X-Bypass header or SkipThrottle or test-only zone removal.
- Fact: k6 asserts 429 fires with 5xx zero, proving shield without legit block. See k6 suites plus thresholds.
## Rejected alternatives
- X-Bypass header for internal or k6: simplifies load tests but any leaked header value becomes public flood bypass. Rejected for header leak bypass.
- SkipThrottle on health for cleaner uptime: removes 210-to-429 throttle noise but hides the throttled-by-design proof. Rejected for signal loss plus hidden exemption.
- Zone removal or raise-to-infinity for k6: makes spikes pass trivially but voids the flood test the suite exists to run. Rejected for test invalidation.
## Consequences
- Fact: Positive flood shield holds on all paths, 429 stays expected not error, tests prove real behavior. Negative k6 plus debug must work within tuned rates, slower than bypassed runs.
- Interpretation: Per-layer 429 shapes stay documented in rate-limit-matrix for client handling.
## Revisit-when
- Recommendation: Revisit only on flood review with 429 data showing legit block; tune rates instead of bypass. Then new ADR with data.
## Related invariants and implementation
- Recommendation: Constrained by INV-006 no bypass plus INV-007 throttled health. Traversed by flows/rate-limited.md. Owned by subsystems/nginx-edge.md plus redis.
- Fact: Refs nginx/nginx.conf zones plus entrypoint.sh plus auth.ts customRules plus redis-throttler.storage.ts plus SCOPES IsIn.
- Uncertainty: Interceptor order between two APP_INTERCEPTORs is unpinned. See .agent/wiki-discovery/FINAL-10-OPEN-QUESTIONS.md Q3. Both non-mutating today, pin order if mutation added.
- Uncertainty: Host-rewrite plus CIDR versus hop agreement breaks if LB added. See .agent/wiki-discovery/FINAL-10-OPEN-QUESTIONS.md Q13. No topology change without ADR.
## Verification
- Fact: Verify with rate-limit-thresholds plus e2e ratelimit plus k6 smoke plus spike plus grep no Bypass plus no SkipThrottle on health before merge.
