/**
 * Central manifest for the local Turborepo scaffolder.
 *
 * Design intent (see docs/SCAFFOLD.md):
 * - Template source identity is `@repo/*` + root `my-turborepo` and stays
 *   installable. The scaffolder derives generated identity at copy time;
 *   no `__TOKENS__` are committed to the source tree (that would break
 *   `pnpm install --frozen-lockfile` on the template itself).
 * - Transformation is NEVER a blind repo-wide replace. package.json files
 *   are edited semantically (JSON keys); text files get a controlled
 *   `@repo/` -> `@<scope>/` token replacement ONLY in allowlisted text
 *   files, with explicit denylists for vendored/generated/secrets/lockfiles.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const TEMPLATE_SCOPE = '@repo';
export const TEMPLATE_ROOT_NAME = 'my-turborepo';

/**
 * Placeholder identity baked into the committed `*.env.example` files. The
 * scaffolder rewrites these to the generated project's own identity so a new
 * project never ships with `POSTGRES_USER=myapp`.
 */
export const TEMPLATE_ENV_SLUG = 'myapp';
export const TEMPLATE_ENV_DB = 'myapp_db';
export const TEMPLATE_ENV_APP_NAME = 'MyApp';

/**
 * Brand placeholder compiled into user-visible surfaces (page metadata, logo alt
 * text, dashboard brand, TOTP issuer, email subjects). Rewritten to the
 * generated project display name in BRAND_PLACEHOLDER_FILES only.
 */
export const BRAND_TOKEN = 'MyApp';

/**
 * Root-manifest fields that exist ONLY to make the template publishable as an
 * npm package. They are stripped from the generated project's package.json —
 * a business app must not inherit a `bin` that points at the scaffolder, a
 * `files` allowlist that hides its own source, or the template's repository URL.
 */
export const PUBLISH_ONLY_MANIFEST_FIELDS = Object.freeze([
  'bin',
  'files',
  'keywords',
  'publishConfig',
  'repository',
  'bugs',
  'homepage',
  'directories',
  'preferGlobal',
  'os',
  'cpu',
]);

/**
 * Filenames npm refuses to publish under their real names, and which therefore
 * travel through the tarball undotted/renamed (see scripts/stage-template.mjs
 * for the write side and scripts/scaffold/restore.mjs for the read side):
 *
 *   - `.gitignore` is either dropped (nested) or silently RENAMED to
 *     `.npmignore` by pacote on install (npm/cli#5756, reproduced on npm
 *     10.9.x). Losing it would be catastrophic here: the scaffolder runs
 *     `git add -A` immediately after copying, so an ignore-less project would
 *     commit `node_modules/` and a live `.env` full of credentials.
 *
 *   - `pnpm-lock.yaml` is on npm's hardcoded always-ignored list. No `files`
 *     entry can override it — verified: neither a recursive glob nor an
 *     explicit `pnpm-lock.yaml` entry survives packing. The lockfile is
 *     load-bearing (`--frozen-lockfile` in three Dockerfiles, plus the
 *     transplant policy in docs/SCAFFOLD.md), so it ships under a different
 *     basename.
 *
 * `apps/migrate/pnpm-lock.yaml` is NOT in this list: nested lockfiles are not
 * always-ignored and ship under their real name.
 */
/**
 * Markers delimiting the ignore rules that only matter inside the template
 * repository (the staging aliases). Written into `.gitignore` between these
 * markers, and stripped from every copy that ships — see `stripStagingBlock`
 * in scripts/scaffold/restore.mjs and its counterpart in
 * scripts/stage-template.mjs.
 */
export const STRIP_BLOCK_START = '# >>> npm publish staging';
export const STRIP_BLOCK_END = '# <<< npm publish staging';

/**
 * Root-manifest scripts that exist only to publish *this template* as an npm
 * package. They are removed from the generated project.
 *
 * This is not cosmetic: a generated business app that inherits `prepack` will,
 * on its own `npm publish`, run the template's staging step (leaving a stray
 * `gitignore` next to its `.gitignore`) and then fail the template's publish
 * gate, which asserts template-only paths like `pnpm-lock.template.yaml`. The
 * user's publish would break for a reason that has nothing to do with their app.
 */
export const TEMPLATE_ONLY_SCRIPTS = Object.freeze([
  'prepack',
  'postpack',
  'prepare',
  'prepublishOnly',
  'guard:publish-contents',
]);

/**
 * Paths that exist only to publish this template as an npm package. They are
 * never copied into a generated project.
 *
 * `stage-template.mjs` is not merely useless there — it renames the user's own
 * `.gitignore` and `pnpm-lock.yaml` to npm aliases, which would corrupt their
 * repo the moment they ran it.
 */
export const TEMPLATE_ONLY_PATHS = Object.freeze([
  'scripts/stage-template.mjs',
  'scripts/check-publish-contents.mjs',
]);

/**
 * Paths removed from a generated project BY DEFAULT: the generator itself and
 * the document describing how to publish the template. `--keep-scaffolder`
 * retains them, for when the generated project is itself meant to become a
 * template. A business app does not want 12 files of generator code plus a
 * 400-line guide to releasing someone else's package.
 */
export const SCAFFOLDER_PATHS = Object.freeze([
  'scripts/scaffold.mjs',
  'scripts/scaffold',
  'docs/SCAFFOLD.md',
]);

/** Scripts removed alongside SCAFFOLDER_PATHS unless --keep-scaffolder. */
export const SCAFFOLDER_SCRIPTS = Object.freeze(['scaffold', 'scaffold:test']);

/**
 * Files carrying the `MyApp` brand placeholder, which the scaffolder rewrites
 * to the generated project's display name.
 *
 * SCOPED, not global. `MyApp` also appears in the scaffolder's own docs and
 * tests (where it illustrates name normalization) and in `*.env.example` (which
 * the key-aware env pass handles). A repo-wide replace would corrupt all three.
 * An explicit allowlist keeps the policy auditable — same philosophy as
 * NEVER_TRANSFORM_PREFIXES and NAMESPACE_ALLOWLIST.
 *
 * Covers user-visible branding: page metadata, logo `alt` text, the dashboard
 * brand, the Better Auth TOTP `issuer`, email subjects and the Resend From
 * name. The TOTP issuer and the E2E helper that reconstructs the
 * `otpauth://` URI MUST be listed together — if they disagree, every TOTP
 * enrolment in E2E fails to validate.
 */
export const BRAND_PLACEHOLDER_FILES = Object.freeze([
  // Next.js document metadata.
  'apps/web/src/app/layout.tsx',
  // User-visible brand in the app shell.
  'apps/web/src/app/dashboard/_components/DashboardShell.tsx',
  // Logo alt text on the public auth pages.
  'apps/web/src/app/auth/page.tsx',
  'apps/web/src/app/auth/forgot-password/page.tsx',
  'apps/web/src/app/auth/reset-password/page.tsx',
  'apps/web/src/app/auth/two-factor/page.tsx',
  'apps/web/src/app/auth/verify-email/page.tsx',
  // Better Auth: TOTP issuer + email subjects.
  'packages/auth/src/server/auth.ts',
  'packages/auth/src/server/email/email-helpers.ts',
  // Rebuilds the otpauth:// URI during E2E — must match the issuer above.
  'apps/web/e2e/helpers/auth.helper.ts',
  // Test/dev defaults.
  'apps/api/test/e2e-env.ts',
  '.github/workflows/ci.yml',
]);

export const UNDOTTED_ALIASES = Object.freeze([
  { dotted: '.gitignore', undotted: 'gitignore' },
  { dotted: 'pnpm-lock.yaml', undotted: 'pnpm-lock.template.yaml' },
]);

// ---------------------------------------------------------------------------
// Copy exclusions (relative POSIX-style paths, matched against rel path)
// ---------------------------------------------------------------------------

/** Directory names excluded at any depth. */
export const EXCLUDE_DIR_NAMES = new Set([
  '.git',
  'node_modules',
  '.next',
  'dist',
  'build',
  'out',
  'coverage',
  '.turbo',
  'playwright-report',
  'test-results',
  'blob-report',
  '.vercel',
  '.nyc_output',
  // Local agent caches (`.agent/` singular) — machine-specific transcripts and
  // absolute paths. NOT `.agents/` (plural), which is the vendored skill set
  // the generated project intentionally keeps.
  '.agent',
  // Editor / IDE state — never part of a generated project.
  '.vscode',
  '.idea',
  '.fleet',
  '.settings',
  '.cache',
  '.pnpm-store',
  'pnpm-store',
  'logs',
]);

/** Exact relative file paths excluded (generated provenance, local certs). */
export const EXCLUDE_FILES = new Set([
  // Committed coverage artifacts that are NOT a workspace package
  // (packages/coverage has no package.json).
  'packages/coverage/clover.xml',
  'packages/coverage/coverage-final.json',
  'packages/coverage/lcov.info',
  // Live dev TLS key/cert must never ship into a generated project.
  // Keep nginx/certs/README.md + .gitignore so the folder structure survives.
  'nginx/certs/localhost.crt',
  'nginx/certs/localhost.key',
  // Next.js codegen (gitignored; regenerated on `next dev` / `next build`).
  'apps/web/next-env.d.ts',
]);

/**
 * Directory *prefixes* excluded wholesale. These are committed-by-accident or
 * machine-specific trees that the basename/suffix rules below cannot catch.
 * Each entry is matched as `rel === prefix || rel.startsWith(prefix + '/')`.
 */
export const EXCLUDE_PATH_PREFIXES = [
  // Stray committed coverage artifact tree (no package.json).
  'packages/coverage',
  // Prisma 7 generated client — gitignored, regenerated by `pnpm db:generate`.
  // Without this rule a scaffold from a dirty tree ships a stale client.
  'packages/database/src/generated',
  // k6 run artifacts (SUMMARY_PATH output). `*.log` siblings are caught by the
  // suffix rule, but `*.summary.json` is not.
  'k6/results',
];

/**
 * Secret material and credentials-manager files. Matched by exact basename at
 * any depth. `.env*` is handled separately below (to keep `*.example`).
 */
export const SECRET_FILE_NAMES = new Set([
  '.npmrc',
  '.netrc',
  '_netrc',
  '.pypirc',
  '.htpasswd',
]);

/** Certificate / private-key material. Never part of a distributed template. */
export const CERT_SUFFIXES = ['.pem', '.key', '.crt', '.cer', '.p12', '.pfx', '.jks', '.keystore'];

/**
 * Returns true if a relative path (POSIX style) must NOT be copied.
 * Covers: excluded dirs/prefixes, live .env files (keeps *.example), local
 * Playwright auth state, credentials files, TLS key material, logs,
 * tsbuildinfo, DS_Store, and generated artifact trees.
 */
export function isExcludedRelPath(relPosix) {
  const parts = relPosix.split('/');
  for (const p of parts) {
    if (EXCLUDE_DIR_NAMES.has(p)) return true;
  }
  if (EXCLUDE_FILES.has(relPosix)) return true;
  // npm-publishing tooling for the template itself never reaches a generated app.
  if (TEMPLATE_ONLY_PATHS.includes(relPosix)) return true;
  for (const prefix of EXCLUDE_PATH_PREFIXES) {
    if (relPosix === prefix || relPosix.startsWith(`${prefix}/`)) return true;
  }
  const base = parts[parts.length - 1];
  if (base === '.DS_Store' || base === 'Thumbs.db') return true;
  if (base.endsWith('.tsbuildinfo')) return true;
  if (base.endsWith('.log') || base.endsWith('.err')) return true;
  // Live env files: exclude `.env`, `.env.e2e`, `.env.k6`, `.env.test`,
  // `.env.local`, `.env.*.local` — but KEEP `*.example` files.
  if (base.endsWith('.example')) return false;
  if (base === '.env' || base.startsWith('.env.')) return true;
  if (SECRET_FILE_NAMES.has(base)) return true;
  const lower = base.toLowerCase();
  for (const suffix of CERT_SUFFIXES) {
    if (lower.endsWith(suffix)) return true;
  }
  // Playwright auth state / test output (gitignored tokens).
  if (relPosix.includes('/.auth/') || relPosix.startsWith('.auth/')) return true;
  if (parts.includes('playwright-report') || parts.includes('test-results')) return true;
  if (parts.includes('blob-report')) return true;
  // pnpm debug logs / store.
  if (base.startsWith('pnpm-debug.log')) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Transformation policy
// ---------------------------------------------------------------------------

/** Directories never transformed (vendored / illustrative). */
export const NEVER_TRANSFORM_PREFIXES = ['.agents/'];

/** Lockfiles are regenerated, never text-transformed. */
export const LOCKFILE_NAMES = new Set(['pnpm-lock.yaml', 'pnpm-lock.template.yaml']);

/**
 * OTel runtime identity strings are INTENTIONALLY preserved.
 * `getMeter('@repo/observability')` / `getTracer('@repo/observability')` are
 * telemetry identities (meter/tracer names visible in dashboards), NOT Node
 * module resolution. Renaming them would silently fork telemetry series.
 * Documented in docs/SCAFFOLD.md and in the namespace-completeness allowlist.
 */
export const OTEL_PRESERVE_FILES = new Set([
  'packages/observability/src/metrics.ts',
  'packages/observability/src/tracing.ts',
]);

/** Text extensions eligible for controlled `@repo/` token replacement. */
export const TRANSFORM_TEXT_EXTENSIONS = new Set([
  '.json',
  '.js',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.jsx',
  '.yaml',
  '.yml',
  '.toml',
  '.md',
  '.mdx',
  '.txt',
  '.sh',
  '.ps1',
  '.gitignore',
  '.dockerignore',
  '.prettierignore',
  '.npmignore',
]);

/** Filenames without extension that are still text-transformable. */
export const TRANSFORM_TEXT_BASENAMES = new Set([
  'Dockerfile',
  'Dockerfile.prod',
  'Dockerfile.dev',
  '.dockerignore',
  '.gitignore',
  '.prettierignore',
]);

export function isTextTransformable(relPosix) {
  const base = relPosix.split('/').pop();
  // Dockerfiles with suffixes (Dockerfile.prod).
  if (base.startsWith('Dockerfile')) return true;
  if (TRANSFORM_TEXT_BASENAMES.has(base)) return true;
  const dot = base.lastIndexOf('.');
  if (dot === -1) return false;
  return TRANSFORM_TEXT_EXTENSIONS.has(base.slice(dot).toLowerCase());
}

/**
 * Files whose `@repo/` references are intentionally preserved and therefore
 * allowlisted in the namespace-completeness scan (each with a reason).
 * Everything else in the generated project must contain zero `@repo/`.
 */
export const NAMESPACE_ALLOWLIST = [
  {
    file: 'packages/observability/src/metrics.ts',
    pattern: "@repo/observability",
    reason: 'Stable OTel meter name (telemetry identity, not module resolution).',
  },
  {
    file: 'packages/observability/src/tracing.ts',
    pattern: "@repo/observability",
    reason: 'Stable OTel tracer name (telemetry identity, not module resolution).',
  },
];

// ---------------------------------------------------------------------------
// Docs / provenance
// ---------------------------------------------------------------------------

export const SCAFFOLD_VERSION = '1';
export const TEMPLATE_NAME = 'turbo-template';

/**
 * The published package version, read from the manifest that ships with the
 * template. Written into every generated project's `.template.json` as
 * `templateVersion`, so a user can always tell which template build they
 * started from. Derived rather than hardcoded: there is nothing to forget to
 * bump at release time.
 */
export function readTemplateVersion(rootDir) {
  try {
    // `import.meta.url` -> scripts/scaffold/ -> scripts/ -> <root>
    const here = path.dirname(fileURLToPath(import.meta.url));
    const manifest = path.join(rootDir || path.resolve(here, '..', '..'), 'package.json');
    const pkg = JSON.parse(readFileSync(manifest, 'utf8'));
    return typeof pkg.version === 'string' && pkg.version !== '0.0.0' ? pkg.version : SCAFFOLD_VERSION;
  } catch {
    return SCAFFOLD_VERSION;
  }
}
