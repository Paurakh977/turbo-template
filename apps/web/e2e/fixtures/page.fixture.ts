import { test as base } from './auth.fixture';

/**
 * Top-level fixture: page objects are instantiated inline in tests using the
 * `page` fixture (already authenticated via project storageState). This module
 * simply re-exports the composed `test`/`expect` so specs import a single source.
 */
export const test = base;
export const expect = base.expect;
