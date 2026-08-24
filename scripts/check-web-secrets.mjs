#!/usr/bin/env node
/**
 * Guardrail: the internet-facing web tier must not carry database secrets.
 *
 * Scans the built Next.js standalone output for references to secret-bearing
 * environment variable names. After architecture-b-migration.md Phase 2,
 * ANY occurrence is a failure: the web container receives no DATABASE_URL /
 * BETTER_AUTH_SECRET / PG* at all, so finding their names inside server
 * chunks means dead DB code (or worse, bundled drivers) snuck back in.
 *
 * Usage:
 *   node scripts/check-web-secrets.mjs            # report-only (transition)
 *   node scripts/check-web-secrets.mjs --strict   # non-zero exit on findings
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const TARGET = join(ROOT, 'apps', 'web', '.next', 'standalone');
const STRICT = process.argv.includes('--strict');

const FORBIDDEN = [
  'DATABASE_URL',
  'BETTER_AUTH_SECRET',
  'PGPASSWORD',
  'PGUSER',
  'PGHOST',
];

const SKIP_DIRS = new Set(['.next/static', 'cache']);

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      const rel = relative(TARGET, full).replaceAll('\\', '/');
      if ([...SKIP_DIRS].some((s) => rel === s || rel.startsWith(`${s}/`)))
        continue;
      yield* walk(full);
    } else if (/\.(js|mjs|cjs|edge)$/.test(entry.name)) {
      yield full;
    }
  }
}

if (!statSync(TARGET, { throwIfNoEntry: false })?.isDirectory()) {
  console.error(
    `[web-secrets] ${relative(ROOT, TARGET)} not found - run "pnpm build" first`,
  );
  process.exit(2);
}

const findings = [];
for (const file of walk(TARGET)) {
  const content = readFileSync(file, 'utf8');
  for (const name of FORBIDDEN) {
    if (content.includes(name)) {
      findings.push({ file: relative(ROOT, file), name });
    }
  }
}

if (findings.length === 0) {
  console.log('[web-secrets] clean - no forbidden names in standalone output');
  process.exit(0);
}

const byName = new Map();
for (const f of findings) {
  byName.set(f.name, (byName.get(f.name) ?? 0) + 1);
}
console.error('[web-secrets] findings:');
for (const [name, count] of [...byName.entries()].sort()) {
  console.error(`  ${name}: ${count} file(s)`);
  for (const f of findings.filter((x) => x.name === name).slice(0, 5)) {
    console.error(`    - ${f.file}`);
  }
  if (count > 5) console.error(`    - ... and ${count - 5} more`);
}
console.error(
  `[web-secrets] total: ${findings.length} occurrence(s)` +
    (STRICT ? '' : ' (report-only until migration Phase 2)'),
);
process.exit(STRICT ? 1 : 0);
