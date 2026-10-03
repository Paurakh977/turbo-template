#!/usr/bin/env node
/**
 * Publish gate: asserts the npm tarball contains no secret, no artifact, and no
 * local cruft.
 *
 * Why a gate instead of trusting config: `files` in package.json is an
 * allowlist, but npm's always-ignored list and packlist's directory expansion
 * have repeatedly surprised us (root `pnpm-lock.yaml` is stripped no matter
 * what `files` says; a recursive glob entry overrides `.gitignore` entirely and
 * would happily publish a live `.env`). Configuration alone cannot express
 * "publish everything except these paths" reliably, so the tarball itself is
 * inspected and the publish is aborted if anything forbidden appears.
 *
 * Runs in `prepack` (and `pnpm guard:publish-contents`). Exits non-zero on any
 * violation, which fails `npm publish` / `pnpm publish` closed.
 *
 * Usage:
 *   node scripts/check-publish-contents.mjs           # inspect the real tarball
 *   node scripts/check-publish-contents.mjs --json    # machine-readable
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const AS_JSON = process.argv.includes('--json');

/** Set when this script re-enters npm pack (prepack -> gate -> pack -> prepack). */
const REENTRY_GUARD = 'TURBO_TEMPLATE_GATE_REENTRY';

/**
 * Forbidden exact paths, relative to the package root.
 * `.env` templates ARE shipped; live env files never are.
 */
const FORBIDDEN_PATHS = [
  '.env',
  '.env.k6',
  '.env.e2e',
  '.env.test',
  '.env.local',
  '.npmrc',
  '.netrc',
  'nginx/certs/localhost.crt',
  'nginx/certs/localhost.key',
  'packages/database/src/generated/client.ts',
  'k6/results/capacity.summary.json',
  'k6/results/capacity-live.summary.json',
];

/** Forbidden path prefixes (directory trees that must never be published). */
const FORBIDDEN_PREFIXES = [
  '.agent/',
  'node_modules/',
  '.git/',
  '.turbo/',
  'k6/results/',
  'packages/database/src/generated/',
  'packages/coverage/',
  '.vscode/',
  '.idea/',
];

/** Forbidden file extensions — credential and key material. */
const FORBIDDEN_EXTENSIONS = ['.pem', '.key', '.crt', '.cer', '.p12', '.pfx', '.jks', '.keystore'];

/**
 * Substrings that must never appear in the packed file list. The scaffolder
 * carries absolute developer paths in one vendored doc; the alias list catches
 * a missed stage step.
 */
const FORBIDDEN_SUBSTRINGS = ['/Users/', 'C:\\Users\\', 'D:\\template\\', 'node_modules/.pnpm/'];

/**
 * Files the tarball MUST contain. Missing any of these means the published
 * package would scaffold a broken project, so this fails closed too.
 */
const REQUIRED_PATHS = [
  'package.json',
  'README.md',
  'LICENSE',
  'pnpm-workspace.yaml',
  'turbo.json',
  'tsconfig.json',
  'pnpm-lock.template.yaml', // staged alias for the npm-stripped pnpm-lock.yaml
  'gitignore', // staged alias for the npm-renamed .gitignore
  'apps/api/package.json',
  'apps/web/package.json',
  'apps/migrate/package.json',
  'apps/migrate/pnpm-lock.yaml',
  'packages/auth/package.json',
  'packages/database/package.json',
  'packages/database/prisma/schema.prisma',
  'docker-compose.yml',
  'scripts/scaffold.mjs',
  'scripts/scaffold/constants.mjs',
  'scripts/scaffold/transform.mjs',
  'scripts/scaffold/restore.mjs',
  'scripts/scaffold/strip.mjs',
  'scripts/scaffold/cli.mjs',
  'scripts/scaffold/lockfile.mjs',
  'docker-compose.observability.yml',
  'nginx/nginx.conf',
  'nginx/entrypoint.sh',
  'nginx/certs/gitignore',
  'k6/config.js',
  'observability/alloy/config.alloy',
  'pgbouncer/pgbouncer.ini',
  '.env.example',
  '.env.e2e.example',
  '.env.k6.example',
  '.env.test.example',
  // The AI-agent knowledge base must ship intact — it is a headline feature.
  'AGENTS.md',
  'docs/wiki/00-INDEX.md',
  'docs/wiki/00-GLOSSARY.md',
  'docs/wiki/_meta/registry.json',
  'docs/wiki/invariants/01-architecture-b.md',
  'docs/wiki/flows/auth.md',
  'docs/wiki/subsystems/api-runtime.md',
  'docs/wiki/workflows/add-domain-module.md',
  'docs/GETTING_STARTED.md',
  'docs/GUIDE.md',
  'docs/CODEBASE.md',
  'docs/SCAFFOLD.md',
  '.github/workflows/ci.yml',
  '.agents/skills/turborepo/SKILL.md',
];

function listPackedFiles() {
  // `--ignore-scripts` is essential: without it the nested `npm pack` re-runs
  // this package's own prepack (stage + gate), whose stdout would corrupt the
  // --json payload we parse here. The staged aliases are already on disk by the
  // time this runs, so skipping lifecycle scripts changes nothing about what is
  // being audited.
  const res = spawnSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    cwd: ROOT,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    env: { ...process.env, [REENTRY_GUARD]: '1' },
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.status !== 0 || !res.stdout) {
    throw new Error(`npm pack --dry-run failed (exit ${res.status}):\n${res.stderr || res.stdout || '(no output)'}`);
  }
  // Defensive: lifecycle noise from a future npm version must not break parsing.
  const start = res.stdout.indexOf('[\n  {');
  const json = start === -1 ? res.stdout : res.stdout.slice(start);
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    throw new Error(`could not parse npm pack --json output: ${err.message}\n${res.stdout.slice(0, 400)}`);
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('npm pack --dry-run returned no package entry');
  }
  return { files: parsed[0].files.map((f) => f.path).sort(), meta: parsed[0] };
}

function audit(files) {
  const violations = [];
  const set = new Set(files);

  for (const f of files) {
    const lower = f.toLowerCase();
    if (FORBIDDEN_PATHS.includes(f)) violations.push({ path: f, rule: 'forbidden path (secret or artifact)' });
    if (FORBIDDEN_PREFIXES.some((p) => f.startsWith(p))) {
      violations.push({ path: f, rule: 'forbidden directory tree' });
    }
    if (FORBIDDEN_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
      violations.push({ path: f, rule: 'credential / TLS key material' });
    }
    for (const needle of FORBIDDEN_SUBSTRINGS) {
      if (f.includes(needle)) violations.push({ path: f, rule: `machine-specific path fragment "${needle}"` });
    }
    // A live env file that is not an `*.example` template.
    const base = f.split('/').pop();
    if ((base === '.env' || base.startsWith('.env.')) && !base.endsWith('.example')) {
      violations.push({ path: f, rule: 'live env file (only *.example may ship)' });
    }
  }

  const missing = REQUIRED_PATHS.filter((p) => !set.has(p));
  return { violations, missing };
}

function main() {
  if (process.env[REENTRY_GUARD] === '1') {
    // Re-entered via a nested `npm pack`; the outer invocation owns the audit.
    return;
  }
  let result;
  try {
    result = listPackedFiles();
  } catch (err) {
    console.error('[check-publish-contents] could not inspect the tarball.');
    console.error(err.message);
    process.exit(1);
  }
  const { violations, missing } = audit(result.files);

  if (AS_JSON) {
    console.log(
      JSON.stringify(
        {
          files: result.files.length,
          packedSize: result.meta.size ?? null,
          unpackedSize: result.meta.unpackedSize ?? null,
          violations,
          missing,
        },
        null,
        2,
      ),
    );
  } else {
    const packed = typeof result.meta.size === 'number' ? `, ${(result.meta.size / 1024).toFixed(0)} kB packed` : '';
    const unpacked =
      typeof result.meta.unpackedSize === 'number' ? `, ${(result.meta.unpackedSize / 1024 / 1024).toFixed(1)} MB unpacked` : '';
    console.log(`[check-publish-contents] inspecting ${result.files.length} packed files${packed}${unpacked}`);
  }

  let failed = false;
  if (violations.length > 0) {
    failed = true;
    console.error(`\n[check-publish-contents] FAIL — ${violations.length} forbidden path(s) in the tarball:`);
    for (const v of violations.slice(0, 40)) console.error(`  ✗ ${v.path}  — ${v.rule}`);
    if (violations.length > 40) console.error(`  … +${violations.length - 40} more`);
  }
  if (missing.length > 0) {
    failed = true;
    console.error(`\n[check-publish-contents] FAIL — ${missing.length} required path(s) missing from the tarball:`);
    for (const m of missing) console.error(`  ✗ ${m}`);
    console.error('  If these are `.gitignore` / `pnpm-lock.yaml`, run: node scripts/stage-template.mjs');
  }

  if (failed) {
    console.error('\nPublish aborted. Fix the above, then re-run `pnpm guard:publish-contents`.\n');
    process.exit(1);
  }
  if (!AS_JSON) {
    console.log('[check-publish-contents] OK — no secrets, artifacts, or machine paths in the tarball.');
  }
}

main();