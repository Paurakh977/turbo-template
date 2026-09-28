// k6/helpers/setup.js
// Canonical setup() helper: every suite authenticates the admin
// session ONCE in setup() — never per-VU — and aborts loudly when the
// backend is dead. Fixes the `f is not defined` ReferenceError that shipped
// in load/stress/spike/soak (template literal referenced a non-existent `f`
// instead of a suite name), which would have masked a dead backend with a
// confusing Goja stack instead of the actionable message below.
//
// Usage in a suite:
//   import { setupAdminSession } from '../helpers/setup.js';
//   export function setup() { return setupAdminSession('load'); }
import { signIn } from './auth.js';
import { USERS } from '../config.js';

export function setupAdminSession(suiteName) {
  var auth = signIn(USERS.admin.email, USERS.admin.password);
  if (!auth.success || !auth.cookie) {
    throw new Error(
      '[' + suiteName + ':setup] Admin sign-in failed - aborting (no silent public fallback)',
    );
  }
  console.log('[' + suiteName + ':setup] Admin session established successfully');
  return { cookie: auth.cookie };
}
