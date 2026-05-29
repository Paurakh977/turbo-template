'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { db } from '@repo/database';
import { auth } from '@repo/auth';
import { isAPIError } from 'better-auth/api';
import {
  checkServerActionRateLimit,
  getServerActionRateLimitMessage,
} from '../../../lib/server-action-rate-limit';

type AuthSession = NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>;

function trimTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function buildAbsoluteUrl(baseUrl: string, pathname: string): string {
  const normalizedBase = trimTrailingSlash(baseUrl);
  const normalizedPath = pathname.startsWith('/') ? pathname : `/${pathname}`;
  return `${normalizedBase}${normalizedPath}`;
}

function inferOriginFromHeaders(h: Headers): string | null {
  const forwardedProto = h
    .get('x-forwarded-proto')
    ?.split(',')[0]
    ?.trim()
    .toLowerCase();
  const forwardedHost = h.get('x-forwarded-host')?.split(',')[0]?.trim();
  const host = forwardedHost ?? h.get('host')?.split(',')[0]?.trim();
  if (!host) return null;

  const protocol =
    forwardedProto ??
    (host.includes('localhost') || host.startsWith('127.0.0.1')
      ? 'http'
      : 'https');

  return `${protocol}://${host}`;
}

async function getAppBaseUrl(h?: Headers): Promise<string> {
  const publicAppUrl = process.env.NEXT_PUBLIC_APP_URL?.trim() || '';
  if (publicAppUrl) return trimTrailingSlash(publicAppUrl);

  const requestHeaders = h ?? (await headers());
  const inferred = inferOriginFromHeaders(requestHeaders);
  if (inferred) return trimTrailingSlash(inferred);

  const authUrl = process.env.BETTER_AUTH_URL?.trim() || '';
  if (authUrl) return trimTrailingSlash(authUrl);

  return 'http://localhost:3000';
}

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

async function logAudit(
  userId: string,
  action: string,
  metadata?: Record<string, unknown>,
) {
  try {
    const h = await headers();
    await db.auditLog.create({
      data: {
        userId,
        action,
        ipAddress: h.get('x-forwarded-for') ?? null,
        userAgent: h.get('user-agent') ?? null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...(metadata ? { metadata: metadata as any } : {}),
      },
    });
  } catch (e) {
    console.error(`[AuditLog] ${action} failed:`, e);
  }
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

function getEffectivePermissionUserId(session: AuthSession): string {
  const impersonatedBy =
    (session as { session?: { impersonatedBy?: string | null } }).session
      ?.impersonatedBy ?? null;
  return impersonatedBy ?? session.user.id;
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

  await logAudit(session.user.id, 'profile_updated', { field: 'name' });

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

  await logAudit(session.user.id, 'password_reset_requested');

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

  await logAudit(session.user.id, 'theme_changed');

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

  await logAudit(session.user.id, 'labs_toggled');

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
