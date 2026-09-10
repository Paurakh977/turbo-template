import { config } from 'dotenv';
import { resolve } from 'node:path';

const root = resolve(process.cwd(), '../../.env');
config({ path: root });

// k6 load-testing overrides: when K6_TESTING=true, layer .env.k6 on top.
if (process.env.K6_TESTING === 'true') {
  config({ path: resolve(process.cwd(), '../../.env.k6'), override: true });
}
