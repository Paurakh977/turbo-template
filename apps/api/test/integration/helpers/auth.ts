import { db } from '@repo/database';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

export type TestUser = {
  id: string;
  email: string;
  name: string;
  password: string;
  role: string;
};

export type AuthenticatedAgent = {
  agent: ReturnType<typeof request.agent>;
  user: TestUser;
  cookie: string;
};

const BASE_PASSWORD = 'TestPassword123!';

/**
 * Creates a test user directly in the database (bypasses Better Auth signup).
 * Returns the user object with a known password for login.
 */
export async function createTestUser(
  overrides: Partial<TestUser> = {},
): Promise<TestUser> {
  const index = Math.floor(Math.random() * 100000);
  const user: TestUser = {
    id: `test-user-${Date.now()}-${index}`,
    email: `test-${Date.now()}-${index}@integration.test`,
    name: `Test User ${index}`,
    password: BASE_PASSWORD,
    role: 'user',
    ...overrides,
  };

  await db.user.create({
    data: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      emailVerified: true,
      banned: false,
    },
  });

  // Create the password account (Better Auth stores hashed passwords here)
  // We use a raw insert since Better Auth handles hashing internally
  await db.account.create({
    data: {
      id: `acc-${user.id}`,
      accountId: user.email,
      providerId: 'email-password',
      userId: user.id,
      password: user.password, // Will be hashed by Better Auth on real signup
    },
  });

  return user;
}

/**
 * Registers a user through the real Better Auth API endpoint.
 * Returns the user info and the session cookie.
 */
export async function registerUserViaApi(
  app: INestApplication,
  email: string,
  password: string,
  name: string,
  role?: string,
): Promise<{ status: number; cookie?: string; body?: any; userId?: string }> {
  const res = await request(app.getHttpServer())
    .post('/api/auth/sign-up/email')
    .send({ email, password, name });

  // Better Auth may return multiple set-cookie headers; grab the session one
  const allCookies = res.headers['set-cookie'];
  const cookie = Array.isArray(allCookies)
    ? allCookies.find((c) => c.includes('better-auth.session_token'))
    : typeof allCookies === 'string' && allCookies.includes('better-auth.session_token')
      ? allCookies
      : allCookies?.[0];

  const userId = res.body?.user?.id as string | undefined;

  // If a role was requested, assign it directly in the DB so the permission
  // check picks it up on the next request (no session invalidation needed).
  if (role && userId) {
    await assignUserRole(userId, role);
  }

  return { status: res.status, cookie, body: res.body, userId };
}

/**
 * Logs in a user through the real Better Auth API endpoint.
 * Returns the session cookie.
 */
export async function loginUserViaApi(
  app: INestApplication,
  email: string,
  password: string,
): Promise<{ status: number; cookie?: string; body?: unknown }> {
  const res = await request(app.getHttpServer())
    .post('/api/auth/sign-in/email')
    .send({ email, password });

  const allCookies = res.headers['set-cookie'];
  const cookie = Array.isArray(allCookies)
    ? allCookies.find((c) => c.includes('better-auth.session_token'))
    : typeof allCookies === 'string' && allCookies.includes('better-auth.session_token')
      ? allCookies
      : allCookies?.[0];

  return { status: res.status, cookie, body: res.body };
}

/**
 * Gets the current session via the real Better Auth API.
 */
export async function getSessionViaApi(
  app: INestApplication,
  cookie: string,
): Promise<{ status: number; body?: unknown }> {
  const res = await request(app.getHttpServer())
    .get('/api/auth/get-session')
    .set('Cookie', cookie);

  return { status: res.status, body: res.body };
}

/**
 * Assigns a Better Auth role to a user by updating the user record directly.
 * Better Auth stores roles in the user table; the admin plugin reads them at
 * session-resolution time.
 */
export async function assignUserRole(
  userId: string,
  role: string,
): Promise<void> {
  await db.user.update({
    where: { id: userId },
    data: { role },
  });
}

/**
 * Creates an authenticated agent with cookie jar for sequential requests.
 */
export async function createAuthenticatedAgent(
  app: INestApplication,
  email: string,
  password: string,
): Promise<ReturnType<typeof request.agent>> {
  const agent = request.agent(app.getHttpServer());
  await agent.post('/api/auth/sign-in/email').send({ email, password });
  return agent;
}
