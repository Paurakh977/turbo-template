'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import {
  updateUserFromApi,
  deleteUserFromApi,
  listAccountsFromApi,
} from '../../../lib/server/auth-http';
import { getRequestBootstrap } from '../../../lib/server/bootstrap';
import {
  classifyApiError,
  toActionErrorMessage,
} from '../../../lib/server/api-errors';
import { createServerAuditLog } from '../../../lib/server/server-audit';
import {
  checkServerActionRateLimit,
  getServerActionRateLimitMessage,
} from '../../../lib/server/server-action-rate-limit';
import { getAppBaseUrl } from '../../../lib/server/app-url';
import { buildAbsoluteUrl } from '../../../lib/shared/app-url';

/**
 * Single-bootstrap identity: ONE HTTP replaces
 * getSession + getMyPermissions. Domain mutations re-enforce authz — the
 * early permission check here is UX-only.
 *
 * Bootstrap + rate-check run in PARALLEL: the limiter derives its
 * bucket from the session server-side. Saves ~1 wall RTT per action.
 */
async function getBootstrapAndRateLimit(action: string, windowMs: number, max: number) {
  const h = await headers();
  let bootstrap: Awaited<ReturnType<typeof getRequestBootstrap>> | null = null;
  let bootstrapError: unknown = null;
  try {
    bootstrap = await getRequestBootstrap(h);
  } catch (error) {
    bootstrapError = error;
  }
  const rate = await checkServerActionRateLimit({
    scope: `settings:${action}`,
    windowMs,
    max,
    failOpen: false,
  });
  return { h, bootstrap, bootstrapError, rate };
}

function redirectIfUnauthenticated(
  bootstrap: Awaited<ReturnType<typeof getRequestBootstrap>> | null,
  bootstrapError?: unknown,
): asserts bootstrap is NonNullable<typeof bootstrap> & { userId: string } {
  if (bootstrap?.userId) return;
  if (bootstrapError !== null && bootstrapError !== undefined) {
    const kind = classifyApiError(bootstrapError);
    if (kind !== 'unauthorized') throw bootstrapError;
  }
  redirect('/auth');
}

function rateLimitError(
  rate: Awaited<ReturnType<typeof checkServerActionRateLimit>>,
) {
  if (!rate.allowed) {
    return { error: getServerActionRateLimitMessage(rate.retryAfterMs) };
  }
  return null;
}

/**
 * Permission verdict for the EFFECTIVE user (impersonation aware), computed
 * by the API tier - identical evaluation to server-side enforcement.
 * Takes preloaded bootstrap verdicts (no extra HTTP); admin short-circuit
 * preserves the previous fast path for the common admin case.
 */
function hasSettingsPermissionFromBootstrap(
  action: 'profile' | 'security' | 'theme' | 'labs',
  sessionRole: string | undefined,
  permissions: { settings: string[] },
): boolean {
  const normRole = sessionRole?.toLowerCase() ?? '';
  if (normRole === 'superadmin' || normRole === 'admin') {
    return true;
  }
  return permissions?.settings?.includes(action) ?? false;
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
  return toActionErrorMessage(error, fallback, options);
}

export async function updateDisplayNameAction(formData: FormData) {
  const { h: bootstrapHeaders, bootstrap, bootstrapError, rate } =
    await getBootstrapAndRateLimit('update-display-name', 60_000, 6);
  redirectIfUnauthenticated(bootstrap, bootstrapError);
  const limited = rateLimitError(rate);
  if (limited) return limited;
  const { role: sessionRole, permissions } = bootstrap;

  const allowed = hasSettingsPermissionFromBootstrap(
    'profile',
    sessionRole,
    permissions,
  );
  if (!allowed)
    return { error: 'You are not allowed to edit profile settings.' };

  const name = ((formData.get('name') as string) ?? '').trim();

  if (!name || name.length > 80) {
    return { error: 'Name is required (max 80 characters).' };
  }

  try {
    // Reuse the already-read headers: the second `headers()` call
    // here was a duplicate parse + cookie split of the same request.
    await updateUserFromApi({ name }, bootstrapHeaders);
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
  const { bootstrap, bootstrapError, rate } = await getBootstrapAndRateLimit(
    'toggle-theme-preference',
    60_000,
    10,
  );
  redirectIfUnauthenticated(bootstrap, bootstrapError);
  const limited = rateLimitError(rate);
  if (limited) return limited;
  const { role: sessionRole, permissions } = bootstrap;

  const allowed = hasSettingsPermissionFromBootstrap(
    'theme',
    sessionRole,
    permissions,
  );
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
  const { bootstrap, bootstrapError, rate } = await getBootstrapAndRateLimit(
    'run-labs-setting',
    60_000,
    5,
  );
  redirectIfUnauthenticated(bootstrap, bootstrapError);
  const limited = rateLimitError(rate);
  if (limited) return limited;
  const { role: sessionRole, permissions } = bootstrap;

  const allowed = hasSettingsPermissionFromBootstrap(
    'labs',
    sessionRole,
    permissions,
  );
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
  const { h, bootstrap, bootstrapError, rate } = await getBootstrapAndRateLimit(
    'delete-account',
    60_000,
    2,
  );
  redirectIfUnauthenticated(bootstrap, bootstrapError);
  const limited = rateLimitError(rate);
  if (limited) return limited;

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
