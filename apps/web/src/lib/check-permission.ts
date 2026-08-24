// Pure permission statement via subpath; the Auth type import is erased at
// runtime so the TYPE never instantiates BetterAuth. The value import stays
// only until Phase 1.2 swaps the call below onto the HTTP gateway.
import type { Auth } from '@repo/auth';
import { auth } from '@repo/auth';
import { statement } from '@repo/auth/permissions';

type Session = Auth['$Infer']['Session'];
type PermissionResource = keyof typeof statement;
type PermissionAction<R extends PermissionResource> =
  (typeof statement)[R][number];
type PermissionMap = {
  [R in PermissionResource]?: PermissionAction<R>[];
};

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
export async function checkPermission<R extends PermissionResource>(
  session: Session,
  resource: R,
  actions: PermissionAction<R>[],
): Promise<boolean> {
  try {
    const permissions: PermissionMap = {
      [resource]: actions,
    };

    const result = await auth.api.userHasPermission({
      body: {
        userId: session.user.id,
        permissions,
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
  map: PermissionMap,
): Promise<Partial<Record<PermissionResource, boolean>>> {
  const entries = await Promise.all(
    Object.entries(map).map(async ([resource, actions]) => {
      const typedResource = resource as PermissionResource;
      return [
        typedResource,
        await checkPermission(
          session,
          typedResource,
          (actions ?? []) as PermissionAction<typeof typedResource>[],
        ),
      ] as const;
    }),
  );
  return Object.fromEntries(entries);
}
