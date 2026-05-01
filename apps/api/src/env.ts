function getRequiredEnv(name: 'HOST' | 'PORT'): string {
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
  return {
    host: getRequiredEnv('HOST'),
    port: parsePort(getRequiredEnv('PORT')),
  };
}
