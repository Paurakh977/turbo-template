/**
 * Removes the scaffolder from a generated project.
 *
 * This is the DEFAULT. A business app has no use for the code that generated
 * it, and `docs/SCAFFOLD.md` is a guide to publishing *this template* as an
 * npm package — actively misleading inside someone else's business app.
 * Pass `--keep-scaffolder` to retain both, e.g. when the generated project is
 * itself meant to become a template.
 *
 * The npm-publishing tooling (`scripts/stage-template.mjs`,
 * `scripts/check-publish-contents.mjs`) is removed unconditionally by the copy
 * denylist instead — see TEMPLATE_ONLY_PATHS — because those are actively
 * harmful anywhere else: `stage-template.mjs` renames the user's own
 * `.gitignore` and `pnpm-lock.yaml`.
 *
 * Provenance is preserved: `.template.json` records what the project was
 * generated from, by which template version, and how to regenerate.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { SCAFFOLDER_PATHS, SCAFFOLDER_SCRIPTS, readTemplateVersion } from './constants.mjs';

/**
 * README lines that document the generator. Removed so the generated project's
 * docs do not advertise commands (`pnpm scaffold`) that no longer exist.
 */
const README_DROP_LINE = /^\s*pnpm scaffold\b/;

/**
 * `## ` sections that only make sense inside the template repository. A
 * generated business app has no `npx create-turbo-template-app` story to tell
 * and no npm package to release, so these are removed and replaced by a single
 * pointer at the project's own setup guide.
 */
const README_DROP_SECTIONS = [
  '## Start here',
  '## Publishing a new version (maintainer)',
  '## Quick start (working on the template itself)',
  // Describes the project as "a batteries-included monorepo template" — true of
  // its origin, wrong for the business app that now lives here.
  '## What is this?',
];

const README_REPLACEMENT = [
  '## What is this?',
  '',
  'A production-grade full-stack TypeScript monorepo: NestJS API, Next.js web',
  'app, Better Auth with RBAC and 2FA, Prisma 7 on PostgreSQL behind PgBouncer,',
  'Redis, nginx with TLS and rate limiting, and a full Grafana observability',
  'stack. Auth, rate limiting, audit logging, database access and deployment',
  'wiring are already done, tested and documented.',
  '',
  'It was generated from a template and is yours: overwrite the sample `notes`',
  'domain with your own business logic and keep the plumbing.',
  '',
  '## Getting started',
  '',
  '```bash',
  'cp .env.example .env      # fill in BETTER_AUTH_SECRET, passwords, SEED_ADMIN_*',
  'docker compose --profile local up -d',
  'pnpm db:generate && pnpm db:migrate:dev',
  'pnpm dev                   # https://localhost',
  '```',
  '',
  'Full guide: [docs/GETTING_STARTED.md](docs/GETTING_STARTED.md).',
  'Architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).',
  'Code map: [docs/CODEBASE.md](docs/CODEBASE.md).',
  'AI agents: start at [AGENTS.md](AGENTS.md) -> [docs/wiki/00-INDEX.md](docs/wiki/00-INDEX.md).',
].join('\n');

async function cleanReadme(destRoot, displayName) {
  const file = path.join(destRoot, 'README.md');
  let text;
  try {
    text = await fs.readFile(file, 'utf8');
  } catch {
    return { changed: false, removed: 0, sectionsRemoved: [] };
  }
  const lines = text.split('\n');
  const kept = [];
  const sectionsRemoved = [];
  let droppingBlock = false;
  let skipSection = false;
  let rebranded = 0;
  let titleDone = false;
  let taglineDone = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Rebrand the document title and tagline. A generated business app must not
    // introduce itself as "Template Turbo Repo" / "a monorepo template".
    if (displayName && !titleDone) {
      const h1 = /^#\s+(?!#)(.+?)\s*$/.exec(line);
      if (h1) {
        kept.push(`# ${displayName}`);
        titleDone = true;
        rebranded += 1;
        continue;
      }
    }
    if (displayName && !taglineDone && /\*\*.+\*\*/.test(line) && /\btemplate\b/i.test(line)) {
      kept.push(line.replace(/\btemplate\b/i, 'application'));
      taglineDone = true;
      rebranded += 1;
      continue;
    }

    // Section removal: drop everything from a known `## ` heading up to the
    // next heading of the same or higher level.
    if (line.startsWith('## ')) {
      skipSection = README_DROP_SECTIONS.includes(line.trim());
      if (skipSection) {
        sectionsRemoved.push(line.trim());
        continue;
      }
    }
    if (skipSection) continue;

    // Drop the "Scaffold tooling" banner and its commands.
    if (/^#\s*Scaffold tooling\s*$/.test(line)) {
      droppingBlock = true;
      continue;
    }
    if (droppingBlock) {
      if (README_DROP_LINE.test(line)) continue;
      droppingBlock = false;
    }
    // Drop the docs-table row that links the deleted guide.
    if (line.includes('docs/SCAFFOLD.md') && line.trim().startsWith('|')) continue;

    kept.push(line);
  }

  // Any residual reference to the deleted guide (e.g. inside prose).
  const before = kept.length;
  const filtered = kept.filter((l) => !l.includes('docs/SCAFFOLD.md'));
  const droppedLines = before - filtered.length;

  if (sectionsRemoved.length === 0 && droppedLines === 0 && rebranded === 0) {
    return { changed: false, removed: 0, sectionsRemoved, rebranded };
  }

  // Insert the replacement where the first removed section used to be, so the
  // README still opens with something actionable.
  const anchor = filtered.findIndex((l) => l.trim() === '## Tech Stack');
  const out = anchor === -1 ? filtered : [...filtered.slice(0, anchor), README_REPLACEMENT, '', ...filtered.slice(anchor)];

  await fs.writeFile(
    file,
    `${out.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\n+$/, '')}\n`,
    'utf8',
  );
  return { changed: true, removed: droppedLines, sectionsRemoved, rebranded };
}

export async function removeScaffolder({ destRoot, displayName }) {
  const paths = [];
  for (const rel of SCAFFOLDER_PATHS) {
    const full = path.join(destRoot, rel);
    try {
      await fs.rm(full, { recursive: true, force: true });
      paths.push(rel);
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  }

  // Drop the now-dangling npm scripts from the root manifest.
  const scripts = [];
  const manifestPath = path.join(destRoot, 'package.json');
  const raw = await fs.readFile(manifestPath, 'utf8');
  const pkg = JSON.parse(raw);
  if (pkg.scripts && typeof pkg.scripts === 'object') {
    for (const name of SCAFFOLDER_SCRIPTS) {
      if (name in pkg.scripts) {
        delete pkg.scripts[name];
        scripts.push(name);
      }
    }
  }
  if (scripts.length > 0) {
    await fs.writeFile(manifestPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
  }

  // Remove README references to the commands and the deleted guide.
  const readme = await cleanReadme(destRoot, displayName);

  // Point `.template.json` at where to get the generator back, so the removal
  // is discoverable rather than mysterious.
  const provenancePath = path.join(destRoot, '.template.json');
  try {
    const provenance = JSON.parse(await fs.readFile(provenancePath, 'utf8'));
    provenance.scaffolder = 'removed by default; re-run with --keep-scaffolder to retain it';
    provenance.regenerateWith = `npx create-turbo-template-app@${provenance.templateVersion || readTemplateVersion(destRoot)} <new-name>`;
    await fs.writeFile(provenancePath, `${JSON.stringify(provenance, null, 2)}\n`, 'utf8');
  } catch {
    // Provenance is best-effort; never fail the scaffold over it.
  }

  return { paths, scripts, readmeLinesRemoved: readme.removed, readmeSectionsRemoved: readme.sectionsRemoved.length, rebranded: readme.rebranded };
}