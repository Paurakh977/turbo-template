function getRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
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
    seedAdminName: getRequiredEnv('SEED_ADMIN_NAME'),
    betterAuthUrl: getRequiredEnv('BETTER_AUTH_URL'),
  };
}