const REQUIRED = [
  'HOST',
  'PORT',
  'DATABASE_URL',
  'REDIS_URL',
  'NEXT_PUBLIC_APP_URL',
  'BETTER_AUTH_URL',
  'BETTER_AUTH_SECRET',
  'APP_NAME',
] as const;

function getRequiredEnv(name: (typeof REQUIRED)[number]): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function parsePort(value: string): number {
  const port = Number(value);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT value: ${value}`);
  }

  return port;
}

export function getApiEnv() {
  const env = Object.fromEntries(
    REQUIRED.map((name) => [name, getRequiredEnv(name)]),
  ) as Record<(typeof REQUIRED)[number], string>;

  return {
    host: env.HOST,
    port: parsePort(env.PORT),
    databaseUrl: env.DATABASE_URL,
    redisUrl: env.REDIS_URL,
    nextPublicAppUrl: env.NEXT_PUBLIC_APP_URL,
    betterAuthUrl: env.BETTER_AUTH_URL,
    betterAuthSecret: env.BETTER_AUTH_SECRET,
    appName: env.APP_NAME,
  };
}
