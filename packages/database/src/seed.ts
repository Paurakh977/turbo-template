// packages/database/src/seed.ts
import { PrismaClient } from '@prisma/client';
import { createHash, randomBytes } from 'crypto';

const db = new PrismaClient();

// Better Auth uses this exact bcrypt implementation internally.
// We call the auth API instead of hashing directly to stay in sync.
async function seed() {
  const adminEmail = process.env.SEED_ADMIN_EMAIL;
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;
  const adminName = process.env.SEED_ADMIN_NAME ?? 'Admin';

  if (!adminEmail || !adminPassword) {
    throw new Error(
      'Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD env vars before seeding.',
    );
  }

  if (adminPassword.length < 12) {
    throw new Error('Seed admin password must be at least 12 characters.');
  }

  console.log(`[Seed] Checking for existing super admin: ${adminEmail}`);

  const existing = await db.user.findUnique({ where: { email: adminEmail } });

  if (existing) {
    // Already exists — just ensure they have the super admin role
    // Handle both old comma-string format and new JSON array format
    const existingRoles = existing.role;
    const isAlreadySuperAdmin = Array.isArray(existingRoles)
      ? existingRoles.includes('superAdmin')
      : String(existingRoles ?? '')
          .split(',')
          .map((r) => r.trim())
          .includes('superAdmin');

    if (!isAlreadySuperAdmin) {
      await db.user.update({
        where: { email: adminEmail },
        data: { role: '["superAdmin"]', emailVerified: true },
      });
      console.log(
        `[Seed] Promoted existing user ${adminEmail} to super admin.`,
      );
    } else {
      console.log(
        `[Seed] Admin ${adminEmail} already exists with super admin role. Skipping.`,
      );
    }
    return;
  }

  // Call Better Auth's own API so password hashing and ID generation
  // are handled by the library — never roll your own hashing here.
  const BETTER_AUTH_URL =
    process.env.BETTER_AUTH_URL ?? 'http://localhost:3001';

  console.log(
    `[Seed] Creating super admin user via Better Auth API at ${BETTER_AUTH_URL}`,
  );

  const res = await fetch(`${BETTER_AUTH_URL}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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

  // Promote to admin and force email verification
  // Store role as JSON array — the format Better Auth expects for the Json column
  await db.user.update({
    where: { id: user.id },
    data: {
      role: '["superAdmin"]',
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
