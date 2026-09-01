export const ROLE_WEIGHT: Record<string, number> = {
  user: 0,
  operator: 1,
  admin: 2,
  superAdmin: 3,
};

export type Role = keyof typeof ROLE_WEIGHT;

export function getWeight(role: string): number {
  return ROLE_WEIGHT[role] ?? 0;
}

/** Mirror of packages/roles canActOn: an actor may only act on lower weights. */
export function canActOn(actor: string, target: string): boolean {
  return getWeight(actor) > getWeight(target);
}

export function hasAdminRole(role: string): boolean {
  return role === 'admin' || role === 'superAdmin';
}

/** Minimal permission matrix used by RBAC tests (resource:actions -> min role). */
export const PERMISSION_MATRIX: Array<{
  resource: string;
  action: string;
  minRole: Role;
}> = [
  { resource: 'notes', action: 'create', minRole: 'operator' },
  { resource: 'notes', action: 'list', minRole: 'user' },
  { resource: 'notes', action: 'update', minRole: 'operator' },
  { resource: 'notes', action: 'delete', minRole: 'superAdmin' },
  { resource: 'settings', action: 'profile', minRole: 'user' },
  { resource: 'settings', action: 'theme', minRole: 'user' },
  { resource: 'settings', action: 'labs', minRole: 'user' },
  { resource: 'admin', action: 'audit-logs', minRole: 'admin' },
];
