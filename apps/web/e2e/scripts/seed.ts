import { writeFileSync, mkdirSync } from 'node:fs';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { E2E } from '../config/playwright.env';
import { E2E_USERS, STORAGE_STATE_DIR, STORAGE_STATE_FILE } from '../config/users';
import { buildStorageState } from '../helpers/session.helper';
import { getPool, closePool, query } from '../helpers/database.helper';
import { flushAll, flushRateLimits } from '../helpers/redis.helper';

async function rawRequest(
  path: string,
  body: unknown,
  cookie?: string,
): Promise<{ status: number; headers: Record<string, string>; setCookies: string[]; body: any }> {
  const res = await fetch(`${E2E.baseURL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: E2E.appURL,
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  });
  const headers: Record<string, string> = {};
  res.headers.forEach((v, k) => {
    headers[k.toLowerCase()] = v;
  });
  const setCookies: string[] =
    typeof (res.headers as any).getSetCookie === 'function'
      ? (res.headers as any).getSetCookie()
      : res.headers.get('set-cookie')
        ? [res.headers.get('set-cookie')!]
        : [];
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    /* no body */
  }
  return { status: res.status, headers, setCookies, body: json };
}

function cookieValueFrom(setCookies: string[] | string | undefined): string {
  if (!setCookies) return '';
  const list = Array.isArray(setCookies) ? setCookies : [setCookies];
  for (const header of list) {
    const match = header.match(/better-auth\.session_token=([^;]+)/);
    if (match) return match[1] ?? '';
  }
  return '';
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Sign-up is rate-limited (Better Auth caps /sign-up/email per IP). When the
 * bucket is exhausted we wait out the window and retry so the seed always
 * completes regardless of the running server's rate-limit configuration.
 */
async function signUpWithRetry(
  u: (typeof E2E_USERS)[keyof typeof E2E_USERS],
): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await rawRequest('/api/auth/sign-up/email', {
      name: u.name,
      email: u.email,
      password: u.password,
      callbackURL: '/dashboard',
    });
    if (res.status !== 429) {
      if (res.status !== 200 && res.status !== 400) {
        throw new Error(`Sign-up for ${u.email} failed (status ${res.status})`);
      }
      return;
    }
    // Rate limit hit during seed setup — flush Redis instantly and retry
    await flushAll();
    await sleep(100);
  }
  throw new Error(`Sign-up for ${u.email} still rate-limited after retries`);
}

export async function runSeed() {
  mkdirSync(STORAGE_STATE_DIR, { recursive: true });

  // Flush Redis rate-limits & cache so deterministic seed creates all accounts instantly.
  await flushAll();

  // Deterministic start: wipe any pre-existing accounts (the postgres-e2e
  // volume persists across runs, so a stale superadmin with a mismatched
  // password would otherwise make sign-in fail). Tests never run before
  // globalSetup finishes, so this is safe.
  await query(
    `TRUNCATE TABLE "user", "session", "account", "verification", "twoFactor", "rateLimit" RESTART IDENTITY CASCADE`,
  );

  // Pass 1: create every account (resilient to the sign-up rate limit).
  for (const u of Object.values(E2E_USERS)) {
    await signUpWithRetry(u);
  }

  // Pass 2: pin role + verified flag directly (no mocking: real DB write).
  // This MUST happen BEFORE sign-in: Better Auth caches the user (including
  // role) in Redis at session-creation time, so a role written after sign-in
  // would be invisible to get-session and bounce admins to /dashboard.
  // `role` is a plain string column (e.g. 'superAdmin'), not a Postgres array.
  for (const u of Object.values(E2E_USERS)) {
    await query(
      `UPDATE "user" SET role = $1::text, "emailVerified" = true WHERE email = $2`,
      [u.role, u.email],
    );
  }

  // Pass 3: sign in, capture the session cookie, write the storage state.
  for (const u of Object.values(E2E_USERS)) {
    let signIn = await rawRequest('/api/auth/sign-in/email', {
      email: u.email,
      password: u.password,
      callbackURL: '/dashboard',
    });

    if (signIn.status === 429) {
      await flushAll();
      signIn = await rawRequest('/api/auth/sign-in/email', {
        email: u.email,
        password: u.password,
        callbackURL: '/dashboard',
      });
    }

    const cookieValue = cookieValueFrom(
      signIn.setCookies.length > 0
        ? signIn.setCookies
        : signIn.headers['set-cookie'],
    );

    if (!cookieValue) {
      throw new Error(
        `Failed to obtain session cookie for ${u.email} (status ${signIn.status})`,
      );
    }

    const state = buildStorageState(cookieValue);
    writeFileSync(STORAGE_STATE_FILE(u.role as never), JSON.stringify(state, null, 2));
    // eslint-disable-next-line no-console
    console.log(`Seeded ${u.role} -> ${u.email}`);
  }

  await closePool();
  // eslint-disable-next-line no-console
  console.log('E2E seed complete.');
}

const isMain =
  process.argv[1] &&
  realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  runSeed().catch(async (err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    await closePool().catch(() => {});
    process.exit(1);
  });
}
