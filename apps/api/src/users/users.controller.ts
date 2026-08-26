import { Controller, Get, Session } from '@nestjs/common';
import { db } from '@repo/database';
// Main-entry import: the api tsconfig uses Node10 resolution where package
// subpath exports do not resolve.
import {
  ADMIN_PLUGIN_ROLES,
  statement,
} from '@repo/auth';

import type { ServerSession } from '../common/session.utils';
import { getEffectiveUserId } from '../common/session.utils';

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
  @Get('me/role')
  async myRole(@Session() session: ServerSession) {
    const user = await db.user.findUnique({
      where: { id: session.user.id },
      select: { role: true },
    });
    return {
      role: (user?.role as string | null | undefined) ?? 'user',
    };
  }

  @Get('me/permissions')
  async myPermissions(@Session() session: ServerSession) {
    const effectiveId = getEffectiveUserId(session);

    const user = await db.user.findUnique({
      where: { id: effectiveId },
      select: { role: true },
    });
    // Mirror better-auth: empty/null role falls back to the configured
    // defaultRole ('user').
    const rawRoles = (user?.role as string | null | undefined) || 'user';
    const roleTokens = rawRoles.split(',');

    const permissions: Record<AppResource, string[]> = {
      notes: [],
      settings: [],
    };

    for (const resource of APP_RESOURCES) {
      for (const action of statement[resource]) {
        const allowed = roleTokens.some(
          (token) =>
            ADMIN_PLUGIN_ROLES[token]?.authorize({
              [resource]: [action],
            })?.success === true,
        );
        if (allowed && !permissions[resource].includes(action)) {
          permissions[resource].push(action);
        }
      }
    }

    return { userId: effectiveId, role: rawRoles, permissions };
  }
}
