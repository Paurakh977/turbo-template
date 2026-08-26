// packages/database/src/seed.ts
import { config } from 'dotenv';
import { resolve } from 'node:path';
config({ path: resolve(process.cwd(), '../../.env') });
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client';
import { getSeedEnv } from './env';
// Canonical role parsing/serialization — shared with the auth package
// (@repo/auth re-exports the same module) so seeded roles always match the
// format the auth system produces. Importing from @repo/auth directly would
// create a circular dependency (auth depends on database).
import { parseRoles, serializeRoles } from '@repo/roles';

const pgPool = new Pool({ connectionString: process.env.DATABASE_URL ?? '' });
const db = new PrismaClient({ adapter: new PrismaPg(pgPool) });

// Better Auth uses this exact bcrypt implementation internally.
// We call the auth API instead of hashing directly to stay in sync.
async function seed() {
  const { seedAdminEmail, seedAdminPassword, seedAdminName, betterAuthUrl } =
    getSeedEnv();

  const adminEmail = seedAdminEmail;
  const adminPassword = seedAdminPassword;
  const adminName = seedAdminName;

  if (adminPassword.length < 12) {
    throw new Error('Seed admin password must be at least 12 characters.');
  }

  console.log(`[Seed] Checking for existing super admin: ${adminEmail}`);

  const existing = await db.user.findUnique({ where: { email: adminEmail } });

  if (existing) {
    // Already exists — ensure canonical role format and superAdmin assignment
    const existingRoles = parseRoles(existing.role);
    const isAlreadySuperAdmin = existingRoles.includes('superAdmin');

    if (!isAlreadySuperAdmin) {
      await db.user.update({
        where: { email: adminEmail },
        data: {
          role: serializeRoles(['superAdmin']),
          emailVerified: true,
        },
      });
      console.log(
        `[Seed] Promoted existing user ${adminEmail} to super admin.`,
      );
    } else {
      const normalizedRole = serializeRoles(existingRoles);
      if (normalizedRole !== existing.role) {
        await db.user.update({
          where: { email: adminEmail },
          data: { role: normalizedRole },
        });
      }
      console.log(
        `[Seed] Admin ${adminEmail} already exists with super admin role. Skipping.`,
      );
    }
    return;
  }

  // Call Better Auth's own API so password hashing and ID generation
  // are handled by the library — never roll your own hashing here.
  const BETTER_AUTH_URL = betterAuthUrl;

  console.log(
    `[Seed] Creating super admin user via Better Auth API at ${BETTER_AUTH_URL}`,
  );

  // Origin must pass Better Auth's trustedOrigins CSRF check. trustedOrigins
  // contains appURL (NEXT_PUBLIC_APP_URL) but only contains BETTER_AUTH_URL
  // when it happens to equal it - so prefer the public app URL here.
  const origin =
    process.env.NEXT_PUBLIC_APP_URL?.trim() || BETTER_AUTH_URL;

  const res = await fetch(`${BETTER_AUTH_URL}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: origin,
    },
    body: JSON.stringify({
      email: adminEmail,
      password: adminPassword,
      name: adminName,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Better Auth sign-up failed: ${res.status} ${body}`);
  }

  const { user } = (await res.json()) as { user: { id: string } };

  // Promote to super admin and force email verification
  await db.user.update({
    where: { id: user.id },
    data: {
      role: serializeRoles(['superAdmin']),
      emailVerified: true,
    },
  });

  console.log(`[Seed] ✅ Super admin created: ${adminEmail} (id: ${user.id})`);
}

seed()
  .catch((e) => {
    console.error('[Seed] ❌ Failed:', e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
