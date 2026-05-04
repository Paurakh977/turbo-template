function getRequiredEnv(name: 'DATABASE_URL'): string {
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
