import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { trace, SpanStatusCode } from '@opentelemetry/api';
import { createLogger } from '@repo/observability';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = createLogger('http-exception');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const responseBody = this.normalizeMessage(exception, status);

    // Enrich the active OpenTelemetry span. P5: isRecording() guard — the
    // server span may be ended by the time the filter runs under saturation;
    // late writes would warn "ended Span" (see observability.interceptor.ts).
    const activeSpan = trace.getActiveSpan();
    if (activeSpan?.isRecording()) {
      activeSpan.setAttribute('http.response.status_code', status);
      activeSpan.setAttribute(
        'error.type',
        exception instanceof HttpException
          ? exception.name
          : exception instanceof Error
            ? exception.constructor.name
            : 'UnknownException',
      );
      activeSpan.setStatus({
        code: SpanStatusCode.ERROR,
        message: exception instanceof Error ? exception.message : String(exception),
      });
      if (exception instanceof Error) {
        activeSpan.recordException(exception);
      }
    }

    if (status >= 500) {
      this.logger.error({
        method: request.method,
        url: request.url,
        status,
        err: exception instanceof Error ? exception : undefined,
        msg: `${request.method} ${request.url} ${status}`,
      });
    }

    // Late-filter guard: if headers/body already sent (SSE, proxied stream,
    // auth middleware wrote first), writing again throws ERR_HTTP_HEADERS_SENT.
    // Nest's BaseExceptionFilter checks isHeadersSent() the same way.
    if (response.headersSent || response.writableEnded) {
      this.logger.warn({
        method: request.method,
        url: request.url,
        status,
        msg: 'Skipping error response, headers already sent',
      });
      try {
        response.end();
      } catch {
        // Socket already torn down — nothing left to do.
      }
      return;
    }

    response.status(status).json({
      // Envelope fields are applied AFTER the exception body so a crafted
      // HttpException response can never spoof statusCode/timestamp/path.
      ...responseBody,
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }

  private normalizeMessage(
    exception: unknown,
    status: number,
  ): Record<string, unknown> {
    if (exception instanceof HttpException) {
      const res = exception.getResponse();

      if (typeof res === 'string') {
        return { message: res };
      }

      if (typeof res === 'object' && res !== null) {
        return res as Record<string, unknown>;
      }
    }

    if (status >= 500) {
      return { message: 'Internal server error' };
    }

    return { message: 'Request failed' };
  }
}
