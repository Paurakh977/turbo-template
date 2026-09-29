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
  // Architecture guard must pass under the NEW scope.
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
