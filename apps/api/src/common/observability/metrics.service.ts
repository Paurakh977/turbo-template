import { Injectable, OnModuleInit } from '@nestjs/common';
import { performance, monitorEventLoopDelay } from 'node:perf_hooks';
import type { IntervalHistogram } from 'node:perf_hooks';
import { getMeter, LATENCY_BUCKETS } from '@repo/observability';
import { getPoolStats, addPoolErrorListener } from '@repo/database';
import type { Counter, Histogram, Gauge } from '@opentelemetry/api';

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
  private poolAcquireErrorsTotal!: Counter;

  // Measurement support: Node built-in event-loop delay sampler (no new
  // dependency). Enabled once in onModuleInit; read on Prometheus scrape.
  private eventLoopDelaySampler!: IntervalHistogram;
  // Previous ELU snapshot for interval semantics (see onModuleInit below).
  private eventLoopUtilBaseline?:
    | ReturnType<typeof performance.eventLoopUtilization>
    | undefined;

  // Audit Queue Metrics
  private auditQueueEnqueuedTotal!: Counter;
  private auditQueueProcessedTotal!: Counter;
  private auditQueueRetryTotal!: Counter;
  private auditQueueFailedTotal!: Counter;
  private auditQueueDlqTotal!: Counter;
  private auditQueueDepthGauge!: Gauge;
  private auditQueueProcessingGauge!: Gauge;
  private auditQueueDrainDuration!: Histogram;
  private auditQueueProcessingDuration!: Histogram;
  private auditQueuePurgedTotal!: Counter;
  private auditQueuePurgeDuration!: Histogram;

  onModuleInit() {
    const meter = getMeter('api');

    // Event-loop saturation gauges (Node built-ins, scraped via the
    // existing Prometheus pipeline — no new libraries). Utilization answers
    // "is the event loop CPU-bound?"; delay answers "how long do
    // timers/callbacks wait?". Both feed the cluster-vs-replicas decision.
    //
    // CORRECTNESS: eventLoopUtilization() with no args returns a
    // cumulative-since-start snapshot (a lagging indicator). Interval
    // semantics require diffing two snapshots, so each scrape stores its
    // snapshot as the next scrape's baseline; the observed value is the true
    // per-scrape-interval utilization. First scrape after boot emits nothing.
    //
    // Per-worker attribution comes from service.instance.id (otel.ts), which
    // separates EVERY signal per worker — no per-instrument labels needed.
    this.eventLoopDelaySampler = monitorEventLoopDelay({ resolution: 10 });
    this.eventLoopDelaySampler.enable();
    meter
      .createObservableGauge('nodejs_eventloop_utilization_ratio', {
        description:
          'Per-scrape-interval fraction of event-loop time spent executing (0-1). Sustained >0.8 at the RPS ceiling means CPU-bound: scale workers/replicas.',
        unit: '{ratio}',
      })
      .addCallback((observableResult) => {
        const current = performance.eventLoopUtilization();
        if (this.eventLoopUtilBaseline) {
          const interval = performance.eventLoopUtilization(
            current,
            this.eventLoopUtilBaseline,
          );
          observableResult.observe(interval.utilization);
        }
        this.eventLoopUtilBaseline = current;
      });
    meter
      // NOTE: the OTLP→Prometheus translation appends the unit, so this
      // exports as `nodejs_eventloop_delay_milliseconds` — query that name.
      .createObservableGauge('nodejs_eventloop_delay', {
        description:
          'Mean event-loop delay in milliseconds (10ms sampling resolution).',
        unit: 'ms',
      })
      .addCallback((observableResult) => {
        // mean is nanoseconds; NaN before the first sample interval.
        const meanMs = this.eventLoopDelaySampler.mean / 1e6;
        observableResult.observe(Number.isFinite(meanMs) ? meanMs : 0);
      });

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

    this.poolAcquireErrorsTotal = meter.createCounter(
      'db_pool_acquire_errors_total',
      {
        description: 'Total number of database pool acquisition failures or errors',
      },
    );

    // Audit Queue Metrics initialization
    this.auditQueueEnqueuedTotal = meter.createCounter(
      'audit_queue_enqueued_total',
      { description: 'Total number of audit events enqueued' },
    );
    this.auditQueueProcessedTotal = meter.createCounter(
      'audit_queue_processed_total',
      { description: 'Total number of audit events successfully processed' },
    );
    this.auditQueueRetryTotal = meter.createCounter('audit_queue_retry_total', {
      description: 'Total number of audit event processing retries',
    });
    this.auditQueueFailedTotal = meter.createCounter(
      'audit_queue_failed_total',
      { description: 'Total number of audit event processing attempts failed' },
    );
    this.auditQueueDlqTotal = meter.createCounter('audit_queue_dlq_total', {
      description: 'Total number of audit events sent to dead letter queue/dropped',
    });
    this.auditQueueDepthGauge = meter.createGauge('audit_queue_depth', {
      description: 'Current number of items in the audit queue',
      unit: '{items}',
    });
    this.auditQueueProcessingGauge = meter.createGauge(
      'audit_queue_processing',
      {
        description: 'Whether the audit queue is currently processing (1 or 0)',
        unit: '{status}',
      },
    );
    this.auditQueueDrainDuration = meter.createHistogram(
      'audit_queue_drain_duration_seconds',
      {
        description: 'Duration of full audit queue drain cycles in seconds',
        unit: 's',
        advice: { explicitBucketBoundaries: [...LATENCY_BUCKETS] },
      },
    );
    this.auditQueueProcessingDuration = meter.createHistogram(
      'audit_queue_processing_duration_seconds',
      {
        description: 'Duration of individual audit row processing in seconds',
        unit: 's',
        advice: {
          explicitBucketBoundaries: [
            0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5,
          ],
        },
      },
    );
    this.auditQueuePurgedTotal = meter.createCounter(
      'audit_queue_purged_total',
      { description: 'Total number of DONE audit outbox rows purged by retention' },
    );
    this.auditQueuePurgeDuration = meter.createHistogram(
      'audit_queue_purge_duration_seconds',
      {
        description: 'Duration of audit outbox retention purge cycles in seconds',
        unit: 's',
        advice: { explicitBucketBoundaries: [...LATENCY_BUCKETS] },
      },
    );

    // Database Pool Observable Gauges
    meter
      .createObservableGauge('db_pool_connections', {
        description: 'PostgreSQL connection pool state',
        unit: '{connections}',
      })
      .addCallback((observableResult) => {
        const stats = getPoolStats();
        observableResult.observe(stats.totalCount, { state: 'total' });
        observableResult.observe(stats.idleCount, { state: 'idle' });
        observableResult.observe(Math.max(0, stats.totalCount - stats.idleCount), {
          state: 'used',
        });
        observableResult.observe(stats.max, { state: 'max' });
      });

    meter
      .createObservableGauge('db_pool_waiting_requests', {
        description:
          'Number of requests currently waiting for a database connection',
        unit: '{requests}',
      })
      .addCallback((observableResult) => {
        const stats = getPoolStats();
        observableResult.observe(stats.waitingCount);
      });

    addPoolErrorListener((err) => {
      this.poolAcquireErrorsTotal.add(1, {
        error_type: err?.name || 'Error',
      });
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
    // Single canonical status label (OTel http.response.status_code ->
    // Prometheus http_response_status_code). The legacy status_code duplicate
    // doubled series cardinality and split dashboards/alerts across two names;
    // dashboards 01/02/04/06 + alerts + recording rules were renamed atomically.
    const attrs = {
      method: method.toUpperCase(),
      route: normalizedRoute,
      http_response_status_code: String(statusCode),
    };
    // Wall-clock clamp: Date.now() is wall-clock, not monotonic — NTP step-back, VM
    // suspend/resume, or Docker clock sync can yield a negative duration,
    // which the OTel SDK rejects with an error (previously spammed logs under
    // load). Clamp to 0: identical output for every valid sample; former
    // errors become lowest-bucket zeros instead of dropped observations.
    this.requestDuration.record(Math.max(0, durationMs) / 1000, attrs);
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

  /**
   * Records a database pool acquire failure or timeout
   */
  recordPoolAcquireError(errorType: string = 'timeout') {
    this.poolAcquireErrorsTotal.add(1, {
      error_type: errorType,
    });
  }

  /**
   * Records an audit event being enqueued. Depth is NOT updated here —
   * recording a synthetic 0/unknown clobbered the gauge; refreshDepthGauge
   * owns audit_queue_depth after each poll batch.
   */
  recordAuditQueueEnqueue(action: string) {
    this.auditQueueEnqueuedTotal.add(1, { action });
  }

  /**
   * Records an audit row successfully processed
   */
  recordAuditQueueProcessed(action: string, durationSeconds: number) {
    this.auditQueueProcessedTotal.add(1, { action });
    // Same wall-clock clamp as recordHttpRequest (see above).
    this.auditQueueProcessingDuration.record(Math.max(0, durationSeconds), {
      action,
    });
  }

  /**
   * Records an audit event retry attempt
   */
  recordAuditQueueRetry(action: string) {
    this.auditQueueRetryTotal.add(1, { action });
  }

  /**
   * Records an audit event failure, distinguishing terminal DLQ drops
   */
  recordAuditQueueFailed(action: string, isTerminalDlq: boolean) {
    this.auditQueueFailedTotal.add(1, { action });
    if (isTerminalDlq) {
      this.auditQueueDlqTotal.add(1, { action });
    }
  }

  /**
   * Updates the current audit queue depth
   */
  recordAuditQueueDepth(depth: number) {
    this.auditQueueDepthGauge.record(depth);
  }

  /**
   * Updates whether the audit queue is actively draining
   */
  recordAuditQueueProcessingStatus(isProcessing: boolean) {
    this.auditQueueProcessingGauge.record(isProcessing ? 1 : 0);
  }

  /**
   * Records the total duration of a queue drain cycle
   */
  recordAuditQueueDrainDuration(durationSeconds: number) {
    // Same wall-clock clamp as recordHttpRequest (see above).
    this.auditQueueDrainDuration.record(Math.max(0, durationSeconds));
  }

  /**
   * Records a retention purge cycle.
   */
  recordAuditQueuePurged(count: number, durationSeconds: number) {
    if (count > 0) this.auditQueuePurgedTotal.add(count);
    this.auditQueuePurgeDuration.record(Math.max(0, durationSeconds));
  }
}

