import { metrics, type Meter } from '@opentelemetry/api';

/** Standard HTTP latency histogram bucket boundaries (seconds) */
export const LATENCY_BUCKETS = [
  0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
] as const;

/**
 * Returns the OpenTelemetry Meter for creating application metrics
 */
export function getMeter(name: string = '@repo/observability'): Meter {
  return metrics.getMeter(name);
}
