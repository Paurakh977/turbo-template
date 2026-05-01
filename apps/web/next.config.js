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
  webpack(config, { dev }) {
    if (dev) {
      config.watchOptions = {
        poll: 1000,
        aggregateTimeout: 300,
      };
    }
    return config;
  },
  ...(allowedDevOrigins?.length ? { allowedDevOrigins } : {}),
};

export default nextConfig;
