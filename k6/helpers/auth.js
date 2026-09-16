// k6/helpers/auth.js
// Authentication helper for Better Auth lifecycle management.

import { check } from 'k6';
import { post, get } from './http.js';
import { USERS } from '../config.js';

/**
 * Extracts session cookie string from HTTP response Set-Cookie headers.
 */
export function extractCookie(response) {
  // Check k6 cookies map first
  const cookies = response.cookies;
  if (cookies) {
    if (cookies['__Secure-better-auth.session_token'] && cookies['__Secure-better-auth.session_token'].length > 0) {
      return `__Secure-better-auth.session_token=${cookies['__Secure-better-auth.session_token'][0].value}`;
    }
    if (cookies['better-auth.session_token'] && cookies['better-auth.session_token'].length > 0) {
      return `better-auth.session_token=${cookies['better-auth.session_token'][0].value}`;
    }
  }

  // Fallback to parsing raw Set-Cookie header
  const setCookie = response.headers['Set-Cookie'] || response.headers['set-cookie'];
  if (setCookie) {
    const match = setCookie.match(/(__Secure-better-auth\.session_token=[^;]+|better-auth\.session_token=[^;]+)/);
    if (match) {
      return match[1];
    }
  }

  return '';
}

/**
 * Authenticates user via Better Auth email and password.
 */
export function signIn(email, password) {
  const payload = {
    email: email || USERS.admin.email,
    password: password || USERS.admin.password,
  };

  const res = post('/api/auth/sign-in/email', payload, {
    tags: { name: 'POST /api/auth/sign-in/email' },
  });

  const success = check(res, {
    'sign-in status is 200': (r) => r.status === 200,
    'sign-in returned valid cookie': (r) => Boolean(extractCookie(r)),
  });

  const cookie = extractCookie(res);
  let user = null;
  try {
    const json = JSON.parse(res.body);
    user = json.user || null;
  } catch {
    // Ignore JSON parse errors on non-200
  }

  return {
    response: res,
    cookie,
    user,
    success,
  };
}

/**
 * Registers a new user via Better Auth.
 */
export function signUp(email, password, name) {
  const payload = {
    email,
    password,
    name: name || 'Test User',
  };

  const res = post('/api/auth/sign-up/email', payload, {
    tags: { name: 'POST /api/auth/sign-up/email' },
  });

  const success = check(res, {
    'sign-up status is 200': (r) => r.status === 200,
  });

  return {
    response: res,
    cookie: extractCookie(res),
    success,
  };
}

/**
 * Retrieves the current session object using an authenticated session cookie.
 */
export function getSession(cookie) {
  const res = get('/api/auth/get-session', {
    cookie,
    tags: { name: 'GET /api/auth/get-session' },
  });

  const success = check(res, {
    'get-session status is 200': (r) => r.status === 200,
    'session has user payload': (r) => {
      try {
        const data = JSON.parse(r.body);
        return Boolean(data && data.user && data.user.id);
      } catch {
        return false;
      }
    },
  });

  let data = null;
  try {
    data = JSON.parse(res.body);
  } catch {
    // Ignore
  }

  return {
    response: res,
    session: data,
    success,
  };
}

/**
 * Signs out the current session.
 */
export function signOut(cookie) {
  const res = post('/api/auth/sign-out', {}, {
    cookie,
    tags: { name: 'POST /api/auth/sign-out' },
  });

  check(res, {
    'sign-out status is 200': (r) => r.status === 200,
  });

  return res;
}
