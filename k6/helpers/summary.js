// k6/helpers/summary.js
// Shared handleSummary factory: every suite exports
// `handleSummary = makeHandleSummary('<suite>')` so runs ALWAYS produce a
// machine-readable JSON file (SUMMARY_PATH or results/<suite>.summary.json)
// plus a compact stdout block. benchmark-report.mjs aggregates the JSON
// files into the comparison table - no console scraping.
//
// Fully offline (no jslib imports): the stdout block prints the gates that
// matter (checks rate, p95/p99, 5xx count, 429 count, dropped iterations).
function pick(metrics, name) {
  var m = metrics[name];
  return m ? m.values : null;
}

function rateOf(values, key) {
  if (!values) return null;
  return typeof values[key] === 'number' ? values[key] : null;
}

export function summaryPath(suite) {
  return __ENV.SUMMARY_PATH || ('results/' + suite + '.summary.json');
}

export function summarize(suite, data) {
  var checks = pick(data.metrics, 'checks');
  var duration = pick(data.metrics, 'http_req_duration');
  var failed = pick(data.metrics, 'http_req_failed');
  var dropped = pick(data.metrics, 'dropped_iterations');
  var reqs = pick(data.metrics, 'http_reqs');
  return {
    suite: suite,
    checksRate: rateOf(checks, 'rate'),
    checksPasses: rateOf(checks, 'passes'),
    checksFails: rateOf(checks, 'fails'),
    httpReqDurationP95Ms: rateOf(duration, 'p(95)'),
    httpReqDurationP99Ms: rateOf(duration, 'p(99)'),
    httpReqFailedRate: rateOf(failed, 'rate'),
    httpReqsCount: rateOf(reqs, 'count'),
    droppedIterations: rateOf(dropped, 'count'),
    thresholds: data.thresholds || null,
  };
}

export function compactText(suite, summary) {
  var lines = [];
  lines.push('[' + suite + '] checks rate=' + summary.checksRate);
  lines.push(
    '[' + suite + '] p95=' + summary.httpReqDurationP95Ms + 'ms p99=' + summary.httpReqDurationP99Ms + 'ms',
  );
  lines.push(
    '[' + suite + '] failed_rate=' + summary.httpReqFailedRate + ' reqs=' + summary.httpReqsCount,
  );
  lines.push('[' + suite + '] dropped_iterations=' + summary.droppedIterations);
  return lines.join('\n') + '\n';
}

export function makeHandleSummary(suite) {
  return function handleSummary(data) {
    var summary = summarize(suite, data);
    var out = {};
    out[summaryPath(suite)] = JSON.stringify(summary, null, 1);
    out.stdout = compactText(suite, summary);
    return out;
  };
}
