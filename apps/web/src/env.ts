import { headers } from 'next/headers';

function getOptionalRawEnv(
  name:
    | 'NEXT_PUBLIC_API_URL'
    | 'NEXT_ALLOWED_DEV_ORIGINS'
    | 'INTERNAL_API_URL',
): string | undefined {
  const value = process.env[name]?.trim();

  return value || undefined;
}

function getRequiredEnv(
  name: 'NEXT_PUBLIC_API_URL' | 'NEXT_ALLOWED_DEV_ORIGINS',
): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function getOptionalEnv(name: 'NEXT_PUBLIC_API_URL' | 'NEXT_ALLOWED_DEV_ORIGINS') {
  return getOptionalRawEnv(name);
}

export function getWebBuildEnv() {
  const nextPublicApiUrl = getRequiredEnv('NEXT_PUBLIC_API_URL');
  const isDevelopment = process.env.NODE_ENV !== 'production';
  const nextAllowedDevOrigins = isDevelopment
    ? getRequiredEnv('NEXT_ALLOWED_DEV_ORIGINS')
    : getOptionalEnv('NEXT_ALLOWED_DEV_ORIGINS');

  if (
    !nextPublicApiUrl.startsWith('/') &&
    !/^https?:\/\//.test(nextPublicApiUrl)
  ) {
    throw new Error(
      'NEXT_PUBLIC_API_URL must be an absolute URL or start with "/"',
    );
  }

  return {
    nextPublicApiUrl,
    allowedDevOrigins: nextAllowedDevOrigins
      ?.split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  };
}

export async function getApiBaseUrl() {
  const { nextPublicApiUrl } = getWebBuildEnv();
  const internalApiUrl = getOptionalRawEnv('INTERNAL_API_URL');

  if (internalApiUrl) {
    return internalApiUrl.replace(/\/$/, '');
  }

  if (/^https?:\/\//.test(nextPublicApiUrl)) {
    return nextPublicApiUrl.replace(/\/$/, '');
  }

  const incomingHeaders = await headers();
  const host =
    incomingHeaders.get('x-forwarded-host') ?? incomingHeaders.get('host');
  const protocol = incomingHeaders.get('x-forwarded-proto') ?? 'http';

  if (!host) {
    throw new Error(
      'Unable to resolve request host for NEXT_PUBLIC_API_URL. Requests must pass through the nginx proxy.',
    );
  }

  return new URL(nextPublicApiUrl, `${protocol}://${host}`)
    .toString()
    .replace(/\/$/, '');
}
