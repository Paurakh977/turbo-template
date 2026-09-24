import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import type { Observable } from 'rxjs';

import { extractClientMeta } from './client-meta';
import { getRequestContext } from './request-context';
import { getImpersonatedBy, type ServerSession } from './session.utils';

/**
 * Populates the ALS request context AFTER the vendor AuthGuard has resolved
 * the session. Ordering is structural, not coincidental: Nest runs
 * middleware → guards → interceptors → handlers, and this interceptor is
 * registered as APP_INTERCEPTOR while the session guard is an APP_GUARD, so
 * `req.session` is always settled when we read it.
 *
 * Deliberately read-only toward auth: no getSession call, no redirects, no
 * throws. Anonymous routes (health, public links) simply leave the session
 * fields unset; downstream code keeps its explicit `@Session()` parameters
 * as the source of truth and consults the context only as a memo.
 */
@Injectable()
export class RequestContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const store = getRequestContext();
    if (store) {
      const req = context.switchToHttp().getRequest() as {
        session?: ServerSession;
        ip?: string;
        headers?: Record<string, string | string[] | undefined>;
      };
      const session = req?.session;
      if (session?.user?.id) {
        const impersonatedBy = getImpersonatedBy(session);
        store.session = session;
        store.sessionUserId = session.user.id;
        store.impersonatedBy = impersonatedBy;
        store.effectiveUserId = impersonatedBy ?? session.user.id;
        store.clientMeta = extractClientMeta(
          req as Parameters<typeof extractClientMeta>[0],
        );
      }
    }
    return next.handle();
  }
}
