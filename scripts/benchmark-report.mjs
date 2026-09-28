// scripts/benchmark-report.mjs
// Aggregates k6 JSON summaries (k6/results/*.summary.json, written by every
// suite via helpers/summary.js handleSummary) into a markdown comparison
// table for the Phase 9 report. Usage: node scripts/benchmark-report.mjs
// [resultsDir] — prints markdown to stdout.
import fs from 'node:fs';
import path from 'node:path';

const dir = process.argv[2] ?? path.join(process.cwd(), 'k6', 'results');
let files = [];
try {
  files = fs.readdirSync(dir).filter((f) => f.endsWith('.summary.json'));
} catch {
  console.log('No results in ' + dir + ' (run k6/run.ps1 <suite> first).');
  process.exit(0);
}
if (files.length === 0) {
  console.log('No results in ' + dir + ' (run k6/run.ps1 <suite> first).');
  process.exit(0);
}
const rows = files.map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
rows.sort((a, b) => String(a.suite).localeCompare(String(b.suite)));
const fmt = (v, d = 1) => (typeof v === 'number' ? v.toFixed(d) : 'n/a');
console.log('| suite | checks | p95 (ms) | p99 (ms) | failed rate | reqs | dropped |');
console.log('| --- | --- | --- | --- | --- | --- | --- |');
for (const r of rows) {
  console.log(
    '| ' + r.suite + ' | ' + fmt(r.checksRate, 4) + ' | ' + fmt(r.httpReqDurationP95Ms) +
    ' | ' + fmt(r.httpReqDurationP99Ms) + ' | ' + fmt(r.httpReqFailedRate, 4) +
    ' | ' + (r.httpReqsCount ?? 'n/a') + ' | ' + (r.droppedIterations ?? 'n/a') + ' |',
  );
}
