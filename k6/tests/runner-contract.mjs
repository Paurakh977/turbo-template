// k6/tests/runner-contract.mjs — P1-5 regression contract for k6/run.ps1 +
// k6/run.sh (run with `pnpm k6:runner:test`, plain node, no deps).
//
// Pins the cross-runner contract so the two runners cannot silently fork:
// suite mapping, canonical SUMMARY_PATH under k6/results, Docker localhost
// mapping, and secret-safe env passthrough (values with spaces/!/& stay one
// argv element). Structural checks read the actual runner sources.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';

const K6_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ps1 = readFileSync(path.join(K6_DIR, 'run.ps1'), 'utf8');
const sh = readFileSync(path.join(K6_DIR, 'run.sh'), 'utf8');

let passed = 0;
function check(name, cond) {
  assert.ok(cond, `FAILED: ${name}`);
  passed += 1;
  console.log(`ok - ${name}`);
}

// 1. Suite mapping identical in both runners (incl. explicit edge-cases).
for (const suite of ['smoke', 'load', 'stress', 'spike', 'soak', 'capacity']) {
  check(`ps1 maps ${suite}`, ps1.includes(`"${suite}"`) && ps1.includes(`suites/${suite}.js`));
  check(`sh maps ${suite}`, sh.includes(`suites/${suite}.js`));
}
check('ps1 explicit edge-cases case', ps1.includes('"edge-cases"') && ps1.includes('suites/edge-cases.js'));
check('sh edge|edge-cases alias', sh.includes('edge|edge-cases') && sh.includes('suites/edge-cases.js'));

// 2. No string-built command execution (comments stripped: the header
// documents the absence of Invoke-Expression).
const ps1Code = ps1
  .replace(/<#[\s\S]*?#>/g, '')
  .split('\n')
  .filter((l) => !l.trimStart().startsWith('#'))
  .join('\n');
check('ps1 has no Invoke-Expression', !ps1Code.includes('Invoke-Expression'));
check('ps1 executes via call operator arrays', ps1.includes('& k6 @k6Args') && ps1.includes('& docker @dockerArgs'));
check('sh has no eval of values', !/eval\s+"[^"]*\$\{?v/.test(sh) || sh.includes('eval "v=${$n:-}"'));
check('sh executes via "$@" arrays', sh.includes('k6 "$@"') && sh.includes('docker "$@"'));

// 3. No --network host anywhere (code only; headers document its removal).
const shCode = sh
  .split('\n')
  .filter((l) => !l.trimStart().startsWith('#'))
  .join('\n');
check('ps1 has no --network host', !ps1Code.includes('--network host'));
check('sh has no --network host', !shCode.includes('--network host'));
check('ps1 uses host.docker.internal:host-gateway', ps1.includes('host.docker.internal:host-gateway'));
check('sh uses host.docker.internal:host-gateway', sh.includes('host.docker.internal:host-gateway'));

// 4. Docker localhost mapping in both runners.
check('ps1 maps localhost for Docker', ps1.includes("host.docker.internal") && ps1.includes('127\\.0\\.0\\.1'));
check('sh maps localhost for Docker', sh.includes('host.docker.internal'));

// 5. SUMMARY_PATH canonical: native absolute under k6/results (forward
// slashes), Docker /results/<suite>.summary.json — matching what
// helpers/summary.js writes verbatim and benchmark-report.mjs reads.
check('ps1 SUMMARY_PATH forward-slash normalized', ps1.includes("-replace '\\\\', '/'"));
check('ps1 Docker SUMMARY_PATH=/results/', ps1.includes('SUMMARY_PATH=/results/$summaryName'));
check('sh Docker SUMMARY_PATH=/results/', sh.includes('SUMMARY_PATH=/results/$SUMMARY_NAME'));
check('sh native SUMMARY_PATH under RESULTS_DIR', sh.includes('SUMMARY_PATH=$RESULTS_DIR/$SUMMARY_NAME'));

// 6. Env passthrough preserves secrets verbatim (array/pair semantics).
check('ps1 env pairs as "-e", "NAME=value" array elements', ps1.includes(`@('-e', "$n=$v")`));
check('sh env pairs via set -- -e "NAME=value"', sh.includes('set -- "$@" -e "$n=$v"'));

// 7. Pinned k6 image identical.
const ps1Image = ps1.match(/\$K6_IMAGE\s*=\s*"([^"]+)"/)?.[1];
const shImage = sh.match(/K6_IMAGE:?-?=?["']?\$\{K6_IMAGE:-([^}"']+)/)?.[1];
check('k6 image pinned identically', Boolean(ps1Image) && ps1Image === shImage);

// 8. sh entrypoint scripts exist in package.json.
const pkg = JSON.parse(readFileSync(path.join(K6_DIR, '..', 'package.json'), 'utf8'));
for (const s of ['smoke', 'load', 'stress', 'spike', 'soak', 'capacity', 'edge']) {
  check(`package.json k6:${s}:sh`, pkg.scripts[`k6:${s}:sh`]?.includes('k6/run.sh'));
}
check('run.sh exists', existsSync(path.join(K6_DIR, 'run.sh')));

console.log(`\nrunner-contract: ${passed} checks passed`);
