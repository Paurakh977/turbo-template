'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { db } from '@repo/database';
import { auth } from '@repo/auth';

async function getSessionOrRedirect() {
  const h = await headers();
  const session = await auth.api.getSession({ headers: h });
  if (!session) redirect('/auth/sign-in');
  return session;
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
  action: 'profile' | 'security' | 'theme' | 'labs' | 'danger',
): Promise<boolean> {
  const result = await auth.api.userHasPermission({
    body: { userId, permissions: { settings: [action] } },
  });
  return result?.success === true;
}

export async function updateDisplayNameAction(formData: FormData) {
  const session = await getSessionOrRedirect();
  const allowed = await hasSettingsPermission(session.user.id, 'profile');
  if (!allowed)
    return { error: 'You are not allowed to edit profile settings.' };

  const name = ((formData.get('name') as string) ?? '').trim();

  if (!name || name.length > 80) {
    return { error: 'Name is required (max 80 characters).' };
  }

  await auth.api.updateUser({
    body: { name },
    headers: await headers(),
  });

  await logAudit(session.user.id, 'profile_updated', { field: 'name' });

  revalidatePath('/dashboard/settings');
  return { success: true };
}

export async function requestPasswordResetAction() {
  const session = await getSessionOrRedirect();
  const allowed = await hasSettingsPermission(session.user.id, 'security');
  if (!allowed) {
    return { error: 'Your role cannot manage security settings.' };
  }

  await auth.api.requestPasswordReset({
    body: {
      email: session.user.email,
      redirectTo: '/auth/reset-password',
    },
    headers: await headers(),
  });

  await logAudit(session.user.id, 'password_reset_requested');

  return { success: true };
}

export async function toggleThemePreferenceAction() {
  const session = await getSessionOrRedirect();
  const allowed = await hasSettingsPermission(session.user.id, 'theme');
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
  const allowed = await hasSettingsPermission(session.user.id, 'labs');
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
  const allowed = await hasSettingsPermission(session.user.id, 'danger');
  if (!allowed) {
    return { error: 'Only admin roles can use this dangerous setting.' };
  }

  const password = ((formData.get('password') as string) ?? '').trim();

  if (!password) {
    return { error: 'Password is required to confirm account deletion.' };
  }

  await auth.api.deleteUser({
    body: { password, callbackURL: '/' },
    headers: await headers(),
  });

  await logAudit(session.user.id, 'account_deleted');

  redirect('/');
}
