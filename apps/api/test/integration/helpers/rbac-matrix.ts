/**
 * RBAC permission matrix for integration tests.
 *
 * Defines the minimum role required for each endpoint.
 * Used by notes-rbac.integration.spec.ts to test every role against every endpoint.
 */

export const ROLE_WEIGHT: Record<string, number> = {
  user: 0,
  operator: 1,
  admin: 2,
  superAdmin: 3,
};

export const ALL_ROLES = ['user', 'operator', 'admin', 'superAdmin'] as const;

export type EndpointDef = {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  minRole: string;
  description: string;
};

/**
 * All protected API endpoints and the minimum role required.
 */
export const API_ENDPOINTS: EndpointDef[] = [
  {
    method: 'GET',
    path: '/api/notes',
    minRole: 'user',
    description: 'List notes',
  },
  {
    method: 'POST',
    path: '/api/notes',
    minRole: 'operator',
    description: 'Create note',
  },
  {
    method: 'PATCH',
    path: '/api/notes/placeholder',
    minRole: 'operator',
    description: 'Update note',
  },
  {
    method: 'DELETE',
    path: '/api/notes/placeholder',
    minRole: 'superAdmin',
    description: 'Delete note',
  },
  {
    method: 'GET',
    path: '/api/admin/audit-logs',
    minRole: 'admin',
    description: 'List audit logs',
  },
  {
    method: 'GET',
    path: '/api/users/me/role',
    minRole: 'user',
    description: 'Get my role',
  },
  {
    method: 'GET',
    path: '/api/users/me/permissions',
    minRole: 'user',
    description: 'Get my permissions',
  },
  {
    method: 'POST',
    path: '/api/rate-limit/check',
    minRole: 'user',
    description: 'Check rate limit',
  },
];

/**
 * Checks if a given role has sufficient weight to access an endpoint.
 */
export function canAccessEndpoint(role: string, endpoint: EndpointDef): boolean {
  const roleW = ROLE_WEIGHT[role] ?? 0;
  const minW = ROLE_WEIGHT[endpoint.minRole] ?? 0;
  return roleW >= minW;
}
