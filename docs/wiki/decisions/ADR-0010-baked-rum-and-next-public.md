---
title: "ADR-0010 Baked RUM and NEXT_PUBLIC"
type: adr
status: accepted
authority: normative-history
owners: ["subsystems/web-runtime.md"]
sources: ["apps/web/next.config.js", "apps/web/src/instrumentation-client.ts", "apps/web/Dockerfile.prod", "apps/web/src/proxy.ts"]
depends_on: ["invariants/08-observability.md", "invariants/09-env.md", "flows/observability.md", "subsystems/env-config.md"]
guards: ["scripts/check-web-secrets.mjs", "apps/web/src/lib/server/bootstrap.spec.ts"]
updated: 2026-10-01
expires: null
superseded-by: null
template: true
---
# ADR-0010 Baked RUM and NEXT_PUBLIC
> Up: ../00-INDEX.md | Status: accepted | Routes T6 T7.
## Status
- Fact: Accepted. NEXT_PUBLIC plus Faro RUM are baked at build via ARGs, not runtime injected. See apps/web/next.config.js plus instrumentation-client.ts plus Dockerfile.prod.
## Context / Problem
- Fact: Next inlines NEXT_PUBLIC at build; runtime injection would need custom server patching plus beacon rewrite that breaks CSP plus caching.
- Interpretation: Baked keeps bootstrap plus fingerprint plus gateway behavior deterministic per profile build.
- Fact: Server OTel in next.config validation would couple build validation to collector availability. See apps/web/src/proxy.ts CSP single owner.
## Decision
- Fact: Keep Dockerfile.prod ARGs for NEXT_PUBLIC plus Faro collector plus baked instrumentation-client. Rebuild per env change, verify with web rebuild test.
- Recommendation: New public vars MUST add ARG plus .env.example plus Joi or parser plus turbo passThrough plus rebuild check, never runtime window injection.
- Fact: RUM collector stays baked Faro path via nginx collect to Loki; server spans stay Alloy pipeline. See observability alloy config.
## Rejected alternatives
- Runtime RUM injection via window config: avoids rebuild but needs inline script plus CSP widening plus cache bypass per env. Rejected for CSP plus cache cost.
- Server OTel validation in next.config: fails builds when collector blips and mixes build with telemetry. Rejected for build coupling.
- Runtime-config without rebuild via mounted env.js: gains deploy flexibility but reintroduces secret-shaped file into web plus version skew. Rejected for Arch-B drift.
## Consequences
- Fact: Positive builds are hermetic per profile, RUM beacons align with CSP, dashboards see stable labels. Negative env change requires rebuild plus redeploy, slower than runtime flip.
- Interpretation: Baked versus runtime split stays in INV-009; parsers fail fast on missing baked values.
## Revisit-when
- Recommendation: Revisit only on runtime-config Next migration with proof of secret-free plus CSP-safe plus cache-safe design. Then new ADR.
## Related invariants and implementation
- Recommendation: Constrained by INV-008 triple-sync plus baked RUM plus INV-009 baked versus runtime. Traversed by flows/observability.md. Owned by subsystems/web-runtime.md plus env-config.
- Fact: Refs next.config.js plus instrumentation-client.ts plus Dockerfile.prod ARGs plus proxy.ts CSP plus turbo.json passThrough.
- Uncertainty: OTel exporter versus Alloy compat plus Tempo retention plus Pyroscope arm64 unverified. See .agent/wiki-discovery/FINAL-10-OPEN-QUESTIONS.md Q11. Pin alloy sha plus document retention before prod trust.
- Uncertainty: Env single-source plus Number-empty zeroes budgets if parser missed. See INV-009 plus .agent/wiki-discovery/FINAL-10-OPEN-QUESTIONS.md general. Fail-fast parsers required.
## Verification
- Fact: Verify with check-web-secrets-strict plus compose lint plus e2e boot plus rebuild NEXT_PUBLIC test plus Grafana 01-06 render before merge.
