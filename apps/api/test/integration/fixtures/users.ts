import { db } from '@repo/database';

export type FixtureUser = {
  id: string;
  email: string;
  name: string;
  role: string;
};

/**
 * Deterministic user fixtures for integration tests.
 * Created fresh in beforeEach via seedFixtures().
 */
export const USER_FIXTURES = {
  USER: {
    id: 'fixture-user-001',
    email: 'user@fixture.test',
    name: 'Fixture User',
    role: 'user',
  },
  OPERATOR: {
    id: 'fixture-user-002',
    email: 'operator@fixture.test',
    name: 'Fixture Operator',
    role: 'operator',
  },
  ADMIN: {
    id: 'fixture-user-003',
    email: 'admin@fixture.test',
    name: 'Fixture Admin',
    role: 'admin',
  },
  SUPER_ADMIN: {
    id: 'fixture-user-004',
    email: 'superadmin@fixture.test',
    name: 'Fixture Super Admin',
    role: 'superAdmin',
  },
} as const;

/**
 * Seeds all base user fixtures into the database.
 */
export async function seedBaseUsers() {
  for (const user of Object.values(USER_FIXTURES)) {
    await db.user.upsert({
      where: { id: user.id },
      create: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        emailVerified: true,
        banned: false,
      },
      update: {
        role: user.role,
        emailVerified: true,
        banned: false,
      },
    });
  }
}
