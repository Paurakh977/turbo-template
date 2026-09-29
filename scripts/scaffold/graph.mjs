/**
 * Workspace package-graph helpers. Derives internal package identities from
 * manifests (no fragile hardcoded list in the hot path; the canonical suffix
 * list in cli help is derived from the same discovery).
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';

/** Read all workspace package names (apps/* + packages/* manifests). */
export async function readWorkspaceNames(destRoot) {
  const names = new Map(); // name -> rel manifest dir
  for (const dir of ['apps', 'packages']) {
    let entries = [];
    try {
      entries = await fs.readdir(path.join(destRoot, dir), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const manifest = path.join(destRoot, dir, e.name, 'package.json');
      try {
        const json = JSON.parse(await fs.readFile(manifest, 'utf8'));
        if (typeof json.name === 'string') names.set(json.name, `${dir}/${e.name}`);
      } catch {
        // No manifest (e.g. plain asset dir) — not a workspace package.
      }
    }
  }
  try {
    const root = JSON.parse(await fs.readFile(path.join(destRoot, 'package.json'), 'utf8'));
    if (typeof root.name === 'string') names.set(root.name, '.');
  } catch { /* ignore */ }
  return names;
}

/**
 * Detect dangling internal deps: any dependency key starting with `@<scope>/`
 * (for the detected scope) that has no corresponding workspace package, plus
 * any leftover `@repo/` keys (missed rename fails loudly).
 */
export async function checkDangling(destRoot, workspaceNames) {
  const problems = [];
  const scopes = new Set();
  for (const name of workspaceNames.keys()) {
    if (name.startsWith('@')) scopes.add(name.split('/')[0]);
  }

  async function checkManifest(manifestPath, rel) {
    let json;
    try {
      json = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    } catch {
      return;
    }
    for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
      const deps = json[field];
      if (!deps || typeof deps !== 'object') continue;
      for (const [key, value] of Object.entries(deps)) {
        if (key.startsWith('@repo/')) {
          problems.push(`${rel}: stale @repo dep "${key}" in ${field}`);
          continue;
        }
        if (key.startsWith('@') && String(value).startsWith('workspace:')) {
          if (!workspaceNames.has(key)) {
            problems.push(`${rel}: dangling workspace dep "${key}" in ${field}`);
          }
        }
      }
    }
    if (typeof json.name === 'string' && json.name.startsWith('@repo/')) {
      problems.push(`${rel}: stale package name "${json.name}"`);
    }
  }

  async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(destRoot, full);
      if (rel.startsWith('node_modules') || rel.startsWith('.git')) continue;
      if (entry.isDirectory()) {
        if (['node_modules', '.git', '.next', 'dist', 'build', '.turbo'].includes(entry.name)) continue;
        await walk(full);
      } else if (entry.isFile() && entry.name === 'package.json') {
        await checkManifest(full, path.dirname(rel));
      }
    }
  }

  await walk(destRoot);
  return problems;
}
