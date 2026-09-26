import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * P1-4 regression: `audit_queue_depth` is a GLOBAL gauge — every API worker
 * counts the same audit_outbox PENDING rows and exports the identical value
 * with only per-worker instance labels differing. Aggregating it with
 * `sum by (job)` multiplies the true depth by the worker count
 * (4 workers x 150 = 600 false fire at a 500 threshold).
 *
 * Counters and rates (additive per-worker series) must stay summed; only
 * this replicated gauge must use `max by (job)`.
 */
describe('prometheus alert aggregation for replicated gauges (P1-4)', () => {
  const alertsDir = path.resolve(
    __dirname,
    '..',
    '..',
    '..',
    '..',
    '..',
    'observability',
    'prometheus',
    'alerts',
  );
  const databaseYml = fs.readFileSync(
    path.join(alertsDir, 'database.yml'),
    'utf8',
  );

  it('aggregates audit_queue_depth with max, never sum', () => {
    expect(databaseYml).toContain('max by (job) (audit_queue_depth');
    expect(databaseYml).not.toContain('sum by (job) (audit_queue_depth');
  });

  it('keeps additive pool-waiting series summed', () => {
    // db_pool_waiting_requests is per-worker queue length: independent work
    // per worker, so the fleet-wide total IS the meaningful signal.
    expect(databaseYml).toContain(
      'sum by (job) (db_pool_waiting_requests',
    );
  });
});
