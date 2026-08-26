#!/usr/bin/env node
/**
 * Guardrail: the web tier must never import the @repo/auth ROOT entry at
 * runtime. The root instantiates the full BetterAuth runtime (pg pool,
 * signing secret, Redis) — Architecture B keeps all of that API-side. Web may
 * only use pure subpaths (@repo/auth/roles | /permissions | /password-policy)
 * or compile-time-erased forms (`import type`, `export type`, all-`type`
 * named specifiers).
 *
 * Why a script and not ESLint? packages/eslint-config loads
 * eslint-plugin-only-warn, which monkey-patches Linter.verify to downgrade
 * EVERY error to a warning at import time — config-level severities cannot
 * override it, so a fenced rule can never fail `turbo lint`. This scanner is
 * deterministic and CI-enforceable.
 *
 * Mechanics: erased (type-only) statements are MASKED with same-length
 * whitespace instead of deleted, so reported line/column numbers always refer
 * to the original file. Type-statement matchers are bounded by `;` so they can
 * never swallow a following runtime import.
 *
 * Usage:
 *   node scripts/check-web-auth-imports.mjs   # exit 1 on violations, 2 if src missing
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const TARGET = join(ROOT, 'apps', 'web', 'src');

// Runtime root import shapes we reject:
//   import { x } from '@repo/auth';   export * from '@repo/auth';
//   import('@repo/auth')              require('@repo/auth')
const RUNTIME_ROOT_IMPORT =
  /(?:from\s*|import\s*\(\s*|require\s*\(\s*)['"]@repo\/auth['"]/g;

// Compile-time-erased shapes. Each is anchored to a single statement via the
// trailing `;` (and `[^;]` bodies), so a lazy match can never spill into a
// SUBSEQUENT runtime import — the bug class that would make this guard fail
// open on `import type {...} from './x'; import { auth } from '@repo/auth';`.
const ERASED_PATTERNS = [
  // import type X, { Y } from '@repo/auth';
  /import\s+type\s[^;]*?from\s*['"]@repo\/auth['"]\s*;/g,
  // export type { X } from '@repo/auth';  (isolatedModules-safe re-export)
  /export\s+type\s[^;]*?from\s*['"]@repo\/auth['"]\s*;/g,
];

// `import { type A } from '@repo/auth';` — erased by TS only when EVERY
// specifier is type-only. Handled conditionally below.
const NAMED_IMPORT_STMT =
  /import\s*\{([^}]*)\}\s*from\s*['"]@repo\/auth['"]\s*;/g;

function isAllTypeSpecifiers(specifierList) {
  const parts = specifierList
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.length > 0 && parts.every((p) => /^type\s/.test(p));
}

function maskErased(content) {
  const ranges = [];
  for (const pattern of ERASED_PATTERNS) {
    for (const m of content.matchAll(pattern)) {
      ranges.push([m.index, m.index + m[0].length]);
    }
  }
  for (const m of content.matchAll(NAMED_IMPORT_STMT)) {
    if (isAllTypeSpecifiers(m[1])) {
      ranges.push([m.index, m.index + m[0].length]);
    }
  }

  let masked = content;
  // Replace with equal-length spaces so offsets (and thus reported lines)
  // stay identical to the original file.
  for (const [start, end] of ranges) {
    masked =
      masked.slice(0, start) +
      ' '.repeat(end - start) +
      masked.slice(end);
  }
  return masked;
}

function lineOf(content, index) {
  return content.slice(0, index).split('\n').length;
}

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (/\.(ts|tsx|mts|cts|mjs|cjs|js|jsx)$/.test(entry.name)) yield full;
  }
}

if (!statSync(TARGET, { throwIfNoEntry: false })?.isDirectory()) {
  console.error(
    `[web-auth-imports] ${relative(ROOT, TARGET)} not found - run from the repo root`,
  );
  process.exit(2);
}

const findings = [];
for (const file of walk(TARGET)) {
  const original = readFileSync(file, 'utf8');
  const masked = maskErased(original);
  for (const match of masked.matchAll(RUNTIME_ROOT_IMPORT)) {
    findings.push({ file: relative(ROOT, file), line: lineOf(masked, match.index) });
  }
}

if (findings.length === 0) {
  console.log(
    '[web-auth-imports] clean - no runtime @repo/auth root imports in web src',
  );
  process.exit(0);
}

console.error('[web-auth-imports] findings:');
for (const f of findings.slice(0, 10)) {
  console.error(`  - ${f.file}:${f.line}`);
}
if (findings.length > 10) console.error(`  - ... and ${findings.length - 10} more`);
console.error(
  '[web-auth-imports] Use @repo/auth subpaths (/roles, /permissions, /password-policy)',
);
console.error('[web-auth-imports] or an erased form (`import type` / `export type`).');
process.exit(1);
