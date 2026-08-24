'use server';

import { isAPIError } from 'better-auth/api';
import { headers } from 'next/headers';
import { getAdminUserFromApi, sendVerificationEmailFromApi } from '../../lib/server/auth-http';
import { canActOn, getPrimaryRole } from '@repo/roles';
import { requireAdmin } from '../../lib/require-admin';
import { buildAbsoluteUrl } from '../../lib/app-url';
import { getAppBaseUrl } from '../../lib/server/app-url';
import {
  checkServerActionRateLimit,
  getServerActionRateLimitMessage,
} from '../../lib/server-action-rate-limit';

type ActionResult = { success: boolean } | { error: string };

async function enforceRateLimit(
  identifier: string,
  action: string,
): Promise<ActionResult | null> {
  const result = await checkServerActionRateLimit({
    scope: `admin:${action}`,
    identifier,
    windowMs: 60_000,
    max: 5,
    failOpen: false,
  });

  if (!result.allowed) {
    return { error: getServerActionRateLimitMessage(result.retryAfterMs) };
  }
  return null;
}

/**
 * Re-sends the verification email for a user.
 *
 * Security model:
 * - Authorization: requireAdmin() server-side (redirects non-admins).
 * - Hierarchy guard: admins cannot act on peers/superiors (canActOn).
 * - Rate limit: server-action rate limiter (5/min per actor).
 * - Enumeration safety: the Better Auth sendVerificationEmail endpoint
 *   returns a success-looking response for unknown emails on the
 *   UNAUTHENTICATED path. We intentionally call it WITHOUT headers —
 *   the authenticated path throws EMAIL_MISMATCH when the admin's session
 *   email differs from the target user's email. Authz + hierarchy are
 *   enforced here in the action instead.
 */
export async function resendVerificationEmailAction(
  userId: string,
): Promise<ActionResult> {
  const session = await requireAdmin();

  const rateLimitError = await enforceRateLimit(session.user.id, 'resend-verification');
  if (rateLimitError) return rateLimitError;

  if (!userId) return { error: 'Invalid user.' };

  // Admin-guarded lookup served by the API tier (Better Auth admin plugin).
  const target = await getAdminUserFromApi(userId, await headers()).catch(() => null);

  if (!target) return { error: 'User not found.' };

  const targetRole = getPrimaryRole(target.role ?? 'user');
  if (
    !canActOn(
      session.isSuperAdmin ? 'superAdmin' : session.user.role ?? 'user',
      targetRole,
    )
  ) {
    return {
      error: 'You cannot act on a user with equal or higher privileges.',
    };
  }

  if (target.emailVerified) {
    return { error: 'This user has already verified their email.' };
  }

  const baseUrl = await getAppBaseUrl();

  // IMPORTANT: call WITHOUT headers — the unauthenticated path is
  // enumeration-safe (returns the same response for unknown emails), while
  // the authenticated path throws EMAIL_MISMATCH when the admin's session
  // email differs from the target user's email. Authz + hierarchy are
  // enforced above in this action instead.
  try {
    await sendVerificationEmailFromApi({
      email: target.email,
      callbackURL: buildAbsoluteUrl(baseUrl, '/auth/verify-email'),
    });
    return { success: true };
  } catch (error) {
    const message =
      isAPIError(error) && typeof error.message === 'string'
        ? error.message
        : 'Could not send the verification email. Please try again.';
    console.error('[Admin] resendVerificationEmailAction failed:', error);
    return { error: message };
  }
}