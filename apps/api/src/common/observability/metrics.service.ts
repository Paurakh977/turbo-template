import { Injectable, OnModuleInit } from '@nestjs/common';
import { getMeter, LATENCY_BUCKETS } from '@repo/observability';
import type { Counter, Histogram } from '@opentelemetry/api';

/**
 * Single owner for Prometheus `route` label normalization.
 * Raw paths (e.g. `/api/notes/<id>`) would create one series per ID under
 * load and OOM Prometheus over a 15d retention — strip the query string and
 * collapse ID-looking segments to `:id`. Covers UUIDs, Mongo ObjectIds,
 * Prisma cuid()/cuid2, nanoids and opaque tokens.
 *
 * INVARIANT (locked by normalize-route.spec.ts): every static route segment
 * in this API is < 20 chars, so the 20-char floor can never swallow a real
 * route template. If you add a static segment ≥ 20 chars, extend the spec
 * first — a collapsed template merges that route's series into `:id`.
 *
 * Callers should normalize before calling, but the record* methods below also
 * normalize defensively so a future caller can't blow cardinality by accident.
 * Keep in sync with the span template in observability.interceptor.ts.
 */
export function normalizeRouteForMetrics(rawPath: string): string {
  return (String(rawPath || '').split('?')[0] || '')
    // ID-like segments: 20+ of [A-Za-z0-9_-], whole-segment only (lookahead
    // prevents partial matches inside longer slugs).
    .replace(/\/[A-Za-z0-9_-]{20,}(?=\/|$)/g, '/:id')
    // Short pure-numeric IDs (e.g. /api/items/123).
    .replace(/\/\d+(?=\/|$)/g, '/:id');
}

@Injectable()
export class MetricsService implements OnModuleInit {
  private requestDuration!: Histogram;
  private requestsTotal!: Counter;
  private errorsTotal!: Counter;
  private authEventsTotal!: Counter;
  private authRateLimitHitsTotal!: Counter;
  private notesOpsTotal!: Counter;

  onModuleInit() {
    const meter = getMeter('api');

    this.requestDuration = meter.createHistogram(
      'http_server_request_duration_seconds',
      {
        description: 'Duration of HTTP server requests in seconds',
        unit: 's',
        advice: { explicitBucketBoundaries: [...LATENCY_BUCKETS] },
      },
    );

    this.requestsTotal = meter.createCounter('http_server_requests_total', {
      description: 'Total number of HTTP server requests',
    });

    this.errorsTotal = meter.createCounter('http_server_errors_total', {
      description: 'Total number of HTTP server errors',
    });

    this.authEventsTotal = meter.createCounter('auth_events_total', {
      description: 'Total number of authentication events',
    });

    this.authRateLimitHitsTotal = meter.createCounter(
      'auth_rate_limit_hits_total',
      {
        description: 'Total number of auth rate limit hits',
      },
    );

    this.notesOpsTotal = meter.createCounter('notes_operations_total', {
      description: 'Total number of notes domain operations',
    });
  }

  /**
   * Records an HTTP server request duration and count
   */
  recordHttpRequest(
    method: string,
    route: string,
    statusCode: number,
    durationMs: number,
  ) {
    const normalizedRoute = normalizeRouteForMetrics(route);
    const attrs = {
      method: method.toUpperCase(),
      route: normalizedRoute,
      status_code: String(statusCode),
      http_response_status_code: String(statusCode),
    };
    this.requestDuration.record(durationMs / 1000, attrs);
    this.requestsTotal.add(1, attrs);
  }

  /**
   * Records an HTTP error with bounded error type
   */
  recordHttpError(method: string, route: string, errorType: string) {
    this.errorsTotal.add(1, {
      method: method.toUpperCase(),
      route: normalizeRouteForMetrics(route),
      error_type: errorType,
    });
  }

  /**
   * Records an authentication event (bounded labels only)
   */
  recordAuthEvent(
    action: string,
    status: 'success' | 'failure',
    method: string = 'email',
  ) {
    this.authEventsTotal.add(1, {
      action,
      status,
      method,
    });
  }

  /**
   * Records a rate limit hit for an auth or API route
   */
  recordRateLimitHit(route: string) {
    this.authRateLimitHitsTotal.add(1, {
      route: normalizeRouteForMetrics(route),
    });
  }

  /**
   * Records a notes domain operation
   */
  recordNoteOperation(operation: string, status: 'success' | 'failure') {
    this.notesOpsTotal.add(1, {
      operation,
      status,
    });
  }
}
