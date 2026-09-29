# Local Scaffolder (`pnpm scaffold`)

Turn this template into a new independent project with its own npm scope.

```bash
pnpm scaffold                                   # interactive
pnpm scaffold --project-name my-app --yes       # non-interactive
pnpm scaffold --project-name "My Awesome App" --yes
pnpm scaffold --project-name my-app --scope @my-company --yes
pnpm scaffold --project-name my-app --skip-install --no-git
pnpm scaffold --project-name my-app --dry-run
```

## Concepts (kept separate)

- **Project name** — filesystem directory + root `package.json:name`.
  `My Awesome App` → normalized `my-awesome-app` → root `{ "name": "my-awesome-app" }`.
- **Package scope** — internal workspaces `@my-awesome-app/*`.
  Unscoped workspaces `web` / `api` stay unscoped (their `--filter` / `turbo prune`
  selectors depend on it).

Normalization: lowercase, spaces/underscores → `-`, strip URL-unsafe chars,
collapse repeats. `MyApp` → `myapp`, `my_app` → `my-app`, `my.app` kept with a
warning. `--scope` accepts `my-company` or `@my-company`; `@org/pkg` is rejected
with guidance (ambiguous scope vs package path).

## What the scaffolder does

1. Validates name/scope/destination (`path.resolve()`; rejects template-root,
   inside-template, filesystem roots, non-empty dirs without `--allow-existing`).
2. Copies the template with a denylist (no `.git`, `node_modules`, `.next`,
   `dist`, `build`, `out`, `coverage`, `.turbo`, `*.tsbuildinfo`, live `.env*`
   (keeps `*.example`), Playwright `.auth/`, reports, logs, live
   `nginx/certs/localhost.*`, committed `packages/coverage/` artifacts).
   Symlinks are refused, modes preserved, no shell commands.
3. Transforms **semantically**:
   - `package.json` via JSON (renames `name` + dep keys, preserves
     `workspace:*` vs `workspace:^` verbatim).
   - Text files via controlled `@repo/` → `@<scope>/` (plus escaped `@repo\/`
     for JS regex literals) only in allowlisted text files — never in
     `.agents/`, lockfiles, or binaries.
4. Transplants the lockfile: the template's `pnpm-lock.yaml` is copied with ONLY
   importer keys renamed (`'@repo/x':` → `'@scope/x':`; 40 keys — `link:`
   paths, snapshots, hashes untouched), then `pnpm install --frozen-lockfile`
   verifies it and installs the template's exact tree (plus the isolated
   `apps/migrate` workspace, whose lockfile is scope-free and copied verbatim).
   Delete+regenerate was rejected on evidence: fresh resolves float transitive
   deps past the tested tree (observed zod 4.4.3→4.6.5 breaking the api build
   with 6 BetterAuth type errors; jest 30.4.2→30.5.2 pulling `@parcel/watcher`
   which trips `ERR_PNPM_IGNORED_BUILDS`). No resolved version or hash is ever
   hand-edited — pnpm itself verifies the transplanted lockfile.
5. `git init -b main` fresh (no history, no remote) unless `--no-git`.
6. Validates: stale-namespace scan, `pnpm ls -r`, turbo graph dry-run, the
   project's own `typecheck`/`lint`/`guard:web-auth-imports`/`test`/`build`,
   git independence. Failures keep the output for inspection (never auto-delete).

Provenance: generated projects get `.template.json`
(`template`, `templateVersion`, `generatedAt`, `projectName`, `packageScope` —
no paths, no secrets).

## Deliberate policy decisions

- **OpenTelemetry stable**: `getMeter('@repo/observability')` /
  `getTracer('@repo/observability')` are telemetry identities, not module
  resolution. They are preserved (allowlisted) so dashboards don't fork.
- **k6 cosmetic rename**: `k6/package.json` (`@repo/k6-load-testing`) is NOT a
  workspace member (no lockfile importer). It is renamed to
  `@<scope>/k6-load-testing` for consistency; k6 behavior unchanged.
- **apps/migrate isolation preserved**: its `@repo/migrate` → `@<scope>/migrate`
  identity is renamed, its own `pnpm-workspace.yaml` untouched, its own
  lockfile regenerated inside `apps/migrate/`. It never becomes a root importer.
- **`.agents/skills/` vendored**: illustrative upstream content, never transformed.
- **No committed tokens**: the source keeps live `@repo/*` so
  `pnpm install --frozen-lockfile` works on the template itself. Identity is
  derived at scaffold time; future `__PROJECT_NAME__`-style tokens (description,
  license, org) can be added without breaking template installability.

## Lockfile policy

- Template keeps its committed `pnpm-lock.yaml` for reproducible dev/CI.
- Generated projects get a transplanted lockfile (keys renamed, resolutions
  identical) installed with `--frozen-lockfile`, reproducing the template's
  tested tree bit-for-bit apart from the scope rename. Run `pnpm update`
  deliberately afterwards if newer deps are wanted.

## Flags

`--project-name`, `--scope`, `--destination` (default `../<name>`), `--yes`,
`--skip-install`, `--no-git`, `--allow-existing`, `--dry-run`,
`--skip-validation`, `--skip-build`, `--verbose`.

## Tests

`node --test scripts/scaffold/tests/` — normalization, scope parsing,
destination guards, dry-run (no changes), existing-dir refusal, `--no-git`,
secret exclusion, namespace completeness (OTel allowlist only), package-graph
(no dangling deps). Full install/build validation runs against a real
generated project during development (see implementation report).
