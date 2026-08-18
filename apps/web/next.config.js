import { config } from 'dotenv';
import { resolve } from 'node:path';

const hadPort = process.env.PORT !== undefined;

config({ path: resolve(process.cwd(), '../../.env') });

// The root .env sets PORT=3001 for the API. The web dev/start server must
// keep port 3000 locally, so drop the root value when nothing else (e.g.
// Docker Compose) already injected it.
if (!hadPort) {
  delete process.env.PORT;
}

function getRequiredEnv(name, { required = true } = {}) {
  const value = process.env[name]?.trim();

  if (!value) {
    if (!required) {
      return undefined;
    }

    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

const nextPublicApiUrl = getRequiredEnv('NEXT_PUBLIC_API_URL');
const nextPublicAppUrl = getRequiredEnv('NEXT_PUBLIC_APP_URL');
const betterAuthUrl = getRequiredEnv('BETTER_AUTH_URL');
const betterAuthSecret = getRequiredEnv('BETTER_AUTH_SECRET');
const isDevelopment = process.env.NODE_ENV !== 'production';
const rawAllowedDevOrigins = getRequiredEnv('NEXT_ALLOWED_DEV_ORIGINS', {
  required: isDevelopment,
});

if (
  !nextPublicApiUrl.startsWith('/') &&
  !/^https?:\/\//.test(nextPublicApiUrl)
) {
  throw new Error(
    'NEXT_PUBLIC_API_URL must be an absolute URL or start with "/"',
  );
}

const allowedDevOrigins = rawAllowedDevOrigins
  ?.split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  typescript: { ignoreBuildErrors: true },
  webpack(config, { dev, isServer }) {
    if (dev) {
      config.watchOptions = {
        poll: 1000,
        aggregateTimeout: 300,
      };
    }
    if (!isServer) {
      config.resolve = config.resolve || {};
      config.resolve.alias = {
        ...config.resolve.alias,
        ioredis: false,
      };
    }
    return config;
  },
  ...(allowedDevOrigins?.length ? { allowedDevOrigins } : {}),
};

export default nextConfig;
