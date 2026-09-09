import pino, { type Logger as PinoLogger, type LoggerOptions, type DestinationStream } from 'pino';
import { trace } from '@opentelemetry/api';
import { logs, type Logger as OTelLogger, type LogRecord, type LogAttributes } from '@opentelemetry/api-logs';

export type Logger = PinoLogger;

export interface LoggerOptionsConfig {
  level?: string;
  environment?: string;
}

// Pino level name → OTel SeverityNumber mapping
const OTEL_SEVERITY_MAP: Record<string, number> = {
  trace: 1,
  debug: 5,
  info: 9,
  warn: 13,
  error: 17,
  fatal: 21,
};

/**
 * Wraps a pino Logger to also emit each log record through OTel LoggerProvider → Loki.
 * Uses pino's `logger.on('level-change', ...)` is not available, so we wrap the destination stream.
 */
function wrapWithOtelBridge(
  logger: PinoLogger,
  otelLogger: OTelLogger,
  serviceName: string,
  environment: string,
): PinoLogger {
  const levels = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const target = logger as any;

  for (const lvl of levels) {
    const originalFn = target[lvl];
    if (typeof originalFn !== 'function') continue;

    const bound = originalFn.bind(logger);

    target[lvl] = function (...args: unknown[]): PinoLogger {
      const result = bound(...args);

      try {
        const logData = args[0];
        const attrs: LogAttributes = {
          'service.name': serviceName,
          'deployment.environment.name': environment,
        };

        let body: string;
        if (typeof logData === 'string') {
          body = logData;
        } else if (logData && typeof logData === 'object') {
          body = (logData as Record<string, unknown>).msg as string ||
            JSON.stringify(logData);
          for (const [k, v] of Object.entries(logData as Record<string, unknown>)) {
            if (k !== 'msg' && v !== undefined && v !== null && typeof v !== 'object') {
              attrs[k] = v as string | number | boolean;
            }
          }
        } else {
          body = String(logData);
        }

        const span = trace.getActiveSpan();
        if (span) {
          const ctx = span.spanContext();
          if (ctx?.traceId) {
            attrs['trace_id'] = ctx.traceId;
            attrs['span_id'] = ctx.spanId;
          }
        }

        otelLogger.emit({
          severityNumber: OTEL_SEVERITY_MAP[lvl] ?? 9,
          severityText: lvl.toUpperCase(),
          body,
          attributes: attrs,
        });
      } catch {
        // Best-effort
      }

      return result;
    };
  }

  return logger;
}

/**
 * Creates a structured JSON logger with automatic OpenTelemetry trace context injection.
 * - Always includes: ISO-8601 timestamp, level, service, environment
 * - When OTel span is active: injects trace_id and span_id into every log record
 * - When OTel LoggerProvider is available: emits log records through OTel pipeline → Loki
 */
export function createLogger(
  serviceName: string,
  options?: LoggerOptionsConfig,
): Logger {
  const environment =
    options?.environment ||
    process.env.OTEL_ENVIRONMENT ||
    process.env.NODE_ENV ||
    'development';
  const level =
    options?.level ||
    process.env.OTEL_LOG_LEVEL ||
    (environment === 'production' ? 'info' : 'debug');

  let otelLogger: OTelLogger | undefined;
  try {
    otelLogger = logs.getLogger(serviceName, '1.0.0');
  } catch {
    // OTel SDK not initialized — logs go to stdout only
  }

  const pinoOptions: LoggerOptions = {
    level,
    base: {
      service: serviceName,
      environment,
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    mixin() {
      const span = trace.getActiveSpan();
      if (!span) return {};
      const ctx = span.spanContext();
      if (!ctx || !ctx.traceId) return {};
      return {
        trace_id: ctx.traceId,
        span_id: ctx.spanId,
      };
    },
    formatters: {
      level(label) {
        return { level: label };
      },
    },
  };

  const logger = pino(pinoOptions);

  // Bridge pino → OTel LoggerProvider so logs reach Loki via Alloy
  if (otelLogger) {
    return wrapWithOtelBridge(logger, otelLogger, serviceName, environment);
  }

  return logger;
}
