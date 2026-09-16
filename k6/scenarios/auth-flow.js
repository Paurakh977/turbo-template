// k6/scenarios/auth-flow.js
// Tests Better Auth authentication, sessions, role resolution, and security defenses.
// When called with an existing cookie (from setup()), skips fresh sign-in and uses it.

import { check } from 'k6';
import { signIn, getSession } from '../helpers/auth.js';
import { get, post } from '../helpers/http.js';
import { USERS } from '../config.js';

export function runAuthFlow(email, password, existingCookie) {
  const targetEmail = email || USERS.admin.email;
  const targetPassword = password || USERS.admin.password;

  let cookie = existingCookie;
  let user = null;

  // Only sign in fresh if no existing session is provided
  if (!cookie) {
    const auth = signIn(targetEmail, targetPassword);
    if (!auth.success || !auth.cookie) {
      return { success: false, error: 'Sign-in failed' };
    }
    cookie = auth.cookie;
    user = auth.user;
  }

  // 1. Validate Session with cookie
  const sessionResult = getSession(cookie);
  check(sessionResult.response, {
    'get-session status is 200': (r) => r.status === 200,
    'session user email matches': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body && body.user && body.user.email === targetEmail;
      } catch {
        return false;
      }
    },
  });

  // 2. Check Current Role (/api/users/me/role)
  const roleRes = get('/api/users/me/role', {
    cookie,
    tags: { name: 'GET /api/users/me/role' },
  });
  check(roleRes, {
    'user role is 200': (r) => r.status === 200,
    'user role is superAdmin': (r) => {
      try {
        return JSON.parse(r.body).role === 'superAdmin';
      } catch {
        return false;
      }
    },
  });

  // 3. Check Current Permissions (/api/users/me/permissions)
  const permRes = get('/api/users/me/permissions', {
    cookie,
    tags: { name: 'GET /api/users/me/permissions' },
  });
  check(permRes, {
    'user permissions is 200': (r) => r.status === 200,
    'user has notes permissions': (r) => {
      try {
        const body = JSON.parse(r.body);
        return Array.isArray(body.permissions.notes) && body.permissions.notes.includes('create');
      } catch {
        return false;
      }
    },
  });

  return {
    success: true,
    cookie,
    user,
  };
}
