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
  toDisplayName,
  toEnvSlug,
  isRunningAsInstalledPackage,
} from '../names.mjs';
import { copyTemplate } from '../copy.mjs';
import {
  discoverInternalSuffixes,
  transformTree,
  transformEnvExample,
  findStaleRepoRefs,
} from '../transform.mjs';
import { restoreDottedFilenames } from '../restore.mjs';
import { validateStructure } from '../validate.mjs';
import { isExcludedRelPath, UNDOTTED_ALIASES, PUBLISH_ONLY_MANIFEST_FIELDS } from '../constants.mjs';
import { readWorkspaceNames, checkDangling } from '../graph.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_ROOT = path.resolve(here, '..', '..', '..');
const SCAFFOLD = path.join(TEMPLATE_ROOT, 'scripts', 'scaffold.mjs');
const nodeExe = process.execPath;

async function mkTemp() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'scaffold-test-'));
}

/** Full copy -> restore -> transform pipeline against a throwaway destination. */
async function generateInto(destRoot, { projectName, newScope }) {
  await copyTemplate({ srcRoot: TEMPLATE_ROOT, destRoot });
  await restoreDottedFilenames(destRoot);
  const suffixSet = new Set([...(await discoverInternalSuffixes(TEMPLATE_ROOT)), 'k6-load-testing', 'migrate']);
  return transformTree({
    destRoot,
    newScope,
    suffixSet,
    projectName,
    envSlug: toEnvSlug(projectName),
    displayName: toDisplayName(projectName),
  });
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

  it('display name and Postgres-safe slug derivation', () => {
    assert.equal(toDisplayName('my-awesome-app'), 'My Awesome App');
    assert.equal(toDisplayName('acme'), 'Acme');
    // Acronyms and bare numbers must not be exploded into letters.
    assert.equal(toDisplayName('api2'), 'Api2');
    // Dashes are illegal in an unquoted Postgres identifier.
    assert.equal(toEnvSlug('my-awesome-app'), 'my_awesome_app');
    assert.equal(toEnvSlug('acme.shop'), 'acme_shop');
    assert.equal(toEnvSlug(''), 'app');
    // Never empty, never trailing underscore, within the 63-byte limit.
    assert.ok(!toEnvSlug('---').startsWith('_'));
    assert.ok(toEnvSlug('x'.repeat(100)).length <= 63);
  });

  it('installed-package detection and local destination default', () => {
    assert.equal(isRunningAsInstalledPackage(TEMPLATE_ROOT), false);
    const installed = path.join(path.sep, 'x', 'node_modules', 'create-turbo-template-app');
    assert.equal(isRunningAsInstalledPackage(installed), true);
    // `npx` semantics: default into the CWD, not its parent.
    const npxDest = resolveDestination(undefined, installed, 'my-app', { preferLocalCwd: true });
    assert.ok(npxDest.ok);
    assert.equal(path.basename(npxDest.path), 'my-app');
    assert.equal(path.dirname(npxDest.path), path.resolve('.'));
    // Local checkout semantics: default outside the checkout, resolved from cwd.
    const localDest = resolveDestination(undefined, TEMPLATE_ROOT, 'my-app');
    assert.ok(localDest.ok);
    assert.equal(path.basename(localDest.path), 'my-app');
    const relToTemplate = path.relative(TEMPLATE_ROOT, localDest.path);
    assert.ok(
      relToTemplate.startsWith('..') || path.isAbsolute(relToTemplate),
      'the default destination must never land inside the template checkout',
    );
    // Writing inside an installed package is always refused.
    assert.equal(resolveDestination(path.join(installed, 'out'), installed, 'my-app').ok, false);
  });
});

describe('exclusion policy', () => {
  it('never copies secrets, key material, local caches, or generated trees', () => {
    for (const p of [
      '.env',
      '.env.local',
      '.env.k6',
      'apps/api/.env',
      '.npmrc',
      '.netrc',
      'nginx/certs/localhost.key',
      'nginx/certs/localhost.crt',
      'secrets/prod.pem',
      'apps/api/dist/main.js',
      'node_modules/foo/index.js',
      '.next/server/app.js',
      '.turbo/cache/x',
      '.agent/wiki-discovery/01-repository-platform.md',
      'apps/web/.vscode/settings.json',
      'apps/api/.idea/workspace.xml',
      'packages/database/src/generated/prisma/client.ts',
      'k6/results/capacity.summary.json',
      'packages/coverage/lcov.info',
      'logs/dev.log',
      'apps/api/foo.tsbuildinfo',
      '.DS_Store',
    ]) {
      assert.equal(isExcludedRelPath(p), true, `${p} must be excluded`);
    }
    // Everything a generated project genuinely needs must survive.
    for (const p of [
      '.env.example',
      '.env.e2e.example',
      '.env.k6.example',
      '.env.test.example',
      '.gitignore',
      'apps/api/.gitignore',
      'apps/web/.gitignore',
      'nginx/certs/.gitignore',
      'nginx/certs/README.md',
      'pnpm-lock.yaml',
      'apps/migrate/pnpm-lock.yaml',
      'patches/better-auth@1.6.29.patch',
      'docs/wiki/00-INDEX.md',
      'AGENTS.md',
      '.agents/skills/turborepo/SKILL.md',
      '.github/workflows/ci.yml',
      'apps/api/src/main.ts',
      'observability/alloy/config.alloy',
    ]) {
      assert.equal(isExcludedRelPath(p), false, `${p} must be copied`);
    }
  });

  it('every undotted alias has a real counterpart that must ship', () => {
    for (const { dotted } of UNDOTTED_ALIASES) {
      assert.equal(isExcludedRelPath(dotted), false, `${dotted} must be part of the payload`);
    }
    assert.ok(PUBLISH_ONLY_MANIFEST_FIELDS.includes('bin'));
    assert.ok(PUBLISH_ONLY_MANIFEST_FIELDS.includes('files'));
  });
});

describe('env identity transform', () => {
  it('rewrites identity keys and leaves secrets untouched (LF and CRLF)', () => {
    const lf = [
      'POSTGRES_USER=myapp',
      'POSTGRES_DB=myapp_db',
      'DATABASE_URL=postgresql://myapp:supersecretpassword@localhost:5432/myapp_db?schema=public',
      'DIRECT_URL=postgresql://myapp:supersecretpassword@localhost:5432/myapp_db?schema=public',
      'APP_NAME=MyApp',
      'EMAIL_FROM=MyApp <onboarding@resend.dev>',
      'BETTER_AUTH_SECRET=',
      'GOOGLE_CLIENT_SECRET=',
      'SEED_ADMIN_EMAIL=admin@yourapp.com',
    ].join('\n');
    for (const input of [lf, lf.replace(/\n/g, '\r\n')]) {
      const { content, changed } = transformEnvExample(input, { slug: 'acme_shop', display: 'Acme Shop' });
      assert.equal(changed, true);
      assert.ok(content.includes('POSTGRES_USER=acme_shop'));
      assert.ok(content.includes('POSTGRES_DB=acme_shop_db'));
      assert.ok(content.includes('postgresql://acme_shop:supersecretpassword@localhost:5432/acme_shop_db'));
      assert.ok(content.includes('APP_NAME=Acme Shop'));
      assert.ok(content.includes('EMAIL_FROM=Acme Shop <onboarding@resend.dev>'));
      // Secrets and user-supplied values are never invented or overwritten.
      assert.ok(content.includes('BETTER_AUTH_SECRET=\n') || content.includes('BETTER_AUTH_SECRET=\r'));
      assert.ok(content.includes('GOOGLE_CLIENT_SECRET=\n') || content.includes('GOOGLE_CLIENT_SECRET=\r'));
      assert.ok(content.includes('SEED_ADMIN_EMAIL=admin@yourapp.com'));
      // No `myapp` placeholder survives.
      assert.equal(/myapp/.test(content), false);
    }
  });

  it('preserves the original line terminator', () => {
    const crlf = 'APP_NAME=MyApp\r\nPOSTGRES_USER=myapp\r\n';
    const { content } = transformEnvExample(crlf, { slug: 'acme_shop', display: 'Acme Shop' });
    assert.equal(content, 'APP_NAME=Acme Shop\r\nPOSTGRES_USER=acme_shop\r\n');
  });

  it('is a no-op when there is nothing to rewrite', () => {
    const input = 'POSTGRES_USER=acme_shop\nAPP_NAME=Acme Shop\n';
    const { changed } = transformEnvExample(input, { slug: 'acme_shop', display: 'Acme Shop' });
    assert.equal(changed, false);
  });
});

describe('npm-mangled filename restore', () => {
  it('renames undotted aliases back to their real names', async () => {
    const tmp = await mkTemp();
    await fs.writeFile(path.join(tmp, 'gitignore'), 'node_modules\n', 'utf8');
    await fs.mkdir(path.join(tmp, 'apps', 'api'), { recursive: true });
    await fs.writeFile(path.join(tmp, 'apps', 'api', 'gitignore'), 'dist\n', 'utf8');
    await fs.writeFile(path.join(tmp, 'pnpm-lock.template.yaml'), 'lockfileVersion: 9.0\n', 'utf8');
    // A file that must not be touched.
    await fs.writeFile(path.join(tmp, 'keep.txt'), 'keep', 'utf8');

    const { restored } = await restoreDottedFilenames(tmp);
    assert.ok(restored.includes('.gitignore'));
    assert.ok(restored.includes('apps/api/.gitignore'));
    assert.ok(restored.includes('pnpm-lock.yaml'));
    assert.equal(await fs.readFile(path.join(tmp, '.gitignore'), 'utf8'), 'node_modules\n');
    assert.equal(await fs.readFile(path.join(tmp, 'pnpm-lock.yaml'), 'utf8'), 'lockfileVersion: 9.0\n');
    assert.equal(await fs.stat(path.join(tmp, 'keep.txt')).then(() => true).catch(() => false), true);

    // Idempotent: running again on an already-restored tree changes nothing.
    const second = await restoreDottedFilenames(tmp);
    assert.deepEqual(second.restored, []);
    assert.equal(second.alreadyPresent, 0);
    assert.deepEqual(second.normalized, []);

    // The publish-staging block is stripped from ignore rules, so the result is
    // identical from a git checkout and from an npm tarball.
    const dest2 = path.join(await mkTemp(), 'strip-check');
    await fs.mkdir(dest2, { recursive: true });
    await fs.writeFile(
      path.join(dest2, '.gitignore'),
      'node_modules\n.env*\n# >>> npm publish staging (x) >>>\ngitignore\npnpm-lock.template.yaml\n# <<< npm publish staging (x) <<<\ncoverage\n',
      'utf8',
    );
    const normalized = await restoreDottedFilenames(dest2);
    assert.deepEqual(normalized.normalized, ['.gitignore']);
    const cleaned = await fs.readFile(path.join(dest2, '.gitignore'), 'utf8');
    assert.equal(cleaned.includes('npm publish staging'), false);
    assert.ok(cleaned.includes('node_modules'));
    assert.ok(cleaned.includes('coverage'));

    await fs.rm(tmp, { recursive: true, force: true });
    await fs.rm(path.dirname(dest2), { recursive: true, force: true });
  });

  it('never overwrites a real file with an alias', async () => {
    const tmp = await mkTemp();
    await fs.writeFile(path.join(tmp, '.gitignore'), 'REAL\n', 'utf8');
    await fs.writeFile(path.join(tmp, 'gitignore'), 'ALIAS\n', 'utf8');
    const { restored, alreadyPresent } = await restoreDottedFilenames(tmp);
    assert.deepEqual(restored, []);
    assert.equal(alreadyPresent, 1);
    assert.equal(await fs.readFile(path.join(tmp, '.gitignore'), 'utf8'), 'REAL\n');
    await fs.rm(tmp, { recursive: true, force: true });
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

describe('publishable-payload guarantees (npx path)', () => {
  it('generates a project that is safe to git-commit and frozen-installable', async () => {
    const dest = path.join(await mkTemp(), 'Acme Shop Gen');
    await fs.mkdir(path.dirname(dest), { recursive: true });
    const t = await generateInto(dest, { projectName: 'acme-shop-gen', newScope: '@acme-shop-gen' });
    assert.ok(t.envExamplesChanged >= 1, 'the *.env.example identity pass must run');

    // 1. Ignore rules restored (npm strips .gitignore; the scaffolder then
    //    runs `git add -A`, so a missing .gitignore leaks .env + node_modules).
    for (const f of ['.gitignore', 'apps/api/.gitignore', 'apps/web/.gitignore', 'nginx/certs/.gitignore']) {
      assert.ok(
        await fs.stat(path.join(dest, f)).then(() => true).catch(() => false),
        `${f} must exist in the generated project`,
      );
    }
    // The publish-staging marker block must not leak into the shipped rules.
    const rootIgnore = await fs.readFile(path.join(dest, '.gitignore'), 'utf8');
    assert.equal(rootIgnore.includes('npm publish staging'), false);
    assert.ok(rootIgnore.includes('node_modules'));
    assert.ok(rootIgnore.includes('.env*'));

    // 2. Root manifest carries NO publish-only fields and is private again.
    const root = JSON.parse(await fs.readFile(path.join(dest, 'package.json'), 'utf8'));
    assert.equal(root.name, 'acme-shop-gen');
    assert.equal(root.private, true);
    for (const field of PUBLISH_ONLY_MANIFEST_FIELDS) {
      assert.equal(field in root, false, `root package.json must not carry "${field}"`);
    }
    // The template's own workflow must survive.
    assert.equal(typeof root.scripts.dev, 'string');
    assert.equal(typeof root.scripts.build, 'string');
    assert.ok(root.devDependencies['@acme-shop-gen/eslint-config'] === 'workspace:*');

    // 3. Lockfiles present so `pnpm install --frozen-lockfile` can work.
    assert.ok(await fs.stat(path.join(dest, 'pnpm-lock.yaml')).then(() => true).catch(() => false));
    assert.ok(
      await fs.stat(path.join(dest, 'apps', 'migrate', 'pnpm-lock.yaml')).then(() => true).catch(() => false),
    );

    // 4. The LLM wiki ships intact — it is a headline feature of the template.
    for (const doc of ['AGENTS.md', 'docs/wiki/00-INDEX.md', 'docs/wiki/_meta/registry.json']) {
      assert.ok(await fs.stat(path.join(dest, doc)).then(() => true).catch(() => false), `${doc} must ship`);
    }
    const registry = JSON.parse(await fs.readFile(path.join(dest, 'docs', 'wiki', '_meta', 'registry.json'), 'utf8'));
    const entries = Array.isArray(registry) ? registry : registry.files || registry.entries || [];
    if (entries.length > 0) {
      for (const entry of entries) {
        const rel = typeof entry === 'string' ? entry : entry.path;
        if (!rel || typeof rel !== 'string') continue;
        const full = path.join(dest, 'docs', 'wiki', rel);
        assert.ok(
          await fs.stat(full).then(() => true).catch(() => false),
          `wiki registry references ${rel}, which is missing from the generated project`,
        );
      }
    }

    // 5. `.env.example` reflects the new project's identity, not `myapp`.
    const envExample = await fs.readFile(path.join(dest, '.env.example'), 'utf8');
    assert.ok(envExample.includes('POSTGRES_USER=acme_shop_gen'));
    assert.ok(envExample.includes('APP_NAME=Acme Shop Gen'));
    assert.equal(/myapp/.test(envExample), false);

    // 6. Structure validation passes on the generated tree.
    const checked = await validateStructure({ destRoot: dest });
    assert.ok(checked.includes('.gitignore'));
    assert.ok(checked.includes('AGENTS.md'));

    // 7. validateStructure actually fails when a guarantee is broken.
    await fs.writeFile(path.join(dest, '.env'), 'BETTER_AUTH_SECRET=leaked\n', 'utf8');
    await assert.rejects(() => validateStructure({ destRoot: dest }), /forbidden files in output/);
    await fs.rm(path.join(dest, '.env'), { force: true });

    await fs.rm(path.dirname(dest), { recursive: true, force: true });
  }, { timeout: 120000 });
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
