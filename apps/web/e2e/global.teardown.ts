import { runCleanup } from './scripts/cleanup';

export default async function globalTeardown() {
  await runCleanup();
}
