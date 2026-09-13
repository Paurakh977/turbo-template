/**
 * Next.js Server-Side OpenTelemetry Instrumentation Hook
 *
 * Automatically loaded by Next.js on server startup.
 * @see https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 *
 * All observability identity comes from the root .env (see .env.example) —
 * no hardcoded literals, no silent fallbacks. Compose injects every value;
 * host runs read them via next.config.js dotenv loading.
 */

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

// NOTE: no `experimental.instrumentationHook` flag in next.config.js — it is
// deprecated since Next 15 (instrumentation.js is loaded by default). Adding it
// back would only emit a deprecation warning. This file must stay at
// `src/instrumentation.ts` (root or src/, never app/ or pages/) exporting
// `register()`.
export async function register() {
  // Only run on the server Node.js runtime (not Edge runtime)
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // OTel SDK disabled (e2e profile without collectors): fail open as a
    // no-op so telemetry never retries against missing collectors.
    if (process.env.OTEL_SDK_DISABLED === 'true') {
      console.info('[otel] web instrumentation skipped (OTEL_SDK_DISABLED=true)');
      return;
    }

    const { NodeSDK } = await import('@opentelemetry/sdk-node');
    const { OTLPTraceExporter } = await import(
      '@opentelemetry/exporter-trace-otlp-grpc'
    );
    const { OTLPMetricExporter } = await import(
      '@opentelemetry/exporter-metrics-otlp-grpc'
    );
    const { OTLPLogExporter } = await import(
      '@opentelemetry/exporter-logs-otlp-grpc'
    );
    const { BatchLogRecordProcessor } = await import(
      '@opentelemetry/sdk-logs'
    );
    const { PeriodicExportingMetricReader } = await import(
      '@opentelemetry/sdk-metrics'
    );
    const { HttpInstrumentation } = await import(
      '@opentelemetry/instrumentation-http'
    );
    const { createServiceResource } = await import('@repo/observability');
    const { default: fs } = await import('node:fs');

    // Required from .env. Host runs rewrite the docker hostname to localhost.
    let otlpEndpoint = requireEnv('OTEL_EXPORTER_OTLP_ENDPOINT');
    if (!fs.existsSync('/.dockerenv') && otlpEndpoint.includes('alloy:4317')) {
      otlpEndpoint = otlpEndpoint.replace('alloy:4317', 'localhost:4317');
    }

    const sdk = new NodeSDK({
      resource: createServiceResource({
        // Tier-specific name first (OTEL_SERVICE_NAME_WEB), shared key as
        // fallback. Both come from the root .env — compose injects
        // OTEL_SERVICE_NAME per tier.
        serviceName:
          process.env.OTEL_SERVICE_NAME_WEB?.trim() ||
          requireEnv('OTEL_SERVICE_NAME'),
        serviceNamespace: requireEnv('OTEL_SERVICE_NAMESPACE'),
        // Single version source: GIT_SHA everywhere (see otel.ts). Compose
        // maps GIT_SHA into OTEL_SERVICE_VERSION for containers; either key
        // satisfies host runs.
        serviceVersion:
          process.env.OTEL_SERVICE_VERSION?.trim() ||
          process.env.GIT_SHA?.trim() ||
          requireEnv('OTEL_SERVICE_VERSION'),
        environment: requireEnv('OTEL_ENVIRONMENT'),
      }),
      traceExporter: new OTLPTraceExporter({ url: otlpEndpoint }),
      metricReader: new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({ url: otlpEndpoint }),
        exportIntervalMillis: 30_000,
      }),
      logRecordProcessor: new BatchLogRecordProcessor(
        new OTLPLogExporter({ url: otlpEndpoint }),
      ),
      instrumentations: [
        new HttpInstrumentation({
          // Ignore internal Next.js requests (HMR, static assets, internal probes)
          ignoreIncomingRequestHook: (request) => {
            const url = request.url || '';
            return (
              url.startsWith('/_next/') ||
              url.includes('__nextjs') ||
              url.includes('/favicon.ico') ||
              url.includes('/healthz')
            );
          },
        }),
      ],
    });

    sdk.start();
    // Boot log so a silently-dead SDK is visible in container logs instead of
    // surfacing hours later as "0 traces from web" in Grafana/Tempo.
    console.info(
      `[otel] web instrumentation started (service=${process.env.OTEL_SERVICE_NAME_WEB?.trim() || process.env.OTEL_SERVICE_NAME}, endpoint=${otlpEndpoint})`,
    );

    const gracefulShutdown = () => {
      sdk
        .shutdown()
        .then(() => process.exit(0))
        .catch(() => process.exit(1));
    };

    process.on('SIGTERM', gracefulShutdown);
    process.on('SIGINT', gracefulShutdown);
  }
}
