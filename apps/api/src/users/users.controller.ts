import { Controller, Get, Query, Session } from '@nestjs/common';
import { db } from '@repo/database';

import type { ServerSession } from '../common/session.utils';
import { getEffectiveUserId } from '../common/session.utils';
import {
  AuthorizationService,
  evaluateAppPermissions,
} from '../common/authorization.service';

/**
 * App-level permission resources exposed to the web tier. Deliberately NOT
 * the full Better Auth statement - browsers only gate UI on these.
 */
const APP_RESOURCES = ['notes', 'settings'] as const;

type AppResource = (typeof APP_RESOURCES)[number];

/**
 * Fresh identity lookups for the web tier:
 * - GET me/role         CURRENT raw role from the primary store so a stale
 *                       session snapshot can never keep elevated UI alive
 *                       after an admin demotes the user.
 * - GET me/permissions  Per-action permission verdicts for the EFFECTIVE user
 *                       (the impersonating admin while impersonation is
 *                       active), evaluated with the exact algorithm
 *                       better-auth's admin plugin uses
 *                       (`has-permission.mjs`: split the role string on ",",
 *                       grant if ANY known role authorizes, fall back to the
 *                       "user" default) against the same access-control
 *                       roles registered in the auth config. This replaces
 *                       direct /api/auth/admin/has-permission calls from web:
 *                       that endpoint always evaluates the SESSION user's
 *                       permissions and ignores body.userId whenever a cookie
 *                       is forwarded, which silently broke impersonation
 *                       semantics. Evaluation is local to the fetched user
 *                       row - one query per request, no per-action fan-out.
 *
 * Scope note — these endpoints intentionally answer DIFFERENT questions:
 *   - me/role        → the SESSION user (the browsed account while an admin
 *                      impersonates it). DashboardShell uses it to hide admin
 *                      chrome in the impersonated view.
 *   - me/permissions → the EFFECTIVE user (the acting admin while
 *                      impersonating), matching server-side enforcement.
 * Do NOT "unify" them; unify only if product semantics change.
 */
@Controller('users')
export class UsersController {
  constructor(private readonly authz: AuthorizationService) {}

  @Get('me/role')
  async myRole(@Session() session: ServerSession) {
    // Single implementation via AuthorizationService: identical
    // query, plus the per-request memo when other checks run in this request.
    return {
      role: await this.authz.getFreshRoleRaw(session.user.id),
    };
  }

  @Get('me/permissions')
  async myPermissions(@Session() session: ServerSession) {
    const effectiveId = getEffectiveUserId(session);

    const rawRoles = await this.authz.getFreshRoleRaw(effectiveId);
    // Mirror better-auth: empty/null role falls back to the configured
    // defaultRole ('user'). Local evaluation — same algorithm as the admin
    // plugin, no per-action fan-out, one query per request.
    const permissions = evaluateAppPermissions(rawRoles);

    return { userId: effectiveId, role: rawRoles, permissions };
  }

  /**
   * Combined bootstrap: session identity +
   * effective permissions in ONE HTTP round trip and ONE AuthGuard session
   * resolution. Supports optional `?with=accounts` to coalesce linked
   * account queries for the Settings page.
   *
   * Replaces the web-tier pattern `getSessionFromApi + getMyPermissions + listAccounts`
   * (3 HTTP, 3 session lookups) with a single call.
   * - Non-impersonated (common): 1x `findUnique role`.
   * - Impersonating: 2x in parallel (session user vs effective user rows
   *   differ) — still 1 HTTP instead of 2.
   *
   * Semantics preserved (do NOT unify without product change):
   * - `role` = SESSION user (DashboardShell hides admin chrome in view).
   * - `effectiveRole`/`permissions` = EFFECTIVE user (enforcement verdicts).
   */
  @Get('me/bootstrap')
  async myBootstrap(
    @Session() session: ServerSession,
    @Query('with') withParam?: string,
  ) {
    const sessionUserId = session.user.id;
    const effectiveId = getEffectiveUserId(session);
    const impersonatedBy =
      (session as { session?: { impersonatedBy?: string | null } }).session
        ?.impersonatedBy ?? null;

    const includeAccounts =
      withParam?.split(',').map((s) => s.trim()).includes('accounts') ?? false;

    // Session-user profile for pages that render identity (Settings) —
    // same row as the role read, no extra query. Falls back to the
    // cookie snapshot only if the row vanished mid-request. Impersonated
    // path fetches both rows in parallel (reviewer nit: was sequential).
    const sessionProfilePromise = db.user.findUnique({
      where: { id: sessionUserId },
      select: {
        id: true,
        name: true,
        email: true,
        emailVerified: true,
        image: true,
        role: true,
      },
    });
    const effectiveRolePromise =
      sessionUserId === effectiveId
        ? null
        : this.authz.getFreshRoleRaw(effectiveId);
    const accountsPromise = includeAccounts
      ? db.account.findMany({
          where: { userId: sessionUserId },
          select: { id: true, providerId: true, accountId: true },
        })
      : null;

    const [sessionProfile, effectiveRoleOrNull, accountsList] =
      await Promise.all([
        sessionProfilePromise,
        effectiveRolePromise,
        accountsPromise,
      ]);
    const role =
      (sessionProfile?.role as string | null | undefined) ?? 'user';
    const effectiveRole = effectiveRoleOrNull ?? role;
    return {
      userId: effectiveId,
      sessionUserId,
      role,
      effectiveRole,
      permissions: evaluateAppPermissions(effectiveRole),
      impersonatedBy,
      sessionUser: {
        id: sessionProfile?.id ?? sessionUserId,
        name: sessionProfile?.name ?? session.user.name,
        email: sessionProfile?.email ?? session.user.email,
        emailVerified:
          sessionProfile?.emailVerified ?? session.user.emailVerified,
        image: sessionProfile?.image ?? session.user.image ?? null,
      },
      ...(accountsList ? { accounts: accountsList } : {}),
    };
  }
}
