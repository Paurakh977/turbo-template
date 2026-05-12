export type BaseRole = 'user' | 'operator' | 'admin' | 'superAdmin';

export const ROLE_WEIGHT: Record<string, number> = {
  user: 0,
  operator: 1,
  admin: 2,
  superAdmin: 3,
};

const BASE_ROLES: BaseRole[] = ['superAdmin', 'admin', 'operator', 'user'];
const BASE_ROLE_SET = new Set<string>(BASE_ROLES);

function normalizeRoleTokens(tokens: string[]): string[] {
  const cleaned = tokens
    .map((role) => role.trim())
    .filter(Boolean)
    .filter((role, index, arr) => arr.indexOf(role) === index);

  let baseRole: BaseRole = 'user';
  let maxWeight = ROLE_WEIGHT.user ?? 0;

  for (const role of cleaned) {
    if (!BASE_ROLE_SET.has(role)) continue;
    const weight = ROLE_WEIGHT[role] ?? ROLE_WEIGHT.user ?? 0;
    if (weight > maxWeight) {
      maxWeight = weight;
      baseRole = role as BaseRole;
    }
  }

  const grants = cleaned.filter((role) => !BASE_ROLE_SET.has(role));
  return [baseRole, ...grants];
}

function tryParseJson(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value;

  if (typeof value === 'object' && value !== null) {
    const obj = value as Record<string, unknown>;
    if ('$value' in obj && Array.isArray(obj.$value)) {
      return obj.$value as unknown[];
    }
    return null;
  }

  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return parsed;
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      '$value' in parsed &&
      Array.isArray((parsed as { $value?: unknown[] }).$value)
    ) {
      return (parsed as { $value: unknown[] }).$value;
    }
    return null;
  } catch {
    return null;
  }
}

export function parseRoles(role: unknown): string[] {
  if (!role) return ['user'];

  const jsonArr = tryParseJson(role);
  if (jsonArr !== null) {
    return normalizeRoleTokens(jsonArr.map((r) => String(r)));
  }

  const tokens = String(role)
    .split(',')
    .map((r) => r.trim())
    .filter(Boolean);

  return normalizeRoleTokens(tokens);
}

export function serializeRoles(roles: string[]): string {
  return parseRoles(roles).join(',');
}

export function getMaxRoleWeight(role: unknown): number {
  const tokens = parseRoles(role);
  return Math.max(...tokens.map((r) => ROLE_WEIGHT[r] ?? 0));
}

export function getPrimaryRole(role: unknown): BaseRole {
  const tokens = parseRoles(role);
  if (tokens.includes('superAdmin')) return 'superAdmin';
  if (tokens.includes('admin')) return 'admin';
  if (tokens.includes('operator')) return 'operator';
  return 'user';
}

export function hasRole(role: unknown, targetRole: string): boolean {
  return parseRoles(role).includes(targetRole);
}

export function hasAdminRole(role: unknown): boolean {
  const tokens = parseRoles(role);
  return tokens.includes('admin') || tokens.includes('superAdmin');
}

export function hasSuperAdminRole(role: unknown): boolean {
  return parseRoles(role).includes('superAdmin');
}

export function hasOperatorRole(role: unknown): boolean {
  const tokens = parseRoles(role);
  return (
    tokens.includes('operator') ||
    tokens.includes('admin') ||
    tokens.includes('superAdmin')
  );
}

export function hasGrantRole(role: unknown, grantRole: string): boolean {
  return parseRoles(role).includes(grantRole);
}

export function canActOn(actorRole: unknown, targetRole: unknown): boolean {
  return getMaxRoleWeight(actorRole) > getMaxRoleWeight(targetRole);
}
