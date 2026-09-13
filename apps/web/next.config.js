import { config } from 'dotenv';
import { resolve } from 'node:path';

const hadPort = process.env.PORT !== undefined;

config({ path: resolve(process.cwd(), '../../.env') });

// k6 load-testing overrides: when K6_TESTING=true, layer .env.k6 on top.
if (process.env.K6_TESTING === 'true') {
  config({ path: resolve(process.cwd(), '../../.env.k6'), override: true });
}

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

// Faro RUM identity (M3): the browser client silently no-ops when the
// collector URL is missing, but a SET collector with MISSING identity throws
// at runtime in every browser. These are NEXT_PUBLIC_* (build args, present
// in the Docker builder), so validating here is build-safe. Server-side OTel
// keys are deliberately NOT validated here — the Docker builder has no OTel
// env; apps/web/src/instrumentation.ts requireEnv() owns them and fails fast
// at server boot instead.
if (process.env.NEXT_PUBLIC_FARO_COLLECTOR_URL?.trim()) {
  getRequiredEnv('NEXT_PUBLIC_FARO_APP_NAME');
  getRequiredEnv('NEXT_PUBLIC_FARO_APP_VERSION');
  getRequiredEnv('NEXT_PUBLIC_FARO_ENVIRONMENT');
}

const allowedDevOrigins = Array.from(
  new Set(
    rawAllowedDevOrigins
      ?.split(',')
      .map((origin) => origin.trim())
      .flatMap((origin) => {
        const withoutProto = origin.replace(/^https?:\/\//, '');
        return [origin, withoutProto];
      })
      .filter(Boolean) || [],
  ),
);

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  serverExternalPackages: [
    '@opentelemetry/sdk-node',
    '@opentelemetry/sdk-trace-node',
    '@opentelemetry/sdk-metrics',
    '@opentelemetry/sdk-logs',
    '@opentelemetry/exporter-trace-otlp-grpc',
    '@opentelemetry/exporter-metrics-otlp-grpc',
    '@opentelemetry/exporter-logs-otlp-grpc',
    '@opentelemetry/instrumentation-http',
    '@opentelemetry/instrumentation',
    '@repo/observability',
    'pino',
  ],
  poweredByHeader: false,
  // Type errors must fail the build; CI runs `turbo run typecheck` too, but a
  // local `next build` should never be able to ship type-broken code.
  typescript: { ignoreBuildErrors: false },
  experimental: {
    serverActions: {
      allowedOrigins: [
        'localhost:8443',
        'localhost',
        '127.0.0.1:8443',
        '127.0.0.1',
        ...allowedDevOrigins,
      ],
    },
  },
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
