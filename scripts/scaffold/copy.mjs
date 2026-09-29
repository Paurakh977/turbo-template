/**
 * Safe template copy engine. Node APIs only (no bash/sed/rm/cp assumptions).
 * - Never follows symlinks (errors on encounter).
 * - Never copies secrets / build artifacts / .git (see constants.mjs).
 * - Preserves file modes (e.g. entrypoint.sh / run.sh executables).
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { isExcludedRelPath } from './constants.mjs';

function toPosix(p) {
  return p.split(path.sep).join('/');
}

export async function copyTemplate({ srcRoot, destRoot, dryRun = false, verbose = false }) {
  const stats = { copied: 0, excluded: 0, dirs: 0, excludedPaths: [], copiedPaths: [] };

  async function walk(srcDir, destDir, relDir) {
    const entries = await fs.readdir(srcDir, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = path.join(srcDir, entry.name);
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
      const relPosix = toPosix(rel);
      if (isExcludedRelPath(relPosix)) {
        stats.excluded += 1;
        if (stats.excludedPaths.length < 200) stats.excludedPaths.push(relPosix);
        if (verbose) console.log(`  skip (excluded): ${relPosix}`);
        continue;
      }
      const st = await fs.lstat(srcPath);
      if (st.isSymbolicLink()) {
        throw new Error(
          `Refusing to copy symlink: ${relPosix} (unsafe external symlink risk). Remove it or add an explicit policy.`,
        );
      }
      const destPath = path.join(destDir, entry.name);
      if (st.isDirectory()) {
        stats.dirs += 1;
        if (!dryRun) await fs.mkdir(destPath, { recursive: true });
        await walk(srcPath, destPath, rel);
      } else if (st.isFile()) {
        stats.copied += 1;
        if (stats.copiedPaths.length < 500) stats.copiedPaths.push(relPosix);
        if (!dryRun) {
          await fs.mkdir(path.dirname(destPath), { recursive: true });
          await fs.copyFile(srcPath, destPath);
          // Preserve executable bits where present.
          try {
            await fs.chmod(destPath, st.mode);
          } catch {
            // Non-fatal on platforms without POSIX modes.
          }
        }
      }
    }
  }

  if (!dryRun) await fs.mkdir(destRoot, { recursive: true });
  await walk(srcRoot, destRoot, '');
  return stats;
}
