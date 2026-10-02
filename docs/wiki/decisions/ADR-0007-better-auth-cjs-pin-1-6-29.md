---
title: "ADR-0007 Better Auth CJS Pin 1.6.29"
type: adr
status: accepted
authority: normative-history
owners: ["subsystems/auth-better-auth.md"]
sources: ["package.json", "pnpm-lock.yaml", "patches/better-auth@1.6.29.patch", "packages/auth/src/server/auth.ts"]
depends_on: ["flows/auth.md", "subsystems/auth-better-auth.md", "subsystems/redis.md"]
guards: ["apps/api/test/integration/modules/auth-flow.integration.spec.ts", "packages/auth/src/server/pending-storage.spec.ts"]
updated: 2026-10-01
expires: null
superseded-by: null
template: true
---
# ADR-0007 Better Auth CJS Pin 1.6.29
> Up: ../00-INDEX.md | Status: accepted | Routes T2.
## Status
- Fact: Accepted. Pin better-auth exactly at 1.6.29 CJS plus pnpm peer-pruning patch. See package.json better-auth 1.6.29 plus patches directory.
## Context / Problem
- Fact: Better Auth 1.7 ships ESM-only, breaking the Jest CJS chain plus server import graph that assumes CJS. Upgrade without loader work breaks auth-flow plus session specs.
- Interpretation: Pin buys determinism; patch prunes peer weight near 450MB that otherwise ships unused.
- Fact: Auth mounts as raw Express bypassing interceptors with bare-token keys. See packages/auth/src/server/auth.ts 174-287 plus pending-storage inventory.
## Decision
- Fact: Keep exact 1.6.29 with pnpm patch plus CJS require path, plus infra redis plus pending-storage plus audit-plugin wiring unchanged.
- Recommendation: New auth changes MUST stay on 1.6.29 API plus CJS imports, MUST NOT bump to 1.7 without ESM loader proof plus full auth matrix green.
- Fact: Peer-prune patch stays version-locked; bump requires patch re-validation plus image weight check.
## Rejected alternatives
- ESM upgrade now to 1.7: gains upstream fixes but needs Jest ESM loader plus import rewrites across auth plus api plus web. Rejected for chain break without loader.
- Dedupe without pin via ranges: saves pin maintenance but floats across CJS-ESM boundary on fresh install. Rejected for non-deterministic boundary cross.
- Vendor fork of auth internals: removes version coupling but forks audit-plugin plus database-hooks maintenance. Rejected for fork cost exceeding pin cost.
## Consequences
- Fact: Positive builds stay deterministic, auth matrix stays green, image avoids peer bloat. Negative security or feature fixes after 1.6.29 need backport review until ESM path lands.
- Interpretation: Auth lifecycle plus 2FA plus impersonation behavior stays on pinned semantics per flows/auth.md.
## Revisit-when
- Recommendation: Revisit when Jest ESM loader lands with green matrix or vendor restores CJS. Then new ADR with migration plus patch removal proof.
## Related invariants and implementation
- Recommendation: Traversed by flows/auth.md. Owned by subsystems/auth-better-auth.md. Limits in INV-006 plus INV-011 customRules stay unchanged.
- Fact: Refs package.json plus pnpm patch plus packages/auth/src/server/auth.ts plus infra/redis.ts plus pending-storage.ts.
- Uncertainty: active-sessions key absence versus expiry filtering unresolved. See .agent/wiki-discovery/FINAL-10-OPEN-QUESTIONS.md Q4. Do not assume Redis-key-absence equals logout.
- Uncertainty: Dummy OAuth path plus OAUTH_TEST_PROVIDER unset in real envs must never run in prod. See .agent/wiki-discovery/FINAL-10-OPEN-QUESTIONS.md Q5. Grep compose plus hosting env first.
- Uncertainty: Better Auth 1.6.29 read-path for expired sessions not re-audited here. See 04 S17. Cite, do not assert beyond specs.
## Verification
- Fact: Verify with auth-flow plus 2fa plus auth-session plus pending plus stop specs plus e2e auth green before any version touch.
