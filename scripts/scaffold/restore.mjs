/**
 * Restores filenames that npm mangles or refuses to publish.
 *
 * npm's packlist treats `.gitignore` as an ignore-ruleset, not as content:
 *   - a nested `.gitignore` is dropped from the tarball entirely;
 *   - a root `.gitignore` survives packing but pacote RENAMES it to
 *     `.npmignore` when the tarball is installed (npm/cli#5756, still
 *     reproducible on npm 10.9.x).
 *
 * Both outcomes would leave a generated project with no ignore rules at all.
 * Because the scaffolder runs `git init && git add -A && git commit` right
 * after copying, that would commit `node_modules/`, `.env` (live credentials),
 * `dist/`, `.turbo/` and every other artifact.
 *
 * The workaround (used by create-react-app and tacks) is to ship these files
 * undotted and rename them back on copy. `scripts/stage-template.mjs` creates
 * the undotted aliases at prepack time; this module undoes that after copying.
 *
 * Idempotent: when running `pnpm scaffold` from a git checkout the dotted
 * files are already present and no alias exists, so this is a no-op.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { UNDOTTED_ALIASES, STRIP_BLOCK_START, STRIP_BLOCK_END } from './constants.mjs';

/** Directory names never walked when looking for aliases. */
const SKIP_DIRS = new Set(['node_modules', '.git', '.next', 'dist', 'build', '.turbo', 'coverage']);

const UNDOTTED_SET = new Set(UNDOTTED_ALIASES.map((a) => a.undotted));

/**
 * Remove the marked publish-staging block from an ignore file.
 *
 * The block tells git to ignore the aliases `scripts/stage-template.mjs`
 * creates at prepack time. It is stripped from the copies that ship so a
 * generated project receives clean rules — and it is stripped HERE as well, so
 * the result is identical whether the template came from a git checkout (where
 * `.gitignore` is the real file) or from an npm tarball (where it arrives as the
 * `gitignore` alias).
 */
export function stripStagingBlock(content) {
  if (!content.includes(STRIP_BLOCK_START)) return content;
  const out = [];
  let inside = false;
  for (const line of content.split('\n')) {
    if (line.startsWith(STRIP_BLOCK_START)) {
      inside = true;
      continue;
    }
    if (line.startsWith(STRIP_BLOCK_END)) {
      inside = false;
      continue;
    }
    if (!inside) out.push(line);
  }
  return `${out.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\n+$/, '')}\n`;
}

/**
 * Rename every `<dir>/<undotted>` back to `<dir>/.<dotted>`, then normalize the
 * resulting ignore files.
 * @returns {{ restored: string[], alreadyPresent: number, normalized: string[] }}
 */
export async function restoreDottedFilenames(destRoot) {
  const restored = [];
  const normalized = [];
  let alreadyPresent = 0;

  async function walk(dir) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        await walk(full);
        continue;
      }
      if (!entry.isFile()) continue;

      if (UNDOTTED_SET.has(entry.name)) {
        const alias = UNDOTTED_ALIASES.find((a) => a.undotted === entry.name);
        const target = path.join(dir, alias.dotted);
        // Both present: the dotted copy is authoritative (a git checkout that
        // also carries a leftover alias). Never clobber it.
        if (await exists(target)) {
          alreadyPresent += 1;
        } else {
          await fs.rename(full, target);
          restored.push(path.relative(destRoot, target).split(path.sep).join('/'));
        }
        continue;
      }

      if (entry.name === '.gitignore') {
        const raw = await fs.readFile(full, 'utf8');
        const cleaned = stripStagingBlock(raw);
        if (cleaned !== raw) {
          await fs.writeFile(full, cleaned, 'utf8');
          normalized.push(path.relative(destRoot, full).split(path.sep).join('/'));
        }
      }
    }
  }

  await walk(destRoot);
  return { restored: restored.sort(), alreadyPresent, normalized: normalized.sort() };
}

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}