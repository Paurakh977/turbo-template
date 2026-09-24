import { Injectable, ForbiddenException } from '@nestjs/common';
import { db } from '@repo/database';
import { ADMIN_PLUGIN_ROLES, statement } from '@repo/auth';
import { parseRoles } from '@repo/roles';

import { getRequestContext } from './request-context';

/**
 * Central authorization service — single source of permission evaluation.
 *
 * Why this exists:
 * - Before: PATCH /api/notes read the same user row 2-3x per request
 *   (`userHasPermission()` internally fetches the user + `getFreshRoleRaw()`
 *   + earlier `GET /me/permissions`). Each read was a PostgreSQL round trip.
 * - After: one authoritative `db.user.findUnique({ role })` per API request,
 *   then local evaluation against the SAME `ADMIN_PLUGIN_ROLES` / `statement`
 *   objects registered in the Better Auth config. No duplicated AccessControl
 *   logic, no per-action fan-out.
 *
 * Freshness guarantee:
 * - NEVER trusts the Redis-cached session snapshot (`session.user.role`) or
 *   the browser snapshot for authorization. Always reads the primary store.
 * - Combined with `invalidateUserCache()` on role/ban/delete/revoke, role
 *   changes are effective immediately (next request misses Redis, hits DB).
 *
 * Request-context model (ALS):
 * - The global AuthGuard resolves the Better Auth session exactly once per
 *   incoming HTTP request and stores it on `req.session` (`@Session()`).
 *   Services MUST consume that `@Session()` object and never call
 *   `auth.api.getSession` / `getSessionFromCtx` again within the same request.
 * - `RequestContextInterceptor` copies the resolved session into the ALS
 *   store (see request-context.ts); this service memoizes fresh role reads
 *   per (request, userId) in `store.roleCache`. The memo NEVER crosses
 *   requests — every HTTP request gets a fresh store — so enforcement
 *   freshness is unchanged: the next request after a role/ban/revoke still
 *   reads PostgreSQL. Outside a request (workers, tests) the memo is skipped
 *   and the DB is read directly.
 */

export const APP_RESOURCES = ['notes', 'settings'] as const;
export type AppResource = (typeof APP_RESOURCES)[number];
export type AppPermissions = Record<AppResource, string[]>;

/**
 * Application-canonical permission evaluation.
 *
 * Boundary contract:
 * - DB stores comma string (`serializeRoles`), JWT carries string[] array
 *   (`auth.ts`), Better Auth's own `has-permission.mjs` does raw `split(",")`
 *   with exact-token lookup (no trim). We intentionally do NOT mirror that
 *   quirk: all app-owned evaluation goes through `@repo/roles parseRoles`
 *   (trim + dedup + base-role normalize), which accepts string | string[] |
 *   JSON and is whitespace/duplicate safe. Writers canonicalize via
 *   `serializeRoles`, so `"admin, user"` and `["admin"]` converge.
 */
export function evaluateAppPermissions(roleRaw: unknown): AppPermissions {
  const roleTokens = parseRoles(roleRaw);
  const permissions: AppPermissions = { notes: [], settings: [] };
  for (const resource of APP_RESOURCES) {
    for (const action of statement[resource]) {
      const allowed = roleTokens.some(
        (token) =>
          ADMIN_PLUGIN_ROLES[token]?.authorize({ [resource]: [action] })
            ?.success === true,
      );
      if (allowed && !permissions[resource].includes(action)) {
        permissions[resource].push(action);
      }
    }
  }
  return permissions;
}

@Injectable()
export class AuthorizationService {
  /**
   * One authoritative role read from the primary store, memoized per
   * (request, userId) via the ALS store when inside a request. Repeated
   * checks for the same user within one request (permission + admin +
   * ownership, bootstrap + guard) collapse to a single `findUnique`.
   */
  async getFreshRoleRaw(userId: string): Promise<string> {
    const cached = getRequestContext()?.roleCache.get(userId);
    if (cached !== undefined) return cached;
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    const roleRaw = (user?.role as string | null | undefined) ?? 'user';
    getRequestContext()?.roleCache.set(userId, roleRaw);
    return roleRaw;
  }

  /** Local permission assertion — same verdicts as userHasPermission. */
  assertPermission(
    roleRaw: unknown,
    resource: AppResource,
    action: string,
  ): void {
    const allowed = evaluateAppPermissions(roleRaw)[resource]?.includes(action);
    if (!allowed) {
      throw new ForbiddenException(
        resource === 'notes' && action === 'delete'
          ? 'Only superAdmins can delete notes.'
          : `You do not have permission to ${action} ${resource}.`,
      );
    }
  }
}
