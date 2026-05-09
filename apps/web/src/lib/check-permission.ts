import { auth } from '@repo/auth';

type Session = typeof auth.$Infer.Session;

/**
 * Server-side permission check utility.
 *
 * Wraps auth.api.userHasPermission — the Better Auth documented server-side
 * API — so Server Components and API Route Handlers can gate features without
 * duplicating boilerplate.
 *
 * Always uses `userId` (not just the role string) so the check hits the live
 * DB and reflects the latest role, even if the session cookie is stale.
 *
 * @example
 *   const canDelete = await checkPermission(session, 'notes', ['delete']);
 *   if (!canDelete) return <p>Not allowed</p>;
 */
export async function checkPermission(
  session: Session,
  resource: string,
  actions: string[],
): Promise<boolean> {
  try {
    const result = await auth.api.userHasPermission({
      body: {
        userId: session.user.id,
        permissions: { [resource]: actions },
      },
    });
    return result?.success === true;
  } catch {
    return false;
  }
}

/**
 * Convenience: check multiple resources at once.
 * Returns an object keyed by resource with boolean results.
 *
 * @example
 *   const perms = await checkPermissions(session, {
 *     notes:   ['create', 'update'],
 *     settings: ['security'],
 *   });
 *   perms.notes   // true / false
 *   perms.settings // true / false
 */
export async function checkPermissions(
  session: Session,
  map: Record<string, string[]>,
): Promise<Record<string, boolean>> {
  const entries = await Promise.all(
    Object.entries(map).map(async ([resource, actions]) => [
      resource,
      await checkPermission(session, resource, actions),
    ]),
  );
  return Object.fromEntries(entries);
}
