/**
 * Deliberate transformation system.
 *
 * - package.json: parsed as JSON; renames `name` + dependency keys in
 *   dependencies/devDependencies/peerDependencies/optionalDependencies.
 *   Preserves `workspace:*` vs `workspace:^` values verbatim.
 * - Text files: controlled `@repo/` -> `@<scope>/` replacement (plus escaped
 *   `@repo\/` for JS regex literals) ONLY in allowlisted text files, skipping
 *   `.agents/`, lockfiles, binaries, and preserving OTel identity strings.
 * - Root package.json `name` (my-turborepo) -> normalized project name.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  TEMPLATE_SCOPE,
  TEMPLATE_ROOT_NAME,
  NEVER_TRANSFORM_PREFIXES,
  LOCKFILE_NAMES,
  OTEL_PRESERVE_FILES,
  isTextTransformable,
} from './constants.mjs';

function toPosix(p) {
  return p.split(path.sep).join('/');
}

function isNeverTransform(relPosix) {
  return NEVER_TRANSFORM_PREFIXES.some((prefix) => relPosix.startsWith(prefix));
}

function isLockfile(relPosix) {
  return LOCKFILE_NAMES.has(relPosix.split('/').pop());
}

function isBinaryLike(buffer) {
  // NUL byte heuristic; lockfiles/package.json are UTF-8 JSON/YAML.
  const len = Math.min(buffer.length, 8000);
  for (let i = 0; i < len; i++) {
    if (buffer[i] === 0) return true;
  }
  return false;
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Discover internal `@repo/*` suffixes from workspace manifests. */
export async function discoverInternalSuffixes(templateRoot) {
  const suffixes = new Set();
  const candidates = [];
  for (const dir of ['apps', 'packages']) {
    let entries = [];
    try {
      entries = await fs.readdir(path.join(templateRoot, dir), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.isDirectory() || e.isFile()) {
        candidates.push(path.join(templateRoot, dir, e.name, 'package.json'));
      }
    }
  }
  // Root manifest too (may reference internals, though its own name is unscoped).
  candidates.push(path.join(templateRoot, 'package.json'));
  // k6 manifest handled as cosmetic policy (see below), not via discovery.

  for (const file of candidates) {
    let json;
    try {
      json = JSON.parse(await fs.readFile(file, 'utf8'));
    } catch {
      continue;
    }
    const names = [];
    if (typeof json.name === 'string') names.push(json.name);
    for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
      const deps = json[field];
      if (deps && typeof deps === 'object') {
        for (const key of Object.keys(deps)) names.push(key);
      }
    }
    for (const n of names) {
      if (n.startsWith(`${TEMPLATE_SCOPE}/`)) {
        suffixes.add(n.slice(TEMPLATE_SCOPE.length + 1));
      }
    }
  }
  return [...suffixes].sort();
}

function renameDepKey(key, newScope, suffixSet) {
  if (!key.startsWith(`${TEMPLATE_SCOPE}/`)) return key;
  const suffix = key.slice(TEMPLATE_SCOPE.length + 1);
  // Only rename known internal suffixes; unknown `@repo/*` keys are left for
  // the text pass + package-graph validation to catch (fail loudly, not silently).
  if (!suffixSet.has(suffix)) return key;
  return `${newScope}/${suffix}`;
}

function transformManifestObject(json, { newScope, suffixSet, projectName, isRoot }) {
  let changed = false;
  const out = { ...json };

  if (typeof out.name === 'string') {
    if (isRoot && out.name === TEMPLATE_ROOT_NAME) {
      out.name = projectName;
      changed = true;
    } else if (out.name.startsWith(`${TEMPLATE_SCOPE}/`)) {
      const suffix = out.name.slice(TEMPLATE_SCOPE.length + 1);
      if (suffixSet.has(suffix) || out.name === `${TEMPLATE_SCOPE}/migrate` || out.name === `${TEMPLATE_SCOPE}/k6-load-testing`) {
        out.name = `${newScope}/${suffix}`;
        changed = true;
      }
    }
  }

  for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    const deps = out[field];
    if (deps && typeof deps === 'object' && !Array.isArray(deps)) {
      const next = {};
      for (const [key, value] of Object.entries(deps)) {
        const renamed = renameDepKey(key, newScope, suffixSet);
        if (renamed !== key) changed = true;
        next[renamed] = value; // value (workspace:*/^, catalog:) preserved verbatim
      }
      out[field] = next;
    }
  }
  return { json: out, changed };
}

/**
 * Controlled text replacement for one file's content.
 * Protects OTel identity strings in the two observability files.
 */
export function transformTextContent(content, { newScope, relPosix }) {
  const oldToken = `${TEMPLATE_SCOPE}/`; // "@repo/"
  const newToken = `${newScope}/`;
  const oldEscaped = `${TEMPLATE_SCOPE}\\/`; // "@repo\/" inside JS regex literals
  const newEscaped = `${newScope}\\/`;

  // Protect OTel identity strings: temporarily swap them out, replace the
  // rest, then restore verbatim.
  const protections = [];
  let working = content;
  if (OTEL_PRESERVE_FILES.has(relPosix)) {
    const otelLiterals = [`'${TEMPLATE_SCOPE}/observability'`, `"${TEMPLATE_SCOPE}/observability"`];
    for (const lit of otelLiterals) {
      const placeholder = `\u0000OTEL${protections.length}\u0000`;
      if (working.includes(lit)) {
        protections.push({ placeholder, original: lit });
        working = working.split(lit).join(placeholder);
      }
    }
  }

  let changed = false;
  if (working.includes(oldEscaped)) {
    working = working.split(oldEscaped).join(newEscaped);
    changed = true;
  }
  // `@repo/` (package refs) AND bare `@repo` (e.g. Docker
  // `mkdir -p /rt/node_modules/@repo`). Lookahead prevents matching
  // `@repository`, `@repo-foo`, etc.
  const barePattern = new RegExp(`${escapeRegExp(TEMPLATE_SCOPE)}(?=/|['"\\s]|$)`, 'g');
  if (barePattern.test(working)) {
    barePattern.lastIndex = 0;
    working = working.replace(barePattern, newScope);
    changed = true;
  }

  for (const { placeholder, original } of protections) {
    working = working.split(placeholder).join(original);
  }
  // If the ONLY occurrences were protected OTel strings, report unchanged.
  if (!changed) return { content, changed: false };
  return { content: working, changed };
}

export async function transformTree({ destRoot, newScope, suffixSet, projectName, dryRun = false, verbose = false }) {
  const stats = {
    manifests: 0,
    manifestsChanged: 0,
    textFiles: 0,
    textChanged: 0,
    skippedNeverTransform: 0,
    skippedLockfile: 0,
    skippedBinary: 0,
    changedPaths: [],
  };

  async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        // Skip generated / install output inside the copy (shouldn't exist,
        // but be safe if --allow-existing pointed at a dirty dir).
        if (['node_modules', '.git', '.next', 'dist', 'build', '.turbo', 'coverage'].includes(entry.name)) continue;
        await walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const relPosix = toPosix(path.relative(destRoot, full));
      if (isNeverTransform(relPosix)) {
        stats.skippedNeverTransform += 1;
        continue;
      }
      if (isLockfile(relPosix)) {
        stats.skippedLockfile += 1;
        continue;
      }
      const base = entry.name;
      if (base === 'package.json') {
        stats.manifests += 1;
        const raw = await fs.readFile(full, 'utf8');
        let json;
        try {
          json = JSON.parse(raw);
        } catch (err) {
          throw new Error(`Invalid JSON in ${relPosix}: ${err.message}`);
        }
        const isRoot = toPosix(path.relative(destRoot, full)) === 'package.json';
        const { json: next, changed } = transformManifestObject(json, {
          newScope,
          suffixSet,
          projectName,
          isRoot,
        });
        if (changed) {
          stats.manifestsChanged += 1;
          if (stats.changedPaths.length < 500) stats.changedPaths.push(relPosix);
          if (!dryRun) {
            await fs.writeFile(full, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
          }
          if (verbose) console.log(`  manifest: ${relPosix}`);
        }
        continue;
      }
      if (!isTextTransformable(relPosix)) continue;
      const buffer = await fs.readFile(full);
      if (isBinaryLike(buffer)) {
        stats.skippedBinary += 1;
        continue;
      }
      const content = buffer.toString('utf8');
      if (
        !content.includes(`${TEMPLATE_SCOPE}/`) &&
        !content.includes(`${TEMPLATE_SCOPE}\\/`) &&
        !new RegExp(`${escapeRegExp(TEMPLATE_SCOPE)}(?=/|['"\\s]|$)`).test(content)
      )
        continue;
      stats.textFiles += 1;
      const { content: next, changed } = transformTextContent(content, { newScope, relPosix });
      if (changed) {
        stats.textChanged += 1;
        if (stats.changedPaths.length < 500) stats.changedPaths.push(relPosix);
        if (!dryRun) await fs.writeFile(full, next, 'utf8');
        if (verbose) console.log(`  text: ${relPosix}`);
      }
    }
  }

  await walk(destRoot);
  return stats;
}

/** Scan generated tree for leftover `@repo/` outside the documented allowlist. */
export async function findStaleRepoRefs(destRoot) {
  const stale = [];

  async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const relPosix = toPosix(path.relative(destRoot, full));
      if (relPosix.startsWith('.agents/')) continue; // vendored illustrative
      if (entry.isDirectory()) {
        // Installed / generated trees are never scanned (third-party code
        // legitimately contains lookalike scopes, e.g. radix-ui's own
        // `@repo/*` devDeps inside nested node_modules).
        if (['node_modules', '.git', '.next', 'dist', 'build', '.turbo', 'coverage'].includes(entry.name)) {
          continue;
        }
        await walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      if (isLockfile(relPosix)) continue; // regenerated; checked separately
      const buffer = await fs.readFile(full);
      if (isBinaryLike(buffer)) continue;
      const text = buffer.toString('utf8');
      // Check plain, JS-escaped, and bare-scope forms.
      const stalePattern = new RegExp(`${escapeRegExp(TEMPLATE_SCOPE)}(?=/|\\\\/|['"\\s]|$)`);
      if (stalePattern.test(text)) {
        // OTel preserve files: only flag if refs exist OUTSIDE the two
        // documented identity strings.
        if (OTEL_PRESERVE_FILES.has(relPosix)) {
          const stripped = text
            .split(`'${TEMPLATE_SCOPE}/observability'`).join('')
            .split(`"${TEMPLATE_SCOPE}/observability"`).join('');
          stalePattern.lastIndex = 0;
          if (!stalePattern.test(stripped)) {
            continue; // only the allowlisted identity strings remain
          }
        }
        stale.push(relPosix);
      }
    }
  }
  await walk(destRoot);
  return stale.sort();
}
