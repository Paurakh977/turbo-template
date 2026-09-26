// apps/api/src/otel.ts
// ──────────────────────────────────────────────────────────────
// SIDE-EFFECT ONLY — this file is imported for its side effects.
// It MUST execute after load-env.ts in main.ts so the root .env is loaded.
// DO NOT import NestJS, Express, ioredis, or pg here.
// ──────────────────────────────────────────────────────────────

import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-grpc';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-grpc';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { NestInstrumentation } from '@opentelemetry/instrumentation-nestjs-core';
import { IORedisInstrumentation } from '@opentelemetry/instrumentation-ioredis';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { createServiceResource } from '@repo/observability';
import { Resource } from '@opentelemetry/resources';
import { ATTR_SERVICE_INSTANCE_ID } from '@opentelemetry/semantic-conventions';
import cluster from 'node:cluster';
import fs from 'node:fs';
import type { Span } from '@opentelemetry/api';

// Pyroscope continuous profiling
import Pyroscope from '@pyroscope/nodejs';

/**
 * Reads a required env var. All observability identity comes from the root
 * .env (see .env.example) — no hardcoded literals, no silent fallbacks.
 */
function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

// OTel SDK disabled (e2e / test profiles without collectors): fail open as a
// no-op so telemetry never retries against missing collectors.
if (process.env.OTEL_SDK_DISABLED === 'true') {
  // Intentionally do not start SDK or profiler.
} else {
  bootTelemetry();
}

function bootTelemetry() {
  // ─── Resource Identity ──────────────────────────────────────────────────
  // Tier-specific name first (OTEL_SERVICE_NAME_API), shared key as fallback.
  // Both come from the root .env — compose injects OTEL_SERVICE_NAME per tier.
  const serviceName =
    process.env.OTEL_SERVICE_NAME_API?.trim() ||
    requireEnv('OTEL_SERVICE_NAME');
  const serviceNamespace = requireEnv('OTEL_SERVICE_NAMESPACE');
  // Single version source: GIT_SHA everywhere. Compose maps GIT_SHA into
  // OTEL_SERVICE_VERSION for containers; host runs read .env directly where
  // both keys exist. Either key satisfies boot (M2).
  const serviceVersion =
    process.env.OTEL_SERVICE_VERSION?.trim() ||
    process.env.GIT_SHA?.trim() ||
    requireEnv('OTEL_SERVICE_VERSION');
  const environment = requireEnv('OTEL_ENVIRONMENT');

  const resource = createServiceResource({
    serviceName,
    serviceNamespace,
    serviceVersion,
    environment,
    // Per-worker instance identity (THE multi-worker metrics
    // fix). With API_WORKERS > 1 every worker pushes identically-named
    // cumulative counters; without an instance id Prometheus merges them into
    // one jagged series and rate() misreads inter-worker decreases as counter
    // resets — inflating request-rate panels ~7x (observed phantom 6.68K
    // req/s vs ~930 RPS true k6 load). Distinct instance ids keep every
    // worker's series separate so sums/rates/quantiles are exact, and
    // traces/logs stay attributable per worker. Harmless at 1 worker.
  }).merge(
    new Resource({
      [ATTR_SERVICE_INSTANCE_ID]: cluster.worker
        ? `api-worker-${cluster.worker.id}`
        : `api-single-${process.pid}`,
    }),
  );

  // ─── OTLP Endpoint ─────────────────────────────────────────────────────
  // Required from .env. Host runs rewrite the docker hostname to localhost.
  let otlpEndpoint = requireEnv('OTEL_EXPORTER_OTLP_ENDPOINT');
  if (!fs.existsSync('/.dockerenv') && otlpEndpoint.includes('alloy:4317')) {
    otlpEndpoint = otlpEndpoint.replace('alloy:4317', 'localhost:4317');
  }

  // ─── SDK Configuration ─────────────────────────────────────────────────
  const sdk = new NodeSDK({
    resource,

    traceExporter: new OTLPTraceExporter({
      url: otlpEndpoint,
    }),

    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({
        url: otlpEndpoint,
      }),
      exportIntervalMillis: 15_000,
    }),

    logRecordProcessor: new BatchLogRecordProcessor(
      new OTLPLogExporter({
        url: otlpEndpoint,
      }),
    ),

    instrumentations: [
      new HttpInstrumentation({
        ignoreIncomingRequestHook: (request) => {
          const url = request.url || '';
          return (
            url.includes('/health/live') ||
            url.includes('/healthz') ||
            url.includes('/favicon.ico')
          );
        },
      }),

      new ExpressInstrumentation(),

      new NestInstrumentation(),

      new IORedisInstrumentation({
        requestHook: (span: Span, cmdInfo: { cmdName: string; cmdArgs: unknown[] }) => {
          // Redact command arguments — may contain session tokens, passwords, etc.
          span.updateName(`redis:${cmdInfo.cmdName}`);
          // Remove db.statement attribute which contains raw command args (e.g., session tokens)
          span.setAttribute('db.statement', `redis:${cmdInfo.cmdName}`);
        },
      }),

      new PgInstrumentation({
        // Don't capture raw SQL parameters in spans to prevent PII leakage
        enhancedDatabaseReporting: false,
        responseHook: (span: Span) => {
          // Override db.connection_string with a redacted version
          // (the instrumentation adds it automatically with full connection details)
          span.setAttribute('db.connection_string', 'postgresql://***:***@***:5432');
        },
      }),
    ],
  });

  // ─── Start SDK ──────────────────────────────────────────────────────────
  sdk.start();

  // ─── Start Pyroscope Profiler ───────────────────────────────────────────
  // Optional by design (web tier and e2e/test profiles omit it).
  let pyroscopeAddress = process.env.PYROSCOPE_SERVER_ADDRESS?.trim() || '';
  if (pyroscopeAddress && !fs.existsSync('/.dockerenv') && pyroscopeAddress.includes('pyroscope:4040')) {
    pyroscopeAddress = pyroscopeAddress.replace('pyroscope:4040', 'localhost:4040');
  }
  if (pyroscopeAddress) {
    // Profiler identity comes from .env — no literals.
    const pyroscopeAppName =
      process.env.PYROSCOPE_APPLICATION_NAME?.trim() ||
      requireEnv('PYROSCOPE_APPLICATION_NAME');
    try {
      Pyroscope.init({
        serverAddress: pyroscopeAddress,
        appName: pyroscopeAppName,
        tags: {
          environment,
          version: serviceVersion,
        },
      });
      Pyroscope.start();
    } catch (err) {
      // Best-effort startup for Pyroscope
      console.warn('[Pyroscope] Failed to initialize profiler:', err);
    }
  }

  // ─── Graceful Shutdown ──────────────────────────────────────────────────
  const shutdown = async () => {
    try {
      await sdk.shutdown();
      if (pyroscopeAddress) {
        try {
          Pyroscope.stop();
        } catch {
          // Ignore stop error
        }
      }
    } catch (err) {
      console.error('OTel shutdown error:', err);
    }
  };

  // once (not on): Nest enableShutdownHooks + cluster worker drain also
  // react to the same signal; double-invoking sdk.shutdown warns.
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}
