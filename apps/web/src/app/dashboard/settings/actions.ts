'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { isAPIError } from 'better-auth/api';
import {
  getSessionFromApi,
  updateUserFromApi,
  deleteUserFromApi,
  listAccountsFromApi,
} from '../../../lib/server/auth-http';
import { getMyPermissionsFromApi } from '../../../lib/server/internal-api';
import { createServerAuditLog } from '../../../lib/server-audit';
import {
  checkServerActionRateLimit,
  getServerActionRateLimitMessage,
} from '../../../lib/server-action-rate-limit';
import { getAppBaseUrl } from '../../../lib/server/app-url';
import { buildAbsoluteUrl } from '../../../lib/app-url';

async function getSessionOrRedirect() {
  const h = await headers();
  const session = await getSessionFromApi(h);
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

/**
 * Permission verdict for the EFFECTIVE user (impersonation aware), computed
 * by the API tier - identical evaluation to server-side enforcement.
 */
async function hasSettingsPermission(
  action: 'profile' | 'security' | 'theme' | 'labs',
): Promise<boolean> {
  const { permissions } = await getMyPermissionsFromApi();
  return permissions.settings.includes(action);
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

  // Non-APIError Errors can carry Node fetch internals - never surface them.
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

  const allowed = await hasSettingsPermission('profile');
  if (!allowed)
    return { error: 'You are not allowed to edit profile settings.' };

  const name = ((formData.get('name') as string) ?? '').trim();

  if (!name || name.length > 80) {
    return { error: 'Name is required (max 80 characters).' };
  }

  try {
    await updateUserFromApi({ name }, await headers());
  } catch (error) {
    return {
      error: getActionErrorMessage(
        error,
        'Could not update your display name.',
      ),
    };
  }

  await createServerAuditLog({
    action: 'profile_updated',
    metadata: { field: 'name' },
  });

  revalidatePath('/dashboard/settings');
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

  const allowed = await hasSettingsPermission('theme');
  if (!allowed) {
    return {
      error:
        'You do not have permission to change app theme. Ask an admin for a settings grant.',
    };
  }

  // Audit row kept for parity with the pre-migration behavior: the trail
  // should show who toggled theme preference, even while the persistence
  // itself is still a demo no-op.
  await createServerAuditLog({
    action: 'theme_changed',
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

  const allowed = await hasSettingsPermission('labs');
  if (!allowed) {
    return {
      error:
        'You do not have permission to use Labs settings. Only admin-level or granted users can use this.',
    };
  }

  // Same parity rationale as theme_changed above.
  await createServerAuditLog({
    action: 'labs_toggled',
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

  const accounts = await listAccountsFromApi(h);

  const hasCredentialAccount = accounts.some(
    (acc) => acc.providerId === 'credential',
  );

  // Policy: OAuth-origin accounts may delete without password (Better Auth
  // fresh-session requirement still applies). Credential-containing accounts
  // must provide password confirmation.
  const requiresPassword = hasCredentialAccount;

  // Verbatim - trimming would break credentials containing whitespace.
  const password = (formData.get('password') as string) ?? '';

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
    await deleteUserFromApi(deleteBody, h);
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
