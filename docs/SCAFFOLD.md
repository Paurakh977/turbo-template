# Scaffolder & npm distribution

This template ships itself as an npm package. One command produces a new,
independent project with its own npm scope, its own Docker Compose project
name, its own database credentials, and the full `docs/wiki/` knowledge base
intact.

```bash
# From the npm registry (recommended for users)
npx create-turbo-template-app my-app
npm create turbo-template-app my-app

# From a local checkout (maintainer workflow)
pnpm scaffold --project-name my-app --yes
```

Both entry points run the same code — `scripts/scaffold.mjs`, wired as the
package `bin`. GitHub is never involved: the payload lives inside the npm
tarball, so `npx` needs nothing but the registry.

---

## Concepts (kept separate)

- **Project name** — filesystem directory + root `package.json:name`.
  `My Awesome App` → normalized `my-awesome-app` → root `{ "name": "my-awesome-app" }`.
- **Package scope** — internal workspaces `@my-company/*`.
  Unscoped workspaces `web` / `api` stay unscoped (their `--filter` / `turbo prune`
  selectors depend on it).
- **Env slug** — Postgres-safe identity derived from the project name
  (`my-awesome-app` → `my_awesome_app`), used for `POSTGRES_USER` / `POSTGRES_DB`.
- **Display name** — human form (`my-awesome-app` → `My Awesome App`), used for
  `APP_NAME` and the Resend `EMAIL_FROM` display name.

Normalization: lowercase, spaces/underscores → `-`, strip URL-unsafe chars,
collapse repeats. `MyApp` → `myapp`, `my_app` → `my-app`, `my.app` kept with a
warning. `--scope` accepts `my-company` or `@my-company`; `@org/pkg` is rejected
with guidance (ambiguous scope vs package path).

## What the scaffolder does

1. Validates name/scope/destination (`path.resolve()`; rejects template-root,
   inside-template, inside-`node_modules`, filesystem roots, non-empty dirs
   without `--allow-existing`).
2. Copies the template with a denylist. See "What never ships" below.
   Symlinks are refused, modes preserved, no shell commands.
3. **Restores filenames npm mangles** (`.gitignore`, `pnpm-lock.yaml`).
4. Transforms **semantically**:
   - `package.json` via JSON (renames `name` + dep keys, preserves
     `workspace:*` vs `workspace:^` verbatim, strips publish-only fields).
   - `*.env.example` via a key-aware identity pass (`POSTGRES_*`,
     `DATABASE_URL`, `DIRECT_URL`, `APP_NAME`, `EMAIL_FROM`). Never touches
     `BETTER_AUTH_SECRET`, OAuth ids, or API keys.
   - Text files via controlled `@repo/` → `@<scope>/` (plus escaped `@repo\/`
     for JS regex literals) only in allowlisted text files — never in
     `.agents/`, lockfiles, or binaries.
5. Transplants the lockfile (see "Lockfile policy").
6. `git init -b main` fresh (no history, no remote) unless `--no-git`.
7. Validates (see "Validation").

Provenance: generated projects get `.template.json`
(`template`, `templateVersion`, `generatedAt`, `projectName`, `packageScope` —
no paths, no secrets). `templateVersion` is read from the package version, so
there is nothing to bump by hand.

---

## npm hostile filenames (why the aliases exist)

npm's packlist has a hardcoded always-ignored list. Two files this template
cannot afford to lose are on it. **Verified experimentally on npm 10.9.3 /
Node 22**, by packing and then installing a probe package:

| File | npm behavior | Consequence if unhandled |
|---|---|---|
| `.gitignore` (nested) | dropped from the tarball | generated repo has no ignore rules in `apps/*` |
| `.gitignore` (root) | survives packing, **renamed to `.npmignore` on install** (npm/cli#5756) | generated repo has no ignore rules at all |
| `pnpm-lock.yaml` (root) | **always stripped** — no `files` entry overrides it | `--frozen-lockfile` breaks in 3 Dockerfiles; the transplant below cannot run |
| `.npmrc` | never included | n/a (not used by the template) |
| `apps/migrate/pnpm-lock.yaml` | ships normally | — |

Losing `.gitignore` is a **security** problem, not a cosmetic one: step 6 runs
`git add -A`, so an ignore-less project commits `node_modules/` and a live
`.env` full of real credentials.

Two further traps, both confirmed by probe:

- A recursive glob in `files` (e.g. every file under the root) **overrides
  `.gitignore` entirely** and publishes a live `.env`.
- Adding negations to `files` makes packlist fall back to ignore semantics,
  which drops the root lockfile.

### The workaround

Files travel under a name npm tolerates and are renamed on the way out — the
same approach create-react-app and tacks use.

```
prepack    scripts/stage-template.mjs     copies  .gitignore -> gitignore
                                            copies  pnpm-lock.yaml -> pnpm-lock.template.yaml
                                            (nested .gitignore files likewise)
postpack   scripts/stage-template.mjs --clean   removes the copies

scaffold   scripts/scaffold/restore.mjs renames them back, then strips the
                                          publish-staging block from the
                                          restored ignore rules
```

Staging **copies** rather than moves: an interrupted publish then leaves extra
files behind (harmless) instead of a missing `pnpm-lock.yaml` here (fatal).
Live `.env` files are never read, moved, or modified by any of this.

`scripts/scaffold/restore.mjs` is idempotent and does nothing when the template
came from a git checkout (the dotted files are already real). `pnpm scaffold`
and `npx` therefore produce byte-identical output apart from identity.

## The publish gate

Configuration cannot express "publish everything except these paths"
reliably, so the tarball itself is audited.

```bash
pnpm guard:publish-contents      # stage, then inspect the real tarball
```

`scripts/check-publish-contents.mjs` runs `npm pack --dry-run --json
--ignore-scripts` and **fails closed** on:

- any live `.env*` (only `*.example` may ship), `.npmrc`, `.netrc`
- any `*.pem .key .crt .cer .p12 .pfx .jks .keystore`
- `.agent/`, `node_modules/`, `.turbo/`, `k6/results/`,
  `packages/database/src/generated/`, `packages/coverage/`, `.vscode/`, `.idea/`
- machine-specific path fragments (`/Users/`, `C:\Users\`, `D:\template\`)
- any **missing** required path — including the staged aliases and the wiki
  entry points, so a broken tarball can never be published

It runs from `prepack` and from CI (`publish-contents` job), so a bad publish
aborts rather than shipping.

## What never ships

| Category | Mechanism |
|---|---|
| `.env`, `.env.k6`, `.env.e2e`, `.env.test` | `files` allowlist + `!**/.env*` + gate |
| `nginx/certs/localhost.{key,crt}` | explicit `nginx/certs/*` listing in `files` + cert-suffix gate |
| `.agent/` (local agent cache, ~1.3 MB of absolute paths) | `!.agent/` in `files` + `EXCLUDE_DIR_NAMES` |
| `.vscode/`, `.idea/`, `.settings/`, `logs/` | `EXCLUDE_DIR_NAMES` + gate |
| `packages/database/src/generated/` (stale Prisma client) | `files` negation + `EXCLUDE_PATH_PREFIXES` |
| `k6/results/`, `packages/coverage/` | `files` negation + `EXCLUDE_PATH_PREFIXES` |
| `.git/`, `node_modules/`, `.turbo/`, `dist/`, `coverage/` | `EXCLUDE_DIR_NAMES` at any depth |
| `*.log`, `*.tsbuildinfo`, `.DS_Store`, `Thumbs.db` | suffix rules |
| Playwright `.auth/`, reports | path rules |
| `.git/` history and remotes | never copied; the generated repo is `git init`-ed fresh |

Note `.agent/` (singular, local cache) is excluded while `.agents/` (plural,
the vendored skill set referenced by `AGENTS.md`) **is** shipped.

## Validation

Runs in the generated project, in order, aborting on first failure:

| # | Check | Needs install |
|---|---|---|
| 0 | `structure` — ignore rules present and covering `.env`/`node_modules`; no forbidden files; no publish-only manifest fields; lockfile present; wiki present | no |
| 1 | `no-stale-namespace` — zero unintended `@repo/` (OTel allowlist only) | no |
| 2 | `package-graph` — `pnpm ls -r` + no dangling `workspace:` deps | yes |
| 3 | `turbo-graph` — `turbo run build --dry` | yes |
| 4 | `db:generate` — the Prisma client is gitignored; builds depend on it | yes |
| 5 | `typecheck` | yes |
| 6 | `lint` | yes |
| 7 | `guard:web-auth-imports` | yes |
| 8 | `test` | yes |
| 9 | `build` | yes |
| 10 | `guard:web-secrets --strict` — Architecture B: no DB secrets in the web bundle | yes |
| 11 | `git-independence` — fresh repo, no remote | no |

Every script step is discovered from the generated project's own `package.json`,
never invented, so a renamed or removed script silently skips instead of failing.

`--skip-install` no longer skips validation: checks 0, 1 and 11 run anyway,
because they need neither `node_modules` nor a package manager. Previously
`--skip-install` disabled validation entirely, which let a packaging regression
(missing `.gitignore`, leaked `.env`, stale `@repo/`) pass unnoticed.

## Deliberate policy decisions

- **Root manifest is dual-purpose.** It is both the published package manifest
  and the template for the generated project's root. Publish-only fields
  (`bin`, `files`, `keywords`, `publishConfig`, `repository`, `homepage`, …)
  are stripped from the output and `private: true` is restored, so a business
  app never inherits a `bin` pointing at the scaffolder or a `files` allowlist
  hiding its own source. The root `name` is replaced unconditionally — as the
  workspace root it can never be an internal dependency.
- **OpenTelemetry stable**: `getMeter('@repo/observability')` /
  `getTracer('@repo/observability')` are telemetry identities, not module
  resolution. They are preserved (allowlisted) so dashboards don't fork.
- **k6 cosmetic rename**: `k6/package.json` (`@repo/k6-load-testing`) is NOT a
  workspace member (no lockfile importer). It is renamed to
  `@<scope>/k6-load-testing` for consistency; k6 behavior unchanged.
- **apps/migrate isolation preserved**: its `@repo/migrate` → `@<scope>/migrate`
  identity is renamed, its own `pnpm-workspace.yaml` untouched, and its own
  lockfile is **copied verbatim** (it contains no scope refs — its single
  importer is keyed by filesystem path). It never becomes a root importer.
- **`.agents/skills/` vendored**: illustrative upstream content, never transformed.
- **No committed tokens**: the source keeps live `@repo/*` so
  `pnpm install --frozen-lockfile` works on the template itself. Identity is
  derived at scaffold time.
- **Compose project name** is pinned via `name: ${COMPOSE_PROJECT_NAME:-turbo-template}`
  in `docker-compose.yml`. Without it Docker derives the name from the checkout
  directory, so every documented `docker wait <project>-api-test-1` command
  would only work in a folder literally named `turbo-template`. Users override
  with the standard `COMPOSE_PROJECT_NAME` env var.
- **Visual baselines are per-platform.** Playwright appends the platform to
  snapshot filenames; only the `-win32` set is committed. Rather than failing
  "A snapshot doesn't exist" for every non-Windows user, the helper skips with
  an explicit message and prints the command to generate one. Where a baseline
  does exist, the assertion runs normally.

## Lockfile policy

- Template keeps its committed `pnpm-lock.yaml` for reproducible dev/CI, and
  publishes it as `pnpm-lock.template.yaml` (see above).
- Generated projects get a transplanted lockfile: importer keys renamed
  (`'@repo/x':` → `'@scope/x':`, 40 keys), resolutions byte-identical, then
  verified by `pnpm install --frozen-lockfile`.
- Delete+regenerate was rejected on evidence: fresh resolves float transitive
  deps past the tested tree (observed zod 4.4.3→4.6.5 breaking the api build
  with 6 BetterAuth type errors; jest 30.4.2→30.5.2 pulling `@parcel/watcher`
  which trips `ERR_PNPM_IGNORED_BUILDS`). No resolved version or hash is ever
  hand-edited — pnpm itself verifies the transplanted lockfile.
- Run `pnpm update` deliberately afterwards if newer deps are wanted.

## Flags

`--project-name`, `--scope`, `--destination`, `--yes`, `--skip-install`,
`--no-git`, `--allow-existing`, `--dry-run`, `--skip-validation`,
`--skip-build`, `--verbose`.

Destination default differs by entry point: `./<name>` when installed as a
package (npx semantics — create-react-app/create-next-app behave the same),
`../<name>` when run from a checkout.

## Tests

```bash
pnpm scaffold:test
```

Covers name/scope normalization, destination guards (including the
`node_modules` case), the copy exclusion policy, the env identity transform
(LF **and** CRLF), undotted-alias restore + idempotency + no-clobber, the
publish-only manifest strip, ignore-rule coverage, wiki presence, dry-run
(no changes), existing-dir refusal, `--no-git`, lockfile transplant
(line-by-line diff proving only importer keys changed), and the full
copy → restore → transform pipeline asserting the generated project is
safe to `git add -A` and frozen-installable.