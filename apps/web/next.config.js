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
// NOTE: BETTER_AUTH_SECRET / BETTER_AUTH_URL are server-side runtime vars for
// Better Auth. They are supplied at runtime via Compose `environment:` and are
// intentionally NOT required at build time (so we don't bake secrets into the
// image). Better Auth validates them when the server starts.
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
  // CSP is applied by the Next 16 `proxy.ts` middleware (with a per-request
  // nonce); nginx supplies HSTS/X-Frame-Options/etc. We only harden headers
  // here that nothing else sets.
  poweredByHeader: false,
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
