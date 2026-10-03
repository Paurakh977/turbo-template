#!/usr/bin/env node
/**
 * Local Turborepo scaffolder entry.
 *   pnpm scaffold [--project-name my-awesome-app] [--scope @my-company] ...
 *
 * Flow: preflight -> parse/prompt -> validate/normalize -> derive scope ->
 * copy (denylist) -> transform (semantic manifests + controlled text) ->
 * delete copied lockfiles -> pnpm regenerate -> install -> git init ->
 * validate -> report. See docs/SCAFFOLD.md for policy decisions
 * (OTel stable, k6 cosmetic rename, migrate isolation preserved).
 */
import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, helpText, promptMissing, confirmPlan } from './scaffold/cli.mjs';
import {
  normalizeProjectName,
  validateProjectName,
  parseScopeInput,
  deriveScope,
  validateDestinationName,
  resolveDestination,
  toDisplayName,
  toEnvSlug,
  isRunningAsInstalledPackage,
} from './scaffold/names.mjs';
import { copyTemplate } from './scaffold/copy.mjs';
import { discoverInternalSuffixes, transformTree, findStaleRepoRefs } from './scaffold/transform.mjs';
import { restoreDottedFilenames } from './scaffold/restore.mjs';
import { validateGenerated, validateStructure, pnpmCmd } from './scaffold/validate.mjs';
import { TEMPLATE_NAME, readTemplateVersion } from './scaffold/constants.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_ROOT = path.resolve(here, '..');
// True when running from `node_modules/<pkg>` (i.e. `npx create-...`), false
// when running `pnpm scaffold` from a template checkout. Drives CLI defaults.
const RUNNING_INSTALLED = isRunningAsInstalledPackage(TEMPLATE_ROOT);

function fail(phase, message, destHint) {
  console.error(`\nScaffolding failed during ${phase}.`);
  console.error(message);
  if (destHint) {
    console.error(`\nDestination:\n  ${destHint}`);
    console.error('The generated project was left in place for inspection.');
  }
  process.exit(1);
}

async function isDirEmpty(dir) {
  try {
    const entries = await fs.readdir(dir);
    return entries.length === 0;
  } catch (err) {
    if (err.code === 'ENOENT') return true;
    throw err;
  }
}

function runCapture(cmd, args, cwd) {
  // NOTE: on Windows, pnpm resolves to pnpm.cmd which requires a shell to
  // spawn. Args remain an array (no string interpolation of user input).
  const needsShell = process.platform === 'win32' && cmd.endsWith('.cmd');
  const res = spawnSync(cmd, args, { cwd, stdio: 'pipe', shell: needsShell, encoding: 'utf8' });
  if (res.error && res.status == null) {
    res.stdout = `${res.stdout || ''}\nSPAWN ERROR: ${res.error.message}`;
  }
  return res;
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    console.log(helpText());
    process.exit(1);
  }
  if (opts.help) {
    console.log(helpText());
    process.exit(0);
  }

  // Preflight: must run from the template root.
  try {
    await fs.access(path.join(TEMPLATE_ROOT, 'pnpm-workspace.yaml'));
    await fs.access(path.join(TEMPLATE_ROOT, 'turbo.json'));
  } catch {
    fail('preflight', `Must run from the template repository root (expected pnpm-workspace.yaml + turbo.json in ${TEMPLATE_ROOT}).`);
  }
  if (process.version < 'v18') {
    fail('preflight', `Node >= 18 required (found ${process.version}).`);
  }

  // Interactive prompts for anything not supplied via flags.
  if (!opts.yes && (!opts.projectName || !opts.scope || !opts.destination)) {
    // Only prompt when attached to a TTY; otherwise require flags/--yes.
    if (process.stdin.isTTY) {
      await promptMissing(opts);
    }
  }

  if (!opts.projectName) {
    console.error('Project name is required. Pass --project-name <name> or run interactively.');
    console.log(helpText());
    process.exit(1);
  }

  // Validate / normalize project name.
  const projectName = normalizeProjectName(opts.projectName);
  if (!projectName) fail('name-validation', `Could not derive a valid project name from "${opts.projectName}".`);
  const nameCheck = validateProjectName(projectName);
  if (!nameCheck.valid) {
    fail('name-validation', `Invalid project name "${projectName}" (from "${opts.projectName}"): ${nameCheck.problems.join('; ')}`);
  }
  for (const w of nameCheck.warnings) console.log(`  warning: project name "${projectName}": ${w}`);
  if (projectName !== opts.projectName.trim()) {
    console.log(`Normalized name: ${projectName}`);
  }

  // Scope: explicit or derived.
  let scope;
  if (opts.scope) {
    const parsed = parseScopeInput(opts.scope);
    if (!parsed.ok) fail('scope-validation', parsed.error);
    scope = parsed.scope;
  } else {
    scope = deriveScope(projectName);
  }
  console.log(`Package scope: ${scope}`);

  // Destination safety.
  const destNameCheck = opts.destination
    ? validateDestinationName(path.basename(path.resolve(opts.destination)))
    : { valid: true };
  if (!destNameCheck.valid) fail('destination-validation', destNameCheck.error);
  const destRes = resolveDestination(opts.destination, TEMPLATE_ROOT, projectName, {
    preferLocalCwd: RUNNING_INSTALLED,
  });
  if (!destRes.ok) fail('destination-validation', destRes.error);
  const destRoot = destRes.path;
  console.log(`Destination: ${destRoot}`);

  const destExists = await fs.stat(destRoot).then((s) => s.isDirectory()).catch(() => false);
  if (destExists) {
    const empty = await isDirEmpty(destRoot);
    if (!empty && !opts.allowExisting) {
      fail(
        'destination-validation',
        `Destination exists and is not empty: ${destRoot}\nPass --allow-existing to write into it (existing files are never deleted), or choose another directory.`,
      );
    }
    if (!empty && opts.allowExisting) {
      console.log('  warning: writing into existing directory (no files will be deleted).');
    }
  }

  // Discover internal package suffixes from the template (not hardcoded).
  const suffixSet = new Set(await discoverInternalSuffixes(TEMPLATE_ROOT));
  // k6 is intentionally NOT a workspace member; its manifest rename is a
  // cosmetic consistency policy (see docs/SCAFFOLD.md) — include its suffix
  // so the manifest pass renames it instead of leaving a stale @repo/ key.
  suffixSet.add('k6-load-testing');
  suffixSet.add('migrate');

  const plan = [
    '',
    'Scaffold plan:',
    `  template:     ${TEMPLATE_ROOT}`,
    `  project:      ${projectName}`,
    `  scope:        ${scope}  (${suffixSet.size} internal packages)`,
    `  destination:  ${destRoot}`,
    `  install:      ${opts.skipInstall ? 'no (--skip-install)' : 'yes'}`,
    `  git:          ${opts.noGit ? 'no (--no-git)' : 'yes (fresh init)'}`,
    `  generator:    ${opts.keepScaffolder ? 'kept in output (--keep-scaffolder)' : 'removed from output'}`,
    `  validation:   ${opts.skipValidation ? 'skipped' : opts.skipBuild ? 'without build' : 'full'}`,
    '',
  ].join('\n');

  if (opts.dryRun) {
    console.log(plan);
    console.log('Dry run — no changes made.');
    console.log(`Would copy template (excluding .git/.agent/node_modules/.next/dist/build/out/coverage/.turbo/.env/live certs/credentials/logs).`);
    console.log(`Would restore npm-mangled ignore files (.gitignore) so the generated repo never commits .env or node_modules`);
    console.log(`Would rename ${suffixSet.size} internal packages: ${[...suffixSet].map((s) => `${scope}/${s}`).join(', ')}`);
    console.log(`Would transplant pnpm-lock.yaml (rename workspace importer keys only; zero resolutions edited) + copy apps/migrate/pnpm-lock.yaml verbatim`);
    console.log(`Would run: pnpm install --frozen-lockfile (root + apps/migrate)`);
    if (!opts.noGit) console.log('Would run: git init -b main (no remote, no template history)');
    console.log(`Would run validation: namespace scan, pnpm ls -r, turbo graph, typecheck, lint, guard:web-auth-imports, test${opts.skipBuild ? '' : ', build'}`);
    if (!opts.keepScaffolder) {
      console.log('Would REMOVE the generator from the output (scripts/scaffold*, docs/SCAFFOLD.md, scaffold npm scripts)');
      console.log('Would prune the generated CI + README so nothing references the removed files');
    }
    process.exit(0);
  }

  if (!opts.yes && process.stdin.isTTY) {
    const ok = await confirmPlan(plan);
    if (!ok) {
      console.log('Aborted.');
      process.exit(1);
    }
  } else {
    console.log(plan);
  }

  // Copy.
  console.log('✓ Copying template...');
  let copyStats;
  try {
    copyStats = await copyTemplate({
      srcRoot: TEMPLATE_ROOT,
      destRoot,
      dryRun: false,
      verbose: !!opts.verbose,
    });
  } catch (err) {
    fail('template-copy', err.message, destRoot);
  }
  console.log(`  copied ${copyStats.copied} files (${copyStats.dirs} dirs), excluded ${copyStats.excluded}`);

  // Restore filenames npm mangles (`.gitignore` -> `gitignore` in the tarball).
  // MUST happen before transform and long before `git add -A`: a generated
  // project without ignore rules would commit node_modules/ and a live .env.
  try {
    const { restored, alreadyPresent } = await restoreDottedFilenames(destRoot);
    if (restored.length > 0) {
      console.log(`  restored ${restored.length} npm-mangled filename(s): ${restored.join(', ')}`);
    } else if (alreadyPresent > 0) {
      console.log(`  ${alreadyPresent} ignore file(s) already present`);
    }
  } catch (err) {
    fail('filename-restore', err.message, destRoot);
  }

  // Transform.
  console.log('✓ Applying project identity...');
  try {
    const t = await transformTree({
      destRoot,
      newScope: scope,
      suffixSet,
      projectName,
      envSlug: toEnvSlug(projectName),
      displayName: toDisplayName(projectName),
      dryRun: false,
      verbose: !!opts.verbose,
    });
    console.log(`  manifests: ${t.manifestsChanged}/${t.manifests} changed; text files: ${t.textChanged} changed; env examples: ${t.envExamplesChanged}/${t.envExamples} changed`);
    // Provenance (no machine paths, no secrets).
    const provenance = {
      template: TEMPLATE_NAME,
      templateVersion: readTemplateVersion(TEMPLATE_ROOT),
      generatedAt: new Date().toISOString(),
      projectName,
      packageScope: scope,
    };
    await fs.writeFile(path.join(destRoot, '.template.json'), `${JSON.stringify(provenance, null, 2)}\n`, 'utf8');
  } catch (err) {
    fail('transformation', err.stack || err.message, destRoot);
  }

  // The generator is REMOVED by default. A business app has no use for the code
  // that generated it, nor for a guide to releasing someone else's npm package —
  // and leaving `prepack`-style hooks or a stale `pnpm scaffold` in a business
  // repo is worse than leaving nothing. `--keep-scaffolder` retains both, for
  // when the new project is itself meant to become a template.
  // Runs before `git init`, so removed files are never committed.
  if (!opts.keepScaffolder) {
    const { removeScaffolder } = await import('./scaffold/strip.mjs');
    const removed = await removeScaffolder({ destRoot, displayName: toDisplayName(projectName) });
    console.log(
      `✓ Removed generator (${removed.paths.length} path(s), ${removed.scripts.length} script(s), ` +
        `README: ${removed.rebranded} line(s) rebranded, ${removed.readmeSectionsRemoved} template-only section(s), ` +
        `${removed.readmeLinesRemoved} dangling link(s))`,
    );
    console.log('  keep it next time with --keep-scaffolder');
  }

  // Lockfile transplant + frozen install (generated outputs only).
  // See scripts/scaffold/lockfile.mjs + docs/SCAFFOLD.md for the evidence:
  // delete+regenerate floats transitive deps past the tested tree and breaks
  // the build, so the template's exact resolved tree is transplanted
  // (importer keys renamed; zero resolutions edited) and verified by pnpm.
  const pnpm = pnpmCmd();
  const needsShell = process.platform === 'win32' && pnpm.endsWith('.cmd');
  try {
    const { transplantLockfiles } = await import('./scaffold/lockfile.mjs');
    const lt = await transplantLockfiles(TEMPLATE_ROOT, destRoot, scope);
    console.log(`  transplanted lockfile (${lt.rootKeys} workspace keys renamed; migrate: ${lt.migrate})`);
  } catch (err) {
    fail('lockfile-transplant', err.stack || err.message, destRoot);
  }
  if (!opts.skipInstall) {
    console.log('✓ Installing dependencies (frozen lockfile)...');
    try {
      const install = spawnSync(pnpm, ['install', '--frozen-lockfile'], {
        cwd: destRoot,
        stdio: 'inherit',
        shell: needsShell,
      });
      if (install.status !== 0) throw new Error('pnpm install --frozen-lockfile failed (see output above).');
      // Isolated migrate workspace keeps its own lockfile (copied verbatim —
      // it contains no scope refs, so frozen install reproduces it exactly).
      const migrateDir = path.join(destRoot, 'apps', 'migrate');
      if (await fs.stat(path.join(migrateDir, 'package.json')).then(() => true).catch(() => false)) {
        console.log('  installing apps/migrate (isolated workspace, frozen)...');
        const mInstall = spawnSync(pnpm, ['install', '--frozen-lockfile'], {
          cwd: migrateDir,
          stdio: 'inherit',
          shell: needsShell,
        });
        if (mInstall.status !== 0) throw new Error('apps/migrate pnpm install --frozen-lockfile failed.');
      }
    } catch (err) {
      fail('installation', err.message, destRoot);
    }
    console.log('✓ Installed dependencies');
  } else {
    console.log('  skipped install (--skip-install); transplanted lockfiles left in place — run pnpm install --frozen-lockfile in the output.');
  }

  // Git init (fresh, no history, no remote).
  if (!opts.noGit) {
    console.log('✓ Initializing Git...');
    try {
      const init = runCapture('git', ['init', '-b', 'main'], destRoot);
      if (init.status !== 0) throw new Error(`${init.stdout}\n${init.stderr}`);
      const add = runCapture('git', ['add', '-A'], destRoot);
      if (add.status !== 0) throw new Error(`git add failed:\n${add.stdout}\n${add.stderr}`);
      const commit = runCapture('git', ['-c', 'user.name=template', '-c', 'user.email=template@localhost', 'commit', '-m', 'chore: scaffold from turbo-template'], destRoot);
      if (commit.status !== 0) throw new Error(`git commit failed:\n${commit.stdout}\n${commit.stderr}`);
    } catch (err) {
      console.error(`  warning: Git initialization failed (project is still generated): ${err.message}`);
    }
  }

  // Validation.
  //
  // Structure + namespace checks are cheap and need no `node_modules`, so they
  // run even under `--skip-install`. Previously `--skip-install` skipped
  // validation entirely, which meant a packaging regression (a missing
  // `.gitignore`, a leaked `.env`, a stale `@repo/`) could ship unnoticed.
  const wantValidation = !opts.skipValidation;
  if (wantValidation) {
    if (opts.skipInstall) {
      console.log('✓ Verifying project structure (no install performed)...');
      try {
        const checked = await validateStructure({ destRoot });
        console.log(`  ✓ structure (${checked.length} required files, ignore rules intact, no secrets present)`);
        const stale = await findStaleRepoRefs(destRoot);
        if (stale.length > 0) {
          fail(
            'validation',
            `stale @repo/ references in: ${stale.slice(0, 20).join(', ')}${stale.length > 20 ? ` (+${stale.length - 20} more)` : ''}`,
            destRoot,
          );
        }
        console.log('  ✓ no-stale-namespace');
        console.log('  validation deferred (no install; run pnpm install then pnpm lint/typecheck/test/build in the output).');
      } catch (err) {
        fail('validation', err.message, destRoot);
      }
    } else {
      console.log('✓ Validating generated project...');
      try {
        const results = await validateGenerated({
          destRoot,
          newScope: scope,
          skipBuild: !!opts.skipBuild,
          skipValidation: false,
          verbose: !!opts.verbose,
        });
        console.log(`✓ Validation passed (${results.length} checks)`);
      } catch (err) {
        fail('validation', err.message, destRoot);
      }
    }
  } else {
    console.log('  validation skipped (--skip-validation).');
  }

  console.log('\nProject created successfully.');
  console.log(`  directory:  ${destRoot}`);
  console.log(`  name:       ${projectName}`);
  console.log(`  scope:      ${scope}`);
  console.log(`  template:   ${TEMPLATE_NAME} v${readTemplateVersion(TEMPLATE_ROOT)}`);
  console.log('\nNext steps:');
  console.log(`  cd ${destRoot}`);
  console.log('  cp .env.example .env      # then fill in BETTER_AUTH_SECRET, passwords, SEED_ADMIN_*');
  console.log('  mkcert -install && mkcert -key-file nginx/certs/localhost.key \\');
  console.log('               -cert-file nginx/certs/localhost.crt localhost 127.0.0.1');
  console.log('  docker compose --profile local up -d');
  console.log('  pnpm db:generate && pnpm db:migrate:dev');
  console.log('  pnpm dev                   # https://localhost');
  console.log('\nDocs: docs/GETTING_STARTED.md · docs/GUIDE.md · docs/wiki/00-INDEX.md (AI agents: AGENTS.md)');
}

main().catch((err) => {
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});
