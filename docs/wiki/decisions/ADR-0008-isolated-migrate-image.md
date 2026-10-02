---
title: "ADR-0008 Isolated Migrate Image"
type: adr
status: accepted
authority: normative-history
owners: ["subsystems/database-prisma.md"]
sources: ["apps/migrate/Dockerfile", "packages/database/prisma.config.ts", "docker-compose.yml", "packages/database/src/client.ts"]
depends_on: ["invariants/04-database-connections.md", "flows/migration.md", "subsystems/database-prisma.md"]
guards: ["packages/database/test/integration/prisma.integration.spec.ts", "packages/database/test/integration/prisma.integration.spec.ts"]
updated: 2026-10-01
expires: null
superseded-by: null
template: true
---
# ADR-0008 Isolated Migrate Image
> Up: ../00-INDEX.md | Status: accepted | Routes T3.
## Status
- Fact: Accepted. Migrate runs in its own trimmed image over DIRECT_URL bypassing pooler. See apps/migrate/Dockerfile plus packages/database/prisma.config.ts.
## Context / Problem
- Fact: Runtime uses pooler 6432 via PgBouncer; migrate needs direct 5432 for DDL plus advisory locks that pooler transaction mode breaks.
- Interpretation: Coupling migrate to app or web image drags web deps into a DB-owner job and stalls deploys on pooler semantics.
- Fact: Trim saves near 150MB plus boot gate fails fast on DIRECT_URL absence. See compose migrate env plus client.ts parsePositiveInt.
## Decision
- Fact: Keep apps/migrate workspace with own Dockerfile plus trim plus boot gate plus prisma.config DIRECT_URL snapshot. Compose migrate services pass DIRECT_URL 5432, never pooler 6432.
- Recommendation: New models MUST add fragment then migrate dev over DIRECT_URL then generate, never pooler migrate, never edit applied SQL.
- Fact: Fragment casing stays lowercase singular like note.prisma; migrations stay timestamped SQL append-only.
## Rejected alternatives
- Pooler migrate over 6432: reuses runtime URL but DDL plus advisory locks fail or stall under transaction pooling. Rejected for lock failure.
- Full image with web deps for migrate: simplifies Dockerfiles but ships web toolchain into a privileged DB job and couples deploy to web churn. Rejected for coupling plus weight.
- Migrate inside api image at boot: removes one image but races replicas plus mixes liveness with schema ownership. Rejected for race plus ownership blur.
## Consequences
- Fact: Positive deploys get deterministic DDL plus fail-fast misconfig plus small image. Negative one more Dockerfile plus fragment-to-SQL discipline to maintain.
- Interpretation: Pool math in INV-004 stays runtime-only; migrate never counts against MAX_CLIENT.
## Revisit-when
- Recommendation: Revisit only if migrate ever needs app code with proof, default deny, or on Prisma CLI bump requiring trim re-validation. Then new ADR.
## Related invariants and implementation
- Recommendation: Constrained by INV-004 pooler versus direct plus two-budget math. Traversed by flows/migration.md. Owned by subsystems/database-prisma.md plus database-package.
- Fact: Refs apps/migrate/Dockerfile plus prisma.config.ts 36-42 plus pgbouncer.ini plus docker-compose.yml DIRECT_URL plus migration.sql.
- Uncertainty: Exact trim byte saving varies by base layer plus arch; 150MB is build-time measure not guarantee. Do not enshrine as invariant.
- Uncertainty: Non-auth large-body limit with bodyParser false may affect seed plus migrate helpers. See .agent/wiki-discovery/FINAL-10-OPEN-QUESTIONS.md Q2. Inspect vendor mount before raising limits.
## Verification
- Fact: Verify with prisma integration plus migrate-test plus DIRECT_URL fail-fast plus pool gauges before merge.
