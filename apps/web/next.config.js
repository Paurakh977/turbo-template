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
// Architecture B: web holds no auth runtime. The browser client resolves
// window.location.origin and the SSR fallback uses NEXT_PUBLIC_APP_URL; the
// signing secret, BETTER_AUTH_URL and DB credentials never reach this tier.
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
  // Architecture B: web holds NO database drivers and NO auth runtime.
  // (serverExternalPackages previously listed pg/@prisma/ioredis to stop
  // webpack duplicating the bundled driver copies that caused the 08P01
  // wire-corruption incident; with the packages removed entirely the hazard
  // class is eliminated by construction.)
  poweredByHeader: false,
  // Type errors must fail the build; CI runs `turbo run typecheck` too, but a
  // local `next build` should never be able to ship type-broken code.
  typescript: { ignoreBuildErrors: false },
  webpack(config, { dev, isServer }) {
    if (dev) {
      config.watchOptions = {
        poll: 1000,
        aggregateTimeout: 300,
      };
    }
    if (!isServer) {
      // better-auth's server entry references optional integrations; keep
      // them out of browser bundles.
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
