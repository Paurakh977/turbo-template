# syntax=docker/dockerfile:1.7

# ─────────────────────────────────────────────────────────────────────────────
# Standalone Prisma migration runner (Prisma 7).
#
# `prisma migrate deploy` only applies prisma/migrations/*.sql and records them
# in _prisma_migrations — it never loads Prisma Studio, `prisma dev`, or the
# MySQL driver, even though the official CLI package depends on all of them.
# The `trimmed` stage deletes those trees (~150 MB) after install; the smoke
# test in CI / the compose prod profile guards this against upstream changes.
#
# Kept intentionally: postgres (postgres.js — v7 CLI uses it to connect),
# effect (@prisma/config dependency), @prisma/engines.
# ─────────────────────────────────────────────────────────────────────────────

FROM node:22-alpine AS deps
WORKDIR /app
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
COPY apps/migrate/package.json apps/migrate/pnpm-lock.yaml ./
RUN --mount=type=cache,id=migrate-pnpm-store,target=/pnpm/store \
  pnpm install --prod --frozen-lockfile --store-dir /pnpm/store

FROM deps AS trimmed
# Virtual-store copies + their top-level symlinks; dangling links are harmless
# but removed for cleanliness. Glob names must match pnpm's `.pnpm` layout.
#
# NOTE: prisma's CLI eagerly requires these at startup — do not remove:
#   - @prisma/studio-core ('@prisma/studio-core/data/bff')
#   - @prisma/dev + its deps ('@prisma/dev/internal/state', remeda)
# The boot gate below makes the build FAIL if a future CLI minor changes
# what is eagerly loaded, instead of shipping a silently broken image.
# Re-validate the prune list after every CLI version bump.
RUN rm -rf \
  node_modules/.pnpm/react@* node_modules/react \
  node_modules/.pnpm/react-dom@* node_modules/react-dom \
  node_modules/.pnpm/scheduler@* node_modules/scheduler \
  node_modules/.pnpm/@radix-ui+* node_modules/@radix-ui \
  node_modules/.pnpm/@types+react* node_modules/@types/react \
  node_modules/.pnpm/csstype* \
  node_modules/.pnpm/classnames@* \
  node_modules/.pnpm/lodash@* node_modules/lodash \
  node_modules/.pnpm/@types+lodash* \
  node_modules/.pnpm/@visx+* node_modules/@visx \
  node_modules/.pnpm/d3-* \
  node_modules/.pnpm/delaunator* \
  node_modules/.pnpm/robust-predicates* \
  node_modules/.pnpm/internmap* \
  node_modules/.pnpm/elkjs* \
  node_modules/.pnpm/@electric-sql+pglite* node_modules/@electric-sql \
  node_modules/.pnpm/@prisma+query-plan-executor* \
  node_modules/.pnpm/@prisma+streams-local* \
  node_modules/.pnpm/mysql2*

# Boot gate: loads cli.js (and everything it eagerly requires). Fails the
# build if the prune above removed something the CLI needs to even start.
RUN ./node_modules/.bin/prisma version > /dev/null

FROM node:22-alpine AS migrator
WORKDIR /app
COPY --from=trimmed /app/node_modules ./node_modules
COPY packages/database/prisma.config.ts ./prisma.config.ts
COPY packages/database/prisma ./prisma
ENV CHECKPOINT_DISABLE=1
ENV PRISMA_HIDE_UPDATE_MESSAGE=1
USER node
CMD ["./node_modules/.bin/prisma", "migrate", "deploy"]
