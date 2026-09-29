/**
 * Scaffolder golden tests (no network, no install).
 * Run: node --test scripts/scaffold/tests/
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  normalizeProjectName,
  validateProjectName,
  parseScopeInput,
  resolveDestination,
} from '../names.mjs';
import { copyTemplate } from '../copy.mjs';
import { discoverInternalSuffixes, transformTree, findStaleRepoRefs } from '../transform.mjs';
import { readWorkspaceNames, checkDangling } from '../graph.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_ROOT = path.resolve(here, '..', '..', '..');
const SCAFFOLD = path.join(TEMPLATE_ROOT, 'scripts', 'scaffold.mjs');
const nodeExe = process.execPath;

async function mkTemp() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'scaffold-test-'));
}

describe('names', () => {
  it('Case 2 normalization: My Awesome App -> my-awesome-app', () => {
    assert.equal(normalizeProjectName('My Awesome App'), 'my-awesome-app');
    assert.equal(normalizeProjectName('my_app'), 'my-app');
    assert.equal(normalizeProjectName('MyApp'), 'myapp');
  });
  it('rejects empty / traversal / reserved', () => {
    assert.equal(validateProjectName('').valid, false);
    assert.equal(validateProjectName('node_modules').valid, false);
    const dest = resolveDestination('../x', TEMPLATE_ROOT, 'x');
    assert.equal(dest.ok, true);
    assert.equal(resolveDestination(TEMPLATE_ROOT, TEMPLATE_ROOT, 'x').ok, false);
    assert.equal(
      resolveDestination(path.join(TEMPLATE_ROOT, 'child'), TEMPLATE_ROOT, 'x').ok,
      false,
    );
  });
  it('Case 3 custom scope parsing', () => {
    assert.equal(parseScopeInput('@company').scope, '@company');
    assert.equal(parseScopeInput('company').scope, '@company');
    assert.equal(parseScopeInput('@company/foo').ok, false);
  });
});

describe('discovery', () => {
  it('derives internal suffixes from manifests', async () => {
    const suffixes = await discoverInternalSuffixes(TEMPLATE_ROOT);
    for (const expected of ['auth', 'database', 'ui', 'eslint-config', 'typescript-config']) {
      assert.ok(suffixes.includes(expected), `missing suffix ${expected}`);
    }
  });
});

describe('copy + transform (Case 1/6/10)', () => {
  it('copies without secrets/artifacts and renames @repo/* (skip-install semantics)', async () => {
    const dest = path.join(await mkTemp(), 'my-awesome-app');
    const stats = await copyTemplate({ srcRoot: TEMPLATE_ROOT, destRoot: dest });
    assert.ok(stats.copied > 100, `expected >100 files, got ${stats.copied}`);
    // Case 10: secrets / history / artifacts not copied.
    for (const forbidden of ['.git', '.env', '.env.e2e', 'node_modules']) {
      const p = path.join(dest, forbidden);
      assert.equal(
        await fs.stat(p).then(() => true).catch(() => false),
        false,
        `${forbidden} must not be copied`,
      );
    }
    assert.equal(
      await fs.stat(path.join(dest, '.env.example')).then(() => true).catch(() => false),
      true,
      '.env.example must be copied',
    );

    const suffixSet = new Set([...(await discoverInternalSuffixes(TEMPLATE_ROOT)), 'k6-load-testing', 'migrate']);
    const t = await transformTree({
      destRoot: dest,
      newScope: '@my-awesome-app',
      suffixSet,
      projectName: 'my-awesome-app',
    });
    assert.ok(t.manifestsChanged >= 10, `expected >=10 manifests, got ${t.manifestsChanged}`);

    // Root package renamed; workspace protocols preserved.
    const root = JSON.parse(await fs.readFile(path.join(dest, 'package.json'), 'utf8'));
    assert.equal(root.name, 'my-awesome-app');
    const auth = JSON.parse(await fs.readFile(path.join(dest, 'packages', 'auth', 'package.json'), 'utf8'));
    assert.equal(auth.name, '@my-awesome-app/auth');
    assert.equal(auth.dependencies['@my-awesome-app/database'], 'workspace:^');

    // Source import rewritten (incl. subpath + re-export).
    const rolesReexport = await fs.readFile(path.join(dest, 'packages', 'auth', 'src', 'shared', 'roles.ts'), 'utf8');
    assert.ok(rolesReexport.includes('@my-awesome-app/roles'));

    // Jest regex preserved as regex.
    const webJest = await fs.readFile(path.join(dest, 'apps', 'web', 'jest.config.ts'), 'utf8');
    assert.ok(webJest.includes('^@my-awesome-app/auth$'));

    // Docker filter + symlink farm rewritten; unscoped prune untouched.
    const docker = await fs.readFile(path.join(dest, 'apps', 'api', 'Dockerfile.prod'), 'utf8');
    assert.ok(docker.includes('pnpm --filter @my-awesome-app/database'));
    assert.ok(docker.includes('/rt/node_modules/@my-awesome-app/auth'));
    assert.ok(docker.includes('prune api --docker'));

    // Guard regex rewritten.
    const guard = await fs.readFile(path.join(dest, 'scripts', 'check-web-auth-imports.mjs'), 'utf8');
    assert.ok(guard.includes('@my-awesome-app\\/auth') || guard.includes('@my-awesome-app/auth'));

    // OTel identity stable (documented exception).
    const metrics = await fs.readFile(path.join(dest, 'packages', 'observability', 'src', 'metrics.ts'), 'utf8');
    assert.ok(metrics.includes(`'@repo/observability'`));

    // Vendored skills untouched.
    const skillSample = path.join(dest, '.agents', 'skills', 'turborepo', 'SKILL.md');
    if (await fs.stat(skillSample).then(() => true).catch(() => false)) {
      const skill = await fs.readFile(skillSample, 'utf8');
      assert.ok(skill.includes('@repo/') || skill.includes('@acme/'));
    }

    // Namespace completeness: only OTel allowlist remains.
    const stale = await findStaleRepoRefs(dest);
    const nonOtel = stale.filter((f) => !f.startsWith('packages/observability/src/'));
    assert.deepEqual(nonOtel, [], `unexpected stale refs: ${nonOtel.join(', ')}`);

    // Package graph: no dangling internal deps.
    const names = await readWorkspaceNames(dest);
    assert.ok(names.has('@my-awesome-app/auth'));
    const dangling = await checkDangling(dest, names);
    assert.deepEqual(dangling, [], `dangling deps: ${dangling.join('; ')}`);

    await fs.rm(path.dirname(dest), { recursive: true, force: true });
  });
});

describe('CLI', () => {
  it('Case 4 dry-run changes nothing', async () => {
    const tmp = await mkTemp();
    const dest = path.join(tmp, 'dry-app');
    const r = spawnSync(nodeExe, [SCAFFOLD, '--project-name', 'dry-app', '--destination', dest, '--dry-run', '--yes'], {
      encoding: 'utf8',
    });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.equal(await fs.stat(dest).then(() => true).catch(() => false), false);
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('Case 5 existing destination refuses without --allow-existing', async () => {
    const tmp = await mkTemp();
    await fs.writeFile(path.join(tmp, 'keep.txt'), 'user data', 'utf8');
    const r = spawnSync(
      nodeExe,
      [SCAFFOLD, '--project-name', 'x-app', '--destination', tmp, '--yes', '--skip-install', '--no-git', '--skip-validation'],
      { encoding: 'utf8' },
    );
    assert.notEqual(r.status, 0);
    assert.equal(await fs.readFile(path.join(tmp, 'keep.txt'), 'utf8'), 'user data');
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('Case 7 --no-git leaves no .git (skip-install, skip-validation)', async () => {
    const tmp = await mkTemp();
    const dest = path.join(tmp, 'nogit-app');
    const r = spawnSync(
      nodeExe,
      [SCAFFOLD, '--project-name', 'nogit-app', '--destination', dest, '--yes', '--skip-install', '--no-git', '--skip-validation'],
      { encoding: 'utf8' },
    );
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.equal(await fs.stat(path.join(dest, '.git')).then(() => true).catch(() => false), false);
    // Transplanted lockfiles stay in place so the user can install frozen.
    assert.equal(await fs.stat(path.join(dest, 'pnpm-lock.yaml')).then(() => true).catch(() => false), true);
    await fs.rm(tmp, { recursive: true, force: true });
  }, { timeout: 120000 });

  it('Case 9 lockfile transplant renames keys, edits zero resolutions', async () => {
    const tmp = await mkTemp();
    const dest = path.join(tmp, 'lock-app');
    const r = spawnSync(
      nodeExe,
      [SCAFFOLD, '--project-name', 'lock-app', '--destination', dest, '--yes', '--skip-install', '--no-git', '--skip-validation'],
      { encoding: 'utf8' },
    );
    assert.equal(r.status, 0, r.stderr + r.stdout);
    const transplanted = await fs.readFile(path.join(dest, 'pnpm-lock.yaml'), 'utf8');
    const template = await fs.readFile(path.join(TEMPLATE_ROOT, 'pnpm-lock.yaml'), 'utf8');
    // New namespace present as importer keys...
    assert.ok(transplanted.includes(`'@lock-app/auth':`));
    // ...old namespace fully gone from the lockfile...
    assert.equal(transplanted.includes(`'@repo/`), false);
    // ...and every other line byte-identical (zero resolutions edited).
    const tLines = template.split('\n');
    const gLines = transplanted.split('\n');
    assert.equal(tLines.length, gLines.length);
    for (let i = 0; i < tLines.length; i++) {
      const expected = tLines[i].split(`'@repo/`).join(`'@lock-app/`);
      assert.equal(gLines[i], expected, `lockfile line ${i + 1} differs beyond key rename`);
    }
    // Migrate lockfile byte-identical (no scope refs by design).
    const mTemplate = await fs.readFile(path.join(TEMPLATE_ROOT, 'apps', 'migrate', 'pnpm-lock.yaml'), 'utf8');
    const mGen = await fs.readFile(path.join(dest, 'apps', 'migrate', 'pnpm-lock.yaml'), 'utf8');
    assert.equal(mGen, mTemplate);
    await fs.rm(tmp, { recursive: true, force: true });
  }, { timeout: 120000 });
});
