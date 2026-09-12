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

    // Enrich the active OpenTelemetry span
    const activeSpan = trace.getActiveSpan();
    if (activeSpan) {
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
