import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  HttpException,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import { throwError } from 'rxjs';
import { trace, SpanStatusCode } from '@opentelemetry/api';
import type { Request, Response } from 'express';
import { AppAttributes, HttpAttributes } from '@repo/observability';

/**
 * NestJS interceptor that enriches the active OTel span with route metadata.
 *
 * NOTE: HTTP metrics (duration, count, errors) are recorded by the catch-all
 * Express middleware in main.ts, which captures ALL responses including 404s
 * from unmatched routes. This interceptor only handles span enrichment for
 * routes that match a NestJS controller.
 *
 * NOTE: Auth event tracking is handled by a separate Express middleware in
 * main.ts because Better Auth routes bypass NestJS interceptors.
 */
@Injectable()
export class ObservabilityInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();

    const activeSpan = trace.getActiveSpan();

    // Derive route template (e.g. /api/notes/:id) and feature name.
    // Normalization mirrors normalizeRouteForMetrics in metrics.service.ts
    // (query stripped, 20+ alnum-dash + numeric segments -> :id) so spans and
    // Prometheus series agree; prefer the Express route template when present.
    const rawPath = req.baseUrl || req.path || req.url || '';
    const routeTemplate = req.route?.path
      ? `${req.baseUrl || ''}${req.route.path}`
      : (rawPath.split('?')[0] || '')
          .replace(/\/[A-Za-z0-9_-]{20,}(?=\/|$)/g, '/:id')
          .replace(/\/\d+(?=\/|$)/g, '/:id');

    const feature = this.extractFeature(rawPath);

    if (activeSpan) {
      activeSpan.setAttribute(HttpAttributes.ROUTE_TEMPLATE, routeTemplate);
      activeSpan.setAttribute(AppAttributes.FEATURE, feature);
    }

    return next.handle().pipe(
      tap({
        next: () => {
          const statusCode = res.statusCode || 200;

          if (activeSpan) {
            activeSpan.setAttribute('http.response.status_code', statusCode);
            if (statusCode >= 400) {
              activeSpan.setStatus({
                code: SpanStatusCode.ERROR,
                message: `HTTP ${statusCode}`,
              });
            } else {
              activeSpan.setStatus({ code: SpanStatusCode.OK });
            }
          }
        },
      }),
      catchError((error) => {
        const statusCode =
          error instanceof HttpException ? error.getStatus() : 500;

        if (activeSpan) {
          activeSpan.setAttribute('http.response.status_code', statusCode);
          activeSpan.setStatus({
            code: SpanStatusCode.ERROR,
            message: error instanceof Error ? error.message : 'Unknown error',
          });
        }

        return throwError(() => error);
      }),
    );
  }

  private extractFeature(path: string): string {
    if (path.includes('/auth')) return 'auth';
    if (path.includes('/notes')) return 'notes';
    if (path.includes('/audit')) return 'audit';
    if (path.includes('/users')) return 'users';
    if (path.includes('/links')) return 'links';
    if (path.includes('/rate-limit')) return 'rate-limit';
    if (path.includes('/health')) return 'health';
    return 'api';
  }
}
