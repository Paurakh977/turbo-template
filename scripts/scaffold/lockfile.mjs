/**
 * Lockfile transplant (NOT regeneration, NOT hand-editing resolutions).
 *
 * Evidence (see docs/SCAFFOLD.md): deleting the lockfile and running a fresh
 * `pnpm install` floats TRANSITIVE deps past the template's tested tree
 * (observed: zod 4.4.3→4.6.5 breaks the api build with 6 BetterAuth type
 * errors; jest 30.4.2→30.5.2 pulls @parcel/watcher which trips
 * ERR_PNPM_IGNORED_BUILDS). The generated project must reproduce the
 * template's exact resolved tree.
 *
 * Method: copy the template's pnpm-lock.yaml and rename ONLY importer
 * dependency keys `'@repo/x':` → `'@scope/x':`. Nothing else is touched:
 * - `link:` versions are scope-independent relative paths (unchanged).
 * - `snapshots:` contain no workspace entries (link: deps aren't snapshotted).
 * - `catalogs:` / `patchedDependencies` / `settings` contain no scope.
 * Afterwards `pnpm install --frozen-lockfile` verifies the transplanted
 * lockfile against the renamed manifests and installs the exact tree.
 * No resolved version, integrity hash, or snapshot is ever hand-edited.
 *
 * apps/migrate's lockfile contains zero `@repo` refs (its importers are keyed
 * by filesystem path, not package name), so it is copied byte-identical.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { TEMPLATE_SCOPE } from './constants.mjs';

const KEY_PREFIX = `'${TEMPLATE_SCOPE}/`;

export async function transplantLockfiles(templateRoot, destRoot, newScope) {
  const stats = { rootKeys: 0, migrate: 'copied-unchanged' };

  // Root lockfile: scoped key rewrite only.
  const src = await fs.readFile(path.join(templateRoot, 'pnpm-lock.yaml'), 'utf8');
  let count = 0;
  let idx = src.indexOf(KEY_PREFIX);
  while (idx !== -1) {
    count += 1;
    idx = src.indexOf(KEY_PREFIX, idx + KEY_PREFIX.length);
  }
  if (count === 0) {
    throw new Error('template pnpm-lock.yaml contains no workspace importer keys — refusing to transplant');
  }
  const transplanted = src.split(KEY_PREFIX).join(`'${newScope}/`);
  // Safety: after rewrite, no scope-prefixed key may remain outside snapshots
  // (snapshots never contain workspace entries, verified at implementation).
  if (transplanted.includes(KEY_PREFIX)) {
    throw new Error('lockfile transplant incomplete: stale scope keys remain');
  }
  await fs.writeFile(path.join(destRoot, 'pnpm-lock.yaml'), transplanted, 'utf8');
  stats.rootKeys = count;

  // Migrate lockfile: must contain zero scope refs; copied verbatim by the
  // copy step, verified here.
  const migrateLock = path.join(destRoot, 'apps', 'migrate', 'pnpm-lock.yaml');
  try {
    const migrateRaw = await fs.readFile(migrateLock, 'utf8');
    if (migrateRaw.includes(`${TEMPLATE_SCOPE}/`) || migrateRaw.includes(`${TEMPLATE_SCOPE}\\`)) {
      throw new Error('apps/migrate/pnpm-lock.yaml unexpectedly references the template scope');
    }
  } catch (err) {
    if (err.code === 'ENOENT') {
      stats.migrate = 'absent (migrate excluded or not present)';
    } else {
      throw err;
    }
  }
  return stats;
}
