import type { Auth } from '@repo/auth';
import { hasAdminRole, hasOperatorRole, getPrimaryRole } from '@repo/roles';

export type ServerSession = Auth['$Infer']['Session'];

/**
 * Better Auth impersonation sessions expose `session.impersonatedBy` - the
 * admin who started the impersonation. Permission checks and audit rows must
 * attribute to the ACTING admin, not the impersonated account.
 */
export function getImpersonatedBy(session: ServerSession): string | null {
  return (
    (session as { session?: { impersonatedBy?: string | null } }).session
      ?.impersonatedBy ?? null
  );
}

/** The user id permission decisions and audit rows should attribute to. */
export function getEffectiveUserId(session: ServerSession): string {
  return getImpersonatedBy(session) ?? session.user.id;
}

export function getSessionRoleRaw(session: ServerSession): string {
  return (session.user as { role?: string }).role ?? 'user';
}

export { hasAdminRole, hasOperatorRole, getPrimaryRole };
