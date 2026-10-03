/**
 * Post-generation validation. Uses the GENERATED project's own package.json
 * scripts (lint/typecheck/test/build) — never invents command names.
 * All child processes use arg arrays with shell:false.
 */
import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { findStaleRepoRefs } from './transform.mjs';

export function pnpmCmd() {
  return process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
}

function run(cmd, args, cwd, { allowFail = false, env } = {}) {
  // NOTE: on Windows, pnpm resolves to pnpm.cmd which requires a shell.
  // Args remain an array (no string interpolation of user input).
  const needsShell = process.platform === 'win32' && cmd.endsWith('.cmd');
  const res = spawnSync(cmd, args, {
    cwd,
    stdio: 'pipe',
    shell: needsShell,
    encoding: 'utf8',
    ...(env ? { env: { ...process.env, ...env } } : {}),
  });
  const ok = res.status === 0;
  if (!ok && !allowFail) {
    const spawnErr = res.error ? `\nSPAWN ERROR: ${res.error.message}` : '';
    const tail = `${res.stdout || ''}\n${res.stderr || ''}${spawnErr}`.slice(-4000);
    throw new Error(
      `Command failed: ${cmd} ${args.join(' ')}\nCWD: ${cwd}\nExit: ${res.status}\n${tail}`,
    );
  }
  return res;
}

/**
 * Normalize one gitignore rule for comparison: drop comments/negations, strip
 * the leading `/` anchor and trailing `/`. Ignore files in this template use
 * every style — `/node_modules`, `node_modules/`, `/.next/`, `dist/` — so a
 * naive string equality check reports false negatives.
 * @returns {string|null} null when the line carries no rule.
 */
function normalizeIgnoreRule(line) {
  let rule = line.trim();
  if (!rule || rule.startsWith('#') || rule.startsWith('!')) return null;
  rule = rule.replace(/^\/+/, '').replace(/\/+$/, '');
  return rule || null;
}

/** True when `rules` covers `pattern` (exact, directory-prefix, or glob prefix). */
function ruleCovers(rules, pattern) {
  const bare = pattern.replace(/^\/+/, '').replace(/\/+$/, '');
  if (pattern.endsWith('*')) {
    const stem = bare.slice(0, -1);
    return rules.some((r) => r.startsWith(stem));
  }
  return rules.some((r) => r === bare || r.startsWith(`${bare}/`));
}

/**
 * Files that must exist as `.gitignore` in a generated project, and the
 * patterns each must contain.
 *
 * npm strips `.gitignore` from published tarballs (nested copies are dropped;
 * a root copy is renamed to `.npmignore` on install), so the scaffolder
 * restores them from undotted aliases. If that ever regresses, the scaffolder's
 * own `git add -A` would commit `node_modules/` and a live `.env` full of
 * credentials. This check turns that silent failure into a hard error.
 */
const REQUIRED_IGNORE_FILES = [
  { file: '.gitignore', mustIgnore: ['node_modules', '.env*'] },
  { file: 'apps/api/.gitignore', mustIgnore: ['node_modules', 'dist'] },
  { file: 'apps/web/.gitignore', mustIgnore: ['node_modules', '.next'] },
  { file: 'nginx/certs/.gitignore', mustIgnore: ['localhost.key', 'localhost.crt'] },
];

/**
 * Files that must never appear in a generated project, checked independently
 * of the copy denylist so a policy regression is caught here rather than after
 * a user has already committed credentials.
 *
 * Only rules that the scaffolder and the install could never legitimately
 * produce are listed. `node_modules/`, `dist/`, `.next/` and friends are NOT:
 * `pnpm install` and `turbo build` create them inside the generated project, so
 * flagging them would be a false positive. Their provenance is covered by the
 * copy denylist (EXCLUDE_DIR_NAMES) and by the publish gate instead.
 */
const FORBIDDEN_IN_OUTPUT = [
  { matcher: (p) => p === '.env' || (p.startsWith('.env.') && !p.endsWith('.example')), reason: 'live env file' },
  { matcher: (p) => /\.(pem|key|crt|cer|p12|pfx|keystore)$/i.test(p), reason: 'TLS key material' },
  { matcher: (p) => p === '.npmrc' || p === '.netrc', reason: 'registry credentials' },
  { matcher: (p) => p === '.agent' || p.startsWith('.agent/'), reason: 'local agent cache' },
  { matcher: (p) => p === 'k6/results' || p.startsWith('k6/results/'), reason: 'k6 run artifact' },
  { matcher: (p) => p === 'packages/coverage' || p.startsWith('packages/coverage/'), reason: 'committed coverage artifact' },
  { matcher: (p) => p === 'logs' || p.startsWith('logs/'), reason: 'debug log dump' },
];

/** Directories the install or build legitimately creates — never descended into. */
const SCAN_SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  '.turbo',
  'coverage',
  'dist',
  'build',
  'playwright-report',
  'test-results',
]);

/**
 * Structural checks that need neither `node_modules` nor a package manager, so
 * they can run even when the install was skipped (`--skip-install`).
 * This is what makes `--skip-install` safe: the namespace and ignore-rule
 * guarantees are verified regardless of whether dependencies were installed.
 */
export async function validateStructure({ destRoot }) {
  const problems = [];
  const checked = [];

  // 1. Ignore rules exist and cover the dangerous paths.
  for (const { file, mustIgnore } of REQUIRED_IGNORE_FILES) {
    const full = path.join(destRoot, file);
    let content;
    try {
      content = await fs.readFile(full, 'utf8');
    } catch {
      problems.push(`missing ${file} — npm strips .gitignore from published packages, so it must be restored from its alias`);
      continue;
    }
    const rules = content.split('\n').map(normalizeIgnoreRule).filter(Boolean);
    for (const pattern of mustIgnore) {
      // A negated rule (`!.env.example`) does not count as coverage.
      if (!ruleCovers(rules, pattern)) problems.push(`${file} does not ignore "${pattern}"`);
    }
    checked.push(file);
  }

  // 2. Nothing forbidden survived the copy.
  const offenders = [];
  async function walk(dir) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(destRoot, full).split(path.sep).join('/');
      if (entry.isDirectory()) {
        if (SCAN_SKIP_DIRS.has(entry.name)) continue;
        await walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      for (const rule of FORBIDDEN_IN_OUTPUT) {
        if (rule.matcher(rel)) {
          offenders.push(`${rel} (${rule.reason})`);
          break;
        }
      }
    }
  }
  await walk(destRoot);
  if (offenders.length > 0) {
    problems.push(`forbidden files in output: ${offenders.slice(0, 10).join(', ')}${offenders.length > 10 ? ` (+${offenders.length - 10} more)` : ''}`);
  }

  // 3. Publish-only manifest fields must not leak into the generated project.
  const rootPkg = JSON.parse(await fs.readFile(path.join(destRoot, 'package.json'), 'utf8'));
  for (const field of ['bin', 'files', 'keywords', 'publishConfig', 'repository', 'homepage']) {
    if (field in rootPkg) problems.push(`root package.json still carries the publish-only field "${field}"`);
  }
  if (rootPkg.private !== true) problems.push('root package.json should be private:true (a workspace root is never published)');

  // 4. The lockfile must exist for `--frozen-lockfile` to work.
  try {
    await fs.access(path.join(destRoot, 'pnpm-lock.yaml'));
    checked.push('pnpm-lock.yaml');
  } catch {
    problems.push('pnpm-lock.yaml missing — the generated project cannot run `pnpm install --frozen-lockfile`');
  }

  // 5. The AI-agent knowledge base must have shipped intact.
  for (const doc of ['AGENTS.md', 'docs/wiki/00-INDEX.md', 'docs/wiki/_meta/registry.json']) {
    try {
      await fs.access(path.join(destRoot, doc));
      checked.push(doc);
    } catch {
      problems.push(`${doc} missing — the LLM wiki is part of the template and must ship`);
    }
  }

  if (problems.length > 0) {
    throw new Error(problems.join('\n  - '));
  }
  return checked;
}

export async function validateGenerated({
  destRoot,
  newScope,
  skipBuild = false,
  skipValidation = false,
  verbose = false,
}) {
  const results = [];
  const step = async (name, fn) => {
    // Always announce step start: typecheck/lint/test/build each take
    // minutes with no child output, which otherwise looks like a hang.
    console.log(`  → ${name}...`);
    const started = Date.now();
    try {
      const detail = await fn();
      results.push({ name, ok: true, detail });
      console.log(`  ✓ ${name} (${((Date.now() - started) / 1000).toFixed(1)}s)`);
    } catch (err) {
      results.push({ name, ok: false, error: err.message });
      throw new Error(`Validation step "${name}" failed: ${err.message}`);
    }
  };

  if (skipValidation) return results;

  // 0. Structure, ignore rules, and forbidden files. Runs first and cheaply so
  //    a packaging regression fails before any multi-minute script runs.
  await step('structure', async () => {
    const checked = await validateStructure({ destRoot });
    return `verified ${checked.length} required files, ignore rules intact, no secrets present`;
  });

  // 1. No stale @repo/ refs (outside documented allowlist).
  await step('no-stale-namespace', async () => {
    const stale = await findStaleRepoRefs(destRoot);
    if (stale.length > 0) {
      throw new Error(
        `stale @repo/ references in: ${stale.slice(0, 20).join(', ')}${stale.length > 20 ? ` (+${stale.length - 20} more)` : ''}`,
      );
    }
    return 'no unintended @repo/ references';
  });

  // 2. Package graph resolves.
  await step('package-graph', async () => {
    const pnpm = pnpmCmd();
    run(pnpm, ['ls', '-r', '--depth', '-1'], destRoot);
    // Verify every internal dep key maps to an existing workspace package.
    const { readWorkspaceNames } = await import('./graph.mjs');
    const problems = await readWorkspaceNames(destRoot).then(async (names) => {
      const { checkDangling } = await import('./graph.mjs');
      return checkDangling(destRoot, names);
    });
    if (problems.length > 0) {
      throw new Error(`dangling internal deps: ${problems.slice(0, 10).join('; ')}`);
    }
    return 'workspace graph resolves';
  });

  // 3. Turbo graph.
  await step('turbo-graph', async () => {
    const pnpm = pnpmCmd();
    // `turbo build --dry` is version-dependent; prefer --dry=json, fall back.
    try {
      run(pnpm, ['turbo', 'run', 'build', '--dry=json'], destRoot);
    } catch {
      run(pnpm, ['turbo', 'run', 'build', '--dry'], destRoot);
    }
    return 'turbo graph OK';
  });

  // 4-7. Repo's own scripts (discovered, not invented).
  const pkg = JSON.parse(await fs.readFile(path.join(destRoot, 'package.json'), 'utf8'));
  const scripts = pkg.scripts || {};
  const pnpm = pnpmCmd();

  // The generated Prisma client is gitignored; builds depend on it (mirrors
  // CI's Generate-Prisma-client step). Generate never opens a connection, but
  // prisma.config.ts requires the vars to EXIST — placeholder when unset.
  if (scripts['db:generate']) {
    await step('db:generate', async () => {
      const placeholder = 'postgresql://placeholder:placeholder@127.0.0.1:5432/placeholder?schema=public';
      run(
        pnpm,
        ['run', 'db:generate'],
        destRoot,
        {
          env: {
            DATABASE_URL: process.env.DATABASE_URL || placeholder,
            DIRECT_URL: process.env.DIRECT_URL || placeholder,
          },
        },
      );
      return 'prisma client generated';
    });
  }

  if (scripts.typecheck) {
    await step('typecheck', async () => {
      run(pnpm, ['run', 'typecheck'], destRoot);
      return 'typecheck passed';
    });
  }
  if (scripts.lint) {
    await step('lint', async () => {
      run(pnpm, ['run', 'lint'], destRoot);
      return 'lint passed';
    });
  }
  // Architecture guards must pass under the NEW scope. Both are cheap and
  // scope-sensitive, so they run before the expensive scripts.
  if (scripts['guard:web-auth-imports']) {
    await step('guard:web-auth-imports', async () => {
      run(pnpm, ['run', 'guard:web-auth-imports'], destRoot);
      return 'auth-import guard passed';
    });
  }
  if (scripts.test) {
    await step('test', async () => {
      run(pnpm, ['run', 'test'], destRoot);
      return 'unit tests passed';
    });
  }
  if (scripts.build && !skipBuild) {
    await step('build', async () => {
      // Mirror CI's build env (ci.yml): the web build requires these at
      // build time. Respect already-set values; never invent secrets.
      run(
        pnpm,
        ['run', 'build'],
        destRoot,
        {
          env: {
            NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || '/api',
            NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
            APP_NAME: process.env.APP_NAME || 'Validation',
            EMAIL_FROM: process.env.EMAIL_FROM || 'noreply@example.com',
          },
        },
      );
      return 'build passed';
    });
  }

  // Architecture B: the web tier must carry zero DB/secret references in its
  // standalone bundle. Runs LAST because it inspects the build output, so it is
  // skipped when the build itself was skipped.
  if (scripts['guard:web-secrets'] && !skipBuild) {
    await step('guard:web-secrets', async () => {
      run(pnpm, ['run', 'guard:web-secrets', '--strict'], destRoot);
      return 'web bundle carries no DB secrets';
    });
  }

  // 8. Git independence.
  await step('git-independence', async () => {
    const res = run('git', ['-C', destRoot, 'rev-parse', '--is-inside-work-tree'], destRoot, { allowFail: true });
    if (res.status !== 0) return 'no git repo (opted out with --no-git)';
    const remote = run('git', ['-C', destRoot, 'remote'], destRoot, { allowFail: true });
    if ((remote.stdout || '').trim()) {
      throw new Error('generated repo has a git remote (must have none)');
    }
    return 'fresh git repo, no template remote';
  });

  return results;
}
