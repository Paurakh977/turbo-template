// docs/wiki/_meta/link-lint.mjs - deterministic CI check, no auto-rewrite.
import fs from 'node:fs';
import path from 'node:path';
const WIKI = path.join(process.cwd(), 'docs', 'wiki');
const TYPES = ['index','invariant','flow','subsystem','workflow','adr','extension','reference','research','meta'];
const STATUS = ['stable','draft','deprecated','accepted','superseded'];
const AUTH = ['normative-routing','normative-constraints','descriptive','normative-procedure','normative-history','derived','expired','meta'];
const REQ = ['title','type','status','authority','owners','sources','depends_on','guards','updated','expires','superseded-by','template'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
let fails = [];
function walk(d, out=[]) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.md')) out.push(p);
  }
  return out;
}
function parseFM(text) {
  if (!text.startsWith('---\n')) return { err: 'missing frontmatter ---' };
  const end = text.indexOf('\n---', 4);
  if (end < 0) return { err: 'missing closing ---' };
  const raw = text.slice(4, end);
  const fm = {};
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    const i = line.indexOf(':');
    if (i < 0) continue;
    const k = line.slice(0, i).trim();
    let v = line.slice(i+1).trim();
    try {
      if (v.startsWith('[')) fm[k] = JSON.parse(v.replace(/'/g, '"'));
      else if (v === 'null') fm[k] = null;
      else if (v === 'true') fm[k] = true;
      else if (v === 'false') fm[k] = false;
      else if (/^".*"$/.test(v)) fm[k] = v.slice(1, -1);
      else fm[k] = v;
    } catch { fm[k] = v; }
  }
  return { fm, body: text.slice(end+4) };
}
const files = walk(WIKI);
for (const f of files) {
  const rel = path.relative(WIKI, f).split(path.sep).join('/');
  const text = fs.readFileSync(f, 'utf8');
  const { fm, body, err } = parseFM(text);
  if (err) { fails.push(rel+': '+err); continue; }
  for (const k of REQ) if (!(k in fm)) fails.push(rel+': missing key '+k);
  if (!TYPES.includes(fm.type)) fails.push(rel+': bad type '+fm.type);
  if (!STATUS.includes(fm.status)) fails.push(rel+': bad status '+fm.status);
  if (!AUTH.includes(fm.authority)) fails.push(rel+': bad authority '+fm.authority);
  if (typeof fm.template !== 'boolean' && fm.template !== 'extended') fails.push(rel+': bad template');
  if (!DATE.test(String(fm.updated||''))) fails.push(rel+': bad updated '+fm.updated);
  if (!Array.isArray(fm.depends_on)) fails.push(rel+': depends_on not array');
  else for (const d of fm.depends_on) {
    if (typeof d !== 'string' || !d) { fails.push(rel+': bad depends_on entry'); continue; }
    const target = path.join(WIKI, d);
    if (!fs.existsSync(target)) fails.push(rel+': missing depends_on '+d);
  }
  if (String(fm.authority).startsWith('normative-')) {
    if (!Array.isArray(fm.sources) || fm.sources.length < 1) fails.push(rel+': normative needs >=1 source');
    const needGuard = fm.type !== 'index';
    if (needGuard && (!Array.isArray(fm.guards) || fm.guards.length < 1)) fails.push(rel+': normative needs >=1 guard');
  }
  if (fm.type === 'research') {
    if (!DATE.test(String(fm.expires||''))) fails.push(rel+': research needs expires YYYY-MM-DD');
    if (fm.authority !== 'expired') fails.push(rel+': research authority must be expired');
    if (fm['superseded-by'] !== null && typeof fm['superseded-by'] !== 'string') fails.push(rel+': bad superseded-by');
  } else {
    if (fm.expires !== null) fails.push(rel+': only research may have expires');
    if (fm.type !== 'adr' && fm['superseded-by'] !== null && fm['superseded-by'] !== undefined) fails.push(rel+': only adr/research may have superseded-by');
  }
  if (fm.type === 'flow') {
    if (!body.includes('## Hop table') || !body.includes('| # |')) fails.push(rel+': flow needs hop table');
  }
  if (fm.type === 'subsystem') {
    const n = (body.match(/^## \d+\./gm) || []).length;
    if (n < 14) fails.push(rel+': subsystem needs 14 sections, found '+n);
  }
  if (fm.type === 'workflow') {
    if (!/## Preconditions/i.test(body)) fails.push(rel+': workflow needs Preconditions');
    if (!/## Commands/i.test(body)) fails.push(rel+': workflow needs Commands');
    if (!/gates/i.test(body)) fails.push(rel+': workflow needs gates');
  }
  if (fm.type === 'reference') {
    const pipes = (body.match(/^\|.*\|/gm) || []).length;
    if (pipes < 2) fails.push(rel+': reference needs table');
  }
  if (fm.type === 'adr') {
    if (!/## Rejected/i.test(body)) fails.push(rel+': adr needs Rejected');
    else {
      const bullets = (body.match(/^- /gm) || []).length;
      if (bullets < 2) fails.push(rel+': adr needs >=2 rejected, found '+bullets);
    }
  }
  const ROOT = path.join(process.cwd());
  const statList = (arr) => (Array.isArray(arr) ? arr : []);
  for (const s of [...statList(fm.sources), ...statList(fm.guards)]) {
    if (typeof s !== 'string' || !s || s.includes('*') || /^https?:/.test(s)) continue;
    const clean = s.split('#')[0].replace(/:\d+.*$/, '');
    if (!clean || clean.endsWith('.md') && clean.startsWith('docs/wiki')) continue;
    const abs = path.join(ROOT, clean);
    if (!fs.existsSync(abs)) fails.push(rel+': missing source/guard path '+s);
  }
}
if (fails.length) {
  console.log('link-lint FAIL '+fails.length);
  for (const m of fails) console.log(' - '+m);
  process.exit(1);
} else {
  console.log('link-lint OK '+files.length+' files');
}
