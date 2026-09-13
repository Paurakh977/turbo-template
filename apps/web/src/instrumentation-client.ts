import { initializeFaro, getWebInstrumentations } from '@grafana/faro-web-sdk';
import { TracingInstrumentation } from '@grafana/faro-web-tracing';

/**
 * Initialize Grafana Faro Real User Monitoring (RUM) in the browser.
 * Captures Web Vitals, uncaught JS errors, session data, and propagates
 * W3C traceparent headers to API endpoints for full distributed tracing.
 */
/**
 * Reads a required baked env var. Faro identity comes from the root .env
 * (NEXT_PUBLIC_FARO_* — baked at `next build` time, injected by compose) —
 * no hardcoded literals, no silent fallbacks.
 */
function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function initFaro() {
  if (typeof window === 'undefined') {
    return;
  }

  const faroCollectorUrl = process.env.NEXT_PUBLIC_FARO_COLLECTOR_URL?.trim();
  if (!faroCollectorUrl) {
    // Silent no-RUM here used to cost hours of "0 beacons in prod" debugging
    // after a .env typo (the URL is baked at build time). Warn loudly in
    // production; dev stays quiet (local runs often omit the collector).
    if (process.env.NODE_ENV === 'production') {
      console.warn(
        '[Faro] NEXT_PUBLIC_FARO_COLLECTOR_URL is not set — RUM disabled. Set it and rebuild the web image.',
      );
    }
    return;
  }

  // Prevent multiple initializations in dev hot-reload or client navigation
  const globalWindow = window as unknown as { __faro_initialized?: boolean };
  if (globalWindow.__faro_initialized) {
    return;
  }
  globalWindow.__faro_initialized = true;

  try {
    const corsUrls: (string | RegExp)[] = [/\/api\//];
    const rawApiUrl = process.env.NEXT_PUBLIC_API_URL?.trim();
    if (rawApiUrl && !rawApiUrl.startsWith('/')) {
      try {
        corsUrls.push(new RegExp(rawApiUrl));
      } catch {
        /* ignore invalid regex */
      }
    }

    initializeFaro({
      url: faroCollectorUrl,
      app: {
        name: requireEnv('NEXT_PUBLIC_FARO_APP_NAME'),
        version: requireEnv('NEXT_PUBLIC_FARO_APP_VERSION'),
        environment: requireEnv('NEXT_PUBLIC_FARO_ENVIRONMENT'),
      },
      instrumentations: [
        ...getWebInstrumentations({
          captureConsole: false,
          captureConsoleDisabledLevels: [],
        }),
        new TracingInstrumentation({
          instrumentationOptions: {
            propagateTraceHeaderCorsUrls: corsUrls,
          },
        }),
      ],
      sessionTracking: {
        enabled: true,
        persistent: true,
      },
    });
  } catch (error) {
    // Fail gracefully when the collector is unreachable, but never silently:
    // a broken RUM init must surface in the browser console in every env
    // except tests (where console noise breaks assertions).
    if (process.env.NODE_ENV !== 'test') {
      console.warn('[Faro] Failed to initialize Faro RUM:', error);
    }
  }
}
