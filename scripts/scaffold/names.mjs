/**
 * Project-name / scope normalization + validation.
 * Keeps `project name` (filesystem + root package name) separate from
 * `package scope` (@scope for internal `@scope/*` workspaces).
 */
import path from 'node:path';

const RESERVED = new Set(['node_modules', 'favicon.ico']);
const CORE_MODULES = new Set([
  'assert', 'buffer', 'child_process', 'cluster', 'crypto', 'dgram', 'dns',
  'events', 'fs', 'http', 'https', 'net', 'os', 'path', 'process', 'querystring',
  'readline', 'stream', 'string_decoder', 'timers', 'tls', 'tty', 'url', 'util',
  'v8', 'vm', 'worker_threads', 'zlib',
]);

/**
 * Normalize raw user input to a kebab-case npm-compatible project name.
 * "My Awesome App" -> "my-awesome-app", "my_app" -> "my-app",
 * "MyApp" -> "myapp", "my.app" keeps dots (valid, warned later).
 */
export function normalizeProjectName(raw) {
  if (typeof raw !== 'string') return '';
  let s = raw.trim().toLowerCase();
  // Spaces / underscores become hyphens (dots preserved — valid in npm).
  s = s.replace(/[\s_]+/g, '-');
  // Strip anything outside the npm-safe set for the project-name portion.
  s = s.replace(/[^a-z0-9-.~]+/g, '-');
  s = s.replace(/-+/g, '-').replace(/\.+/g, '.');
  s = s.replace(/^[-.~]+|[-.~]+$/g, '');
  return s;
}

function npmNameProblems(name) {
  const problems = [];
  if (!name) problems.push('name must not be empty');
  if (name.length > 214) problems.push('name must be <= 214 characters');
  if (/[A-Z]/.test(name)) problems.push('name must be lowercase');
  if (/[\s~)('!*]/.test(name)) problems.push('name contains URL-unsafe characters');
  if (/^[._]/.test(name)) problems.push('name must not start with . or _');
  if (!/^[a-z0-9][a-z0-9._~-]*$/.test(name)) problems.push('name has invalid format');
  if (RESERVED.has(name)) problems.push(`name is reserved (${name})`);
  if (CORE_MODULES.has(name)) problems.push(`name collides with a Node core module (${name})`);
  return problems;
}

/**
 * Human-facing display form: `my-awesome-app` -> `My Awesome App`.
 * Used for APP_NAME / EMAIL_FROM in generated `.env.example` files and in the
 * post-scaffold summary. Falls back to the slug when a segment is an acronym
 * or a bare number, so `api2` stays `Api2` rather than `A P I 2`.
 */
export function toDisplayName(projectName) {
  if (!projectName) return '';
  return projectName
    .split(/[-_.~]+/)
    .filter(Boolean)
    .map((seg) => (/^[a-z]/.test(seg) ? seg[0].toUpperCase() + seg.slice(1) : seg))
    .join(' ');
}

/**
 * Postgres-safe identifier: lowercase, dashes/dots replaced with underscores,
 * truncated to 63 bytes. Postgres identifiers cannot contain `-` unquoted, and
 * DATABASE_URL would otherwise need percent-encoding in the password position.
 */
export function toEnvSlug(projectName, maxLength = 63) {
  const slug = String(projectName || '')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, maxLength)
    .replace(/_+$/g, '');
  return slug || 'app';
}

export function validateProjectName(name) {
  const problems = npmNameProblems(name);
  const warnings = [];
  if (/^\d/.test(name)) warnings.push('leading digit is valid but unusual');
  if (name.includes('.')) warnings.push('dots are valid but can be confused with file extensions');
  return { valid: problems.length === 0, problems, warnings };
}

/**
 * Parse --scope input. Accepts `my-company` or `@my-company`.
 * Rejects `@my-company/foo` (ambiguous: scope + subpath) with guidance.
 */
export function parseScopeInput(raw) {
  if (raw == null || raw === '') return { ok: false, error: 'empty scope' };
  const s = String(raw).trim();
  if (s.includes('/')) {
    return {
      ok: false,
      error: `scope must be a bare scope like "@my-company", not a package path like "${s}". Use --scope @my-company.`,
    };
  }
  const bare = s.startsWith('@') ? s.slice(1) : s;
  const normalized = normalizeProjectName(bare);
  if (!normalized || normalized !== bare.toLowerCase().replace(/[\s_]+/g, '-').replace(/[^a-z0-9-.~]+/g, '-').replace(/-+/g, '-').replace(/^[-.~]+|[-.~]+$/g, '')) {
    // Fall through to validation which will report precisely.
  }
  const scoped = `@${normalized}`;
  const problems = npmNameProblems(normalized);
  if (problems.length > 0) {
    return { ok: false, error: `invalid scope "${s}": ${problems.join('; ')}` };
  }
  return { ok: true, scope: scoped };
}

export function deriveScope(projectName) {
  return `@${projectName}`;
}

const DANGEROUS_BASENAMES = new Set([
  'node_modules', '.git', '..', '.', '.env', 'package.json',
]);

export function validateDestinationName(name) {
  if (!name || !name.trim()) return { valid: false, error: 'destination name must not be empty' };
  if (name.includes('\0')) return { valid: false, error: 'destination contains NUL' };
  if (DANGEROUS_BASENAMES.has(name.trim())) {
    return { valid: false, error: `destination name "${name}" is dangerous` };
  }
  return { valid: true };
}

/**
 * Resolve + guard the destination directory.
 * Rejects: template root itself, anything inside template root, dangerous roots.
 *
 * `preferLocalCwd` switches the default from `../<name>` to `./<name>`. That is
 * the right default when the scaffolder runs as an installed package
 * (`npx create-turbo-template-app`), because the user's cwd is where they
 * intend to work — create-react-app / create-next-app behave the same way.
 * Running `pnpm scaffold` inside the template keeps `../<name>` so the output
 * lands beside the checkout rather than inside it.
 */
export function resolveDestination(destinationInput, templateRoot, fallbackProjectName, { preferLocalCwd = false } = {}) {
  const raw = destinationInput || (preferLocalCwd ? `./${fallbackProjectName}` : `../${fallbackProjectName}`);
  const resolved = path.resolve(raw);
  const templateResolved = path.resolve(templateRoot);
  if (resolved === templateResolved) {
    return { ok: false, error: 'destination must not be the template repository itself' };
  }
  const rel = path.relative(templateResolved, resolved);
  if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
    return { ok: false, error: 'destination must be outside the template repository' };
  }
  // Never allow filesystem roots / home as destination.
  const parsed = path.parse(resolved);
  if (resolved === parsed.root) {
    return { ok: false, error: 'destination must not be a filesystem root' };
  }
  // Never write inside an installed package (npx cache / node_modules).
  const templateInsideNodeModules = templateResolved.split(path.sep).includes('node_modules');
  if (templateInsideNodeModules) {
    const relToTemplate = path.relative(templateResolved, resolved);
    if (!relToTemplate.startsWith('..') && !path.isAbsolute(relToTemplate)) {
      return { ok: false, error: 'destination must be outside the installed package directory' };
    }
  }
  return { ok: true, path: resolved };
}

/**
 * True when this scaffolder is executing from an installed npm package
 * (`node_modules/<pkg>`) rather than from a template checkout. Used to pick
 * CLI defaults (destination layout, messaging) appropriate for `npx`.
 */
export function isRunningAsInstalledPackage(templateRoot) {
  return path.resolve(templateRoot).split(path.sep).includes('node_modules');
}
