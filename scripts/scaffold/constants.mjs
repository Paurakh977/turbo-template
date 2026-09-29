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

export const TEMPLATE_SCOPE = '@repo';
export const TEMPLATE_ROOT_NAME = 'my-turborepo';

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
  '.vercel',
  '.nyc_output',
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
]);

/**
 * Returns true if a relative path (POSIX style) must NOT be copied.
 * Covers: excluded dirs, live .env files (keeps *.example), local Playwright
 * auth state, logs, tsbuildinfo, DS_Store, coverage package artifacts.
 */
export function isExcludedRelPath(relPosix) {
  const parts = relPosix.split('/');
  for (const p of parts) {
    if (EXCLUDE_DIR_NAMES.has(p)) return true;
  }
  if (EXCLUDE_FILES.has(relPosix)) return true;
  // packages/coverage/** — entire committed artifact tree (no package.json).
  if (relPosix === 'packages/coverage' || relPosix.startsWith('packages/coverage/')) return true;
  const base = parts[parts.length - 1];
  if (base === '.DS_Store') return true;
  if (base.endsWith('.tsbuildinfo')) return true;
  if (base.endsWith('.log')) return true;
  // Live env files: exclude `.env`, `.env.e2e`, `.env.k6`, `.env.test`,
  // `.env.local`, `.env.*.local` — but KEEP `*.example` files.
  if (base.endsWith('.example')) return false;
  if (base === '.env' || base.startsWith('.env.')) return true;
  // Playwright auth state / test output (gitignored tokens).
  if (relPosix.includes('/.auth/') || relPosix.startsWith('.auth/')) return true;
  if (parts.includes('playwright-report') || parts.includes('test-results')) return true;
  // pnpm debug logs / store.
  if (base.startsWith('pnpm-debug.log')) return true;
  if (parts.includes('pnpm-store')) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Transformation policy
// ---------------------------------------------------------------------------

/** Directories never transformed (vendored / illustrative). */
export const NEVER_TRANSFORM_PREFIXES = ['.agents/'];

/** Lockfiles are regenerated, never text-transformed. */
export const LOCKFILE_NAMES = new Set(['pnpm-lock.yaml']);

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
