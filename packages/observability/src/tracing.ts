import {
  trace,
  SpanStatusCode,
  type Span,
  type SpanOptions,
} from '@opentelemetry/api';

export { trace, SpanStatusCode, type Span, type SpanOptions };

const tracer = trace.getTracer('@repo/observability');

/**
 * Executes an async function within an active child span.
 * - Spans automatically inherit the ambient active trace context
 * - Errors set status to ERROR and record exceptions
 * - Always ends the span in a finally block
 */
export async function withSpan<T>(
  name: string,
  fn: (span: Span) => Promise<T>,
  options?: SpanOptions,
): Promise<T> {
  return tracer.startActiveSpan(name, options ?? {}, async (span) => {
    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error),
      });
      if (error instanceof Error) {
        span.recordException(error);
      }
      throw error;
    } finally {
      span.end();
    }
  });
}

/**
 * Records an error on the currently active span if one exists.
 * Safe to call even when no span is active.
 */
export function recordError(error: Error | unknown, message?: string): void {
  const span = trace.getActiveSpan();
  if (!span) return;
  if (error instanceof Error) {
    span.recordException(error);
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: message || error.message,
    });
  } else {
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: message || String(error),
    });
  }
}
