#!/usr/bin/env node
/**
 * Staging step for `npm pack` / `npm publish`.
 *
 * npm's packlist has a hardcoded always-ignored list that silently drops two
 * files this template cannot afford to lose:
 *
 *   1. `.gitignore`  — nested copies are dropped outright; a ROOT copy survives
 *      packing but pacote RENAMES it to `.npmignore` on install
 *      (npm/cli#5756, reproduced on npm 10.9.x).
 *   2. `pnpm-lock.yaml` — unconditionally stripped from the tarball. No `files`
 *      entry overrides it: verified that neither a recursive glob nor an
 *      explicit `pnpm-lock.yaml` entry survives packing.
 *
 * Losing `.gitignore` is a security problem, not a cosmetic one: the scaffolder
 * runs `git init && git add -A && git commit` immediately after copying, so an
 * ignore-less generated project would commit `node_modules/` and a live `.env`
 * full of real credentials.
 *
 * Losing `pnpm-lock.yaml` breaks reproducibility: three Dockerfiles build with
 * `--frozen-lockfile`, and the whole transplant policy in docs/SCAFFOLD.md
 * depends on the template's exact resolved tree.
 *
 * So both are COPIED to aliases that npm tolerates, and
 * scripts/scaffold/restore.mjs renames them back on the way out. Same trick
 * create-react-app and tacks use. Verified end-to-end (pack + install) that the
 * aliases survive untouched and are NOT renamed by npm.
 *
 * Design note — copy, never move: if `npm publish` dies between prepack and
 * postpack the working tree is left with extra files, which is harmless. The
 * reverse (a missing `pnpm-lock.yaml`) would break `pnpm dev` here. Live `.env`
 * files are never read, moved, or modified.
 *
 * Usage:
 *   node scripts/stage-template.mjs           # create aliases (prepack)
 *   node scripts/stage-template.mjs --clean   # delete aliases (postpack)
 *   node scripts/stage-template.mjs --check   # report drift, change nothing
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STRIP_BLOCK_START, STRIP_BLOCK_END } from './scaffold/constants.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Re-entry guard: a nested `npm pack` (from the publish gate) must not mutate. */
const REENTRY_GUARD = 'TURBO_TEMPLATE_GATE_REENTRY';

/**
 * Real name -> npm-safe alias. `stripMarkers` files have the staging block
 * removed from the copy so the shipped template's ignore rules are clean.
 */
const ALIASES = [
  { dotted: '.gitignore', undotted: 'gitignore', stripMarkers: true },
  { dotted: 'pnpm-lock.yaml', undotted: 'pnpm-lock.template.yaml' },
  { dotted: 'apps/api/.gitignore', undotted: 'apps/api/gitignore' },
  { dotted: 'apps/web/.gitignore', undotted: 'apps/web/gitignore' },
  { dotted: 'nginx/certs/.gitignore', undotted: 'nginx/certs/gitignore' },
];



async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/** Remove the marked staging block so generated projects get clean ignore rules. */
function stripStagingBlock(content) {
  const lines = content.split('\n');
  const out = [];
  let inside = false;
  for (const line of lines) {
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
  // Collapse the blank-line run the removed block leaves behind.
  return `${out.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\n+$/, '')}\n`;
}

async function stage() {
  const created = [];
  const skipped = [];
  for (const { dotted, undotted, stripMarkers } of ALIASES) {
    const from = path.join(ROOT, dotted);
    const to = path.join(ROOT, undotted);
    if (!(await exists(from))) {
      skipped.push(dotted);
      continue;
    }
    const content = await fs.readFile(from, 'utf8');
    await fs.writeFile(to, stripMarkers ? stripStagingBlock(content) : content, 'utf8');
    created.push(`${dotted} -> ${undotted}`);
  }
  console.log(`[stage-template] staged ${created.length} npm-safe alias(es):`);
  for (const line of created) console.log(`  + ${line}`);
  if (skipped.length) console.log(`[stage-template] skipped (absent): ${skipped.join(', ')}`);
  return { created, skipped };
}

async function clean() {
  const removed = [];
  for (const { undotted } of ALIASES) {
    const to = path.join(ROOT, undotted);
    if (!(await exists(to))) continue;
    await fs.rm(to);
    removed.push(undotted);
  }
  console.log(`[stage-template] removed ${removed.length} alias(es): ${removed.join(', ') || '(none)'}`);
  return removed;
}

/** Report aliases left behind by an interrupted publish, without changing state. */
async function check() {
  const stale = [];
  for (const { undotted } of ALIASES) {
    if (await exists(path.join(ROOT, undotted))) stale.push(undotted);
  }
  if (stale.length === 0) {
    console.log('[stage-template] OK — no staging aliases present.');
    return 0;
  }
  console.error('[stage-template] STALE aliases present (an interrupted publish?):');
  for (const s of stale) console.error(`  ! ${s}`);
  console.error('  Run: node scripts/stage-template.mjs --clean');
  return 1;
}

async function main() {
  // A nested `npm pack --dry-run` triggered by the publish gate re-runs
  // prepack. The outer invocation owns the filesystem state; do nothing here
  // or the aliases would vanish mid-publish.
  if (process.env[REENTRY_GUARD] === '1') {
    console.log('[stage-template] re-entrant invocation (nested pack) — no changes made');
    return;
  }
  if (process.argv.includes('--check')) process.exit(await check());
  if (process.argv.includes('--clean')) await clean();
  else await stage();
}

main().catch((err) => {
  console.error('[stage-template] failed:', err?.message || err);
  process.exit(1);
});