# AGENTS.md — Template Turbo operating contract

> Thin global contract. Canonical knowledge lives in `docs/wiki/`. Code wins over wiki.

- Template Arch-B: web holds no DB/secret/auth runtime — see `docs/wiki/00-INDEX.md`.
- Invariants (read before dangerous edits): Arch-B · fresh-role (never session snapshot) · ALS per-request + `@Session()` once · pooler (`DATABASE_URL`) vs direct (`DIRECT_URL`) + pool math · audit sync-vs-outbox + drain 20s < grace 30s · 3-layer limits, no bypass, 429 expected · live (no deps) vs ready (Redis+PG) · normalizer triple + per-worker instance.id · single-source env, fail-fast, baked vs runtime · presentational vs enforced UI.
- First read: `AGENTS.md` (30s) → `docs/wiki/00-INDEX.md` (task route) → 2–4 bound invariants → Required flows/subsystems/workflows → code at cited paths.
- Guards: `pnpm guard:web-secrets`, `pnpm guard:web-auth-imports`, `pnpm lint`, `pnpm typecheck`; tests per `docs/wiki/reference/test-matrix.md`.
- Research (`docs/wiki/research/`) expires — never treat benchmarks as architecture.
- Doc updates follow `docs/wiki/_meta/maintenance.md` (code→invariant→flow→subsystem→workflow→reference→index).
