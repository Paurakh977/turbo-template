import { flushAll } from '../helpers/redis.helper';
import { truncateAll, closePool } from '../helpers/database.helper';
import { fileURLToPath } from 'node:url';
import { realpathSync } from 'node:fs';

export async function runCleanup() {
  await truncateAll();
  await flushAll();
  await closePool();
  // eslint-disable-next-line no-console
  console.log('E2E cleanup complete.');
}

const isMain =
  process.argv[1] &&
  realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  runCleanup().catch(async (err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    await closePool().catch(() => {});
    process.exit(1);
  });
}
