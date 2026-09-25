'use server';

import { headers } from 'next/headers';
import { getAdminUserFromApi, sendVerificationEmailFromApi } from '../../lib/server/auth-http';
import { canActOn, getPrimaryRole } from '@repo/roles';
import { requireAdmin } from '../../lib/server/require-admin';
import { buildAbsoluteUrl } from '../../lib/shared/app-url';
import { getAppBaseUrl } from '../../lib/server/app-url';
import {
  checkServerActionRateLimit,
  getServerActionRateLimitMessage,
} from '../../lib/server/server-action-rate-limit';
import { toActionErrorMessage } from '../../lib/server/api-errors';

type ActionResult = { success: boolean } | { error: string };

async function checkResendRateLimit(): Promise<ActionResult | null> {
  // No identifier — the limiter derives the bucket from the session
  // (see server-action-rate-limit.ts), so callers can fire this in parallel
  // with requireAdmin instead of waiting for the session first.
  const result = await checkServerActionRateLimit({
    scope: 'admin:resend-verification',
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
  // requireAdmin (GET get-session) and the rate-check (POST rate-limit) are
  // independent — same cookies, server-derived identity — so run them in
  // parallel (~1 wall RTT saved).
  const [session, rateLimitError] = await Promise.all([
    requireAdmin(),
    checkResendRateLimit(),
  ]);

  if (rateLimitError) return rateLimitError;

  if (!userId) return { error: 'Invalid user.' };

  // Admin-guarded lookup served by the API tier (Better Auth admin plugin).
  // getAdminUserFromApi maps 404 to null; other failures (API down, 403)
  // must NOT be reported as "User not found" - surface them honestly.
  // One headers() read reused for the lookup AND getAppBaseUrl below.
  const h = await headers();
  let target: Awaited<ReturnType<typeof getAdminUserFromApi>> = null;
  try {
    target = await getAdminUserFromApi(userId, h);
  } catch (error) {
    console.error('[Admin] user lookup failed:', error);
    return {
      error: 'Could not reach the admin service. Please try again.',
    };
  }

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

  const baseUrl = await getAppBaseUrl(h);

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
    const message = toActionErrorMessage(
      error,
      'Could not send the verification email. Please try again.',
    );
    console.error('[Admin] resendVerificationEmailAction failed:', error);
    return { error: message };
  }
}