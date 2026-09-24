import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

import type { ServerSession } from './session.utils';

/**
 * Request-scoped authentication context.
 *
 * Problem: the global AuthGuard resolves the Better Auth session once per
 * HTTP request onto `req.session`, but every downstream consumer re-derived
 * the same facts independently (session → ids → role), which caused logic
 * drift (two `findUnique({ role })` implementations) and would regrow
 * duplicate session/role lookups as helpers multiply.
 *
 * Model (AsyncLocalStorage, zero new dependencies):
 * - `requestContextMiddleware` (Express, registered FIRST in main.ts) creates
 *   one store per incoming HTTP request and runs the entire downstream chain
 *   (guards → interceptors → handlers) inside `als.run()`. When the response
 *   finishes the store is garbage-collected — no manual cleanup, no leaks.
 * - `RequestContextInterceptor` (APP_INTERCEPTOR, runs AFTER the vendor
 *   AuthGuard) copies the already-resolved `req.session` into the store and
 *   derives ids + client metadata ONCE. It never calls getSession itself.
 * - `AuthorizationService.getFreshRoleRaw` memoizes per (request, userId).
 *
 * Safety rules (do not weaken):
 * - The cache is PER-REQUEST. Every new HTTP request gets a fresh store, so
 *   cross-request freshness is identical to before: role/ban/delete/revoke
 *   are still enforced from PostgreSQL on the next request. NEVER cache
 *   across requests (no module-level Maps, no TTL caches of roles).
 * - Background work (AuditQueueService, Better Auth backgroundTasks) MUST
 *   NOT read this store — it is undefined outside a request. Capture values
 *   at emit time (see audit-writer.ts `buildAuditRowData`); `getRequestContext()`
 *   returns `undefined` there by design, and all readers fall back to
 *   explicit parameters.
 * - Single-threaded Node has no thread-safety concern; ALS propagates
 *   through await/Promises/streams within the request. Better Auth's own
 *   /api/auth/* routes bypass Nest interceptors (raw Express mount), so the
 *   store simply has no session there — auth-tier hooks keep their own
 *   `getSessionFromCtx` path, unchanged.
 */
export type RequestContext = {
  /** Stable id for correlating logs within one request. */
  requestId: string;
  /** Session resolved by the vendor AuthGuard (`req.session`). Absent on anonymous routes. */
  session?: ServerSession;
  /** `session.user.id` — the browsed account while impersonating. */
  sessionUserId?: string;
  /** Acting user — the impersonating admin when active. */
  effectiveUserId?: string;
  impersonatedBy?: string | null;
  clientMeta?: { ip: string | null; userAgent: string | null };
  /** Per-request memo of userId → fresh DB role. NEVER survives the request. */
  roleCache: Map<string, string>;
};

const storage = new AsyncLocalStorage<RequestContext>();

export function createRequestContext(): RequestContext {
  return { requestId: randomUUID(), roleCache: new Map() };
}

/** The current request's context, or `undefined` outside a request (workers, tests, boot). */
export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

/**
 * Express middleware: establishes the store for the whole downstream chain.
 * Registered FIRST in main.ts so metrics/logging/auth all run inside it.
 */
export function requestContextMiddleware(
  _req: Request,
  _res: Response,
  next: NextFunction,
): void {
  storage.run(createRequestContext(), () => next());
}
