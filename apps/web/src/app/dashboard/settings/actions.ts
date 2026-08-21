'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { db } from '@repo/database';
import { auth } from '@repo/auth';
import { isAPIError } from 'better-auth/api';
import {
  createServerAuditLog,
  getEffectivePermissionUserId,
} from '../../../lib/server-audit';
import {
  checkServerActionRateLimit,
  getServerActionRateLimitMessage,
} from '../../../lib/server-action-rate-limit';
import { getAppBaseUrl } from '../../../lib/server/app-url';
import { buildAbsoluteUrl } from '../../../lib/app-url';

async function getSessionOrRedirect() {
  const h = await headers();
  const session = await auth.api.getSession({ headers: h });
  if (!session) redirect('/auth');
  return session;
}

async function enforceActionRateLimit(
  userId: string,
  action: string,
  windowMs: number,
  max: number,
) {
  const result = await checkServerActionRateLimit({
    scope: `settings:${action}`,
    identifier: userId,
    windowMs,
    max,
    failOpen: false,
  });

  if (!result.allowed) {
    return { error: getServerActionRateLimitMessage(result.retryAfterMs) };
  }

  return null;
}

async function hasSettingsPermission(
  userId: string,
  action: 'profile' | 'security' | 'theme' | 'labs',
): Promise<boolean> {
  const result = await auth.api.userHasPermission({
    body: { userId, permissions: { settings: [action] } },
  });
  return result?.success === true;
}

function getActionErrorMessage(
  error: unknown,
  fallback: string,
  options?: {
    badRequest?: string;
    unauthorized?: string;
    forbidden?: string;
    rateLimited?: string;
  },
) {
  if (isAPIError(error)) {
    if (error.status === 400) {
      return options?.badRequest || error.message || fallback;
    }
    if (error.status === 401) {
      return (
        options?.unauthorized || 'Your session expired. Please sign in again.'
      );
    }
    if (error.status === 403) {
      return (
        options?.forbidden || 'You are not allowed to perform this action.'
      );
    }
    if (error.status === 429) {
      return (
        options?.rateLimited || 'Too many requests. Please wait and try again.'
      );
    }
    return error.message || fallback;
  }

  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

export async function updateDisplayNameAction(formData: FormData) {
  const session = await getSessionOrRedirect();
  const rateLimitError = await enforceActionRateLimit(
    session.user.id,
    'update-display-name',
    60_000,
    6,
  );
  if (rateLimitError) return rateLimitError;

  const allowed = await hasSettingsPermission(session.user.id, 'profile');
  if (!allowed)
    return { error: 'You are not allowed to edit profile settings.' };

  const name = ((formData.get('name') as string) ?? '').trim();

  if (!name || name.length > 80) {
    return { error: 'Name is required (max 80 characters).' };
  }

  try {
    await auth.api.updateUser({
      body: { name },
      headers: await headers(),
    });
  } catch (error) {
    return {
      error: getActionErrorMessage(
        error,
        'Could not update your display name.',
      ),
    };
  }

  await createServerAuditLog({
    userId: session.user.id,
    action: 'profile_updated',
    session,
    metadata: { field: 'name' },
  });

  revalidatePath('/dashboard/settings');
  return { success: true };
}

export async function requestPasswordResetAction() {
  const session = await getSessionOrRedirect();
  const rateLimitError = await enforceActionRateLimit(
    session.user.id,
    'request-password-reset',
    60_000,
    3,
  );
  if (rateLimitError) return rateLimitError;

  const allowed = await hasSettingsPermission(session.user.id, 'security');
  if (!allowed) {
    return { error: 'Your role cannot manage security settings.' };
  }

  const h = await headers();
  const appBaseUrl = await getAppBaseUrl(h);

  try {
    await auth.api.requestPasswordReset({
      body: {
        email: session.user.email,
        redirectTo: buildAbsoluteUrl(appBaseUrl, '/auth/reset-password'),
      },
      headers: h,
    });
  } catch (error) {
    return {
      error: getActionErrorMessage(
        error,
        'Could not send password reset email right now.',
      ),
    };
  }

  await createServerAuditLog({
    userId: session.user.id,
    action: 'password_reset_requested',
    session,
  });

  return { success: true };
}

export async function toggleThemePreferenceAction() {
  const session = await getSessionOrRedirect();
  const rateLimitError = await enforceActionRateLimit(
    session.user.id,
    'toggle-theme-preference',
    60_000,
    10,
  );
  if (rateLimitError) return rateLimitError;

  const effectivePermissionUserId = getEffectivePermissionUserId(session);
  const allowed = await hasSettingsPermission(
    effectivePermissionUserId,
    'theme',
  );
  if (!allowed) {
    return {
      error:
        'You do not have permission to change app theme. Ask an admin for a settings grant.',
    };
  }

  await createServerAuditLog({
    userId: session.user.id,
    action: 'theme_changed',
    session,
  });

  return {
    success: true,
    message: 'Theme preference updated (demo action).',
  };
}

export async function runLabsSettingAction() {
  const session = await getSessionOrRedirect();
  const rateLimitError = await enforceActionRateLimit(
    session.user.id,
    'run-labs-setting',
    60_000,
    5,
  );
  if (rateLimitError) return rateLimitError;

  const effectivePermissionUserId = getEffectivePermissionUserId(session);
  const allowed = await hasSettingsPermission(
    effectivePermissionUserId,
    'labs',
  );
  if (!allowed) {
    return {
      error:
        'You do not have permission to use Labs settings. Only admin-level or granted users can use this.',
    };
  }

  await createServerAuditLog({
    userId: session.user.id,
    action: 'labs_toggled',
    session,
  });

  return {
    success: true,
    message: 'Labs setting executed successfully (demo action).',
  };
}

export async function deleteAccountAction(formData: FormData) {
  const session = await getSessionOrRedirect();
  const rateLimitError = await enforceActionRateLimit(
    session.user.id,
    'delete-account',
    60_000,
    2,
  );
  if (rateLimitError) return rateLimitError;

  const h = await headers();
  const appBaseUrl = await getAppBaseUrl(h);

  const accounts = await db.account.findMany({
    where: { userId: session.user.id },
    select: { providerId: true },
  });

  const hasCredentialAccount = accounts.some(
    (acc) => acc.providerId === 'credential',
  );

  // Policy: OAuth-origin accounts may delete without password (Better Auth
  // fresh-session requirement still applies). Credential-containing accounts
  // must provide password confirmation.
  const requiresPassword = hasCredentialAccount;

  const password = ((formData.get('password') as string) ?? '').trim();

  if (requiresPassword && !password) {
    return { error: 'Password is required to confirm account deletion.' };
  }

  const deleteBody: { password?: string; callbackURL: string } = {
    callbackURL: buildAbsoluteUrl(appBaseUrl, '/'),
  };
  if (password) {
    deleteBody.password = password;
  }

  try {
    await auth.api.deleteUser({
      body: deleteBody,
      headers: h,
    });
  } catch (error) {
    return {
      error: getActionErrorMessage(error, 'Could not delete your account.', {
        badRequest: requiresPassword
          ? 'Incorrect password. Please try again.'
          : 'Could not delete your account. Please try again.',
      }),
    };
  }

  // Note: do NOT call `redirect()` here. Server-action redirects throw a
  // NEXT_REDIRECT error which can be silently swallowed by client-side
  // try/catch around the action call, leaving the user with a misleading
  // error toast even though the deletion succeeded. Instead we return a
  // success flag and let the client navigate via the router.
  return { success: true as const };
}
