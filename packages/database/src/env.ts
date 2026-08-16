function getRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function getOptionalEnv(name: string): string | undefined {
  return process.env[name]?.trim() || undefined;
}

export function getDatabaseEnv() {
  return {
    databaseUrl: getRequiredEnv('DATABASE_URL'),
  };
}

export function getSeedEnv() {
  return {
    seedAdminEmail: getRequiredEnv('SEED_ADMIN_EMAIL'),
    seedAdminPassword: getRequiredEnv('SEED_ADMIN_PASSWORD'),
    seedAdminName: getOptionalEnv('SEED_ADMIN_NAME') ?? 'Admin',
    betterAuthUrl:
      getOptionalEnv('BETTER_AUTH_URL') ?? 'http://localhost:3001',
  };
}
