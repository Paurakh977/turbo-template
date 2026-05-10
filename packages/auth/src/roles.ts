export const ROLE_WEIGHT: Record<string, number> = {
  user: 0,
  operator: 1,
  admin: 2,
  superAdmin: 3,
};

function tryParseJson(value: unknown): unknown | null {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed;
      return null;
    } catch {
      return null;
    }
  }
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    if ('$value' in obj && Array.isArray(obj.$value)) {
      return obj.$value;
    }
    if (Array.isArray(value)) return value;
  }
  return null;
}

export function parseRoles(role: unknown): string[] {
  if (!role) return ['user'];

  const tryParseJson = (value: unknown): unknown | null => {
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)) return parsed;
        return null;
      } catch {
        return null;
      }
    }
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      const obj = value as Record<string, unknown>;
      if ('$value' in obj && Array.isArray(obj.$value)) return obj.$value;
    }
    if (Array.isArray(value)) return value;
    return null;
  };

  const jsonArr = tryParseJson(role);
  if (jsonArr !== null) {
    const cleaned = (jsonArr as unknown[])
      .map((r) => String(r).trim())
      .filter(Boolean);
    return cleaned.length > 0 ? cleaned : ['user'];
  }

  const roleStr = String(role);
  const tokens = roleStr
    .split(',')
    .map((r) => r.trim())
    .filter(Boolean);
  return tokens.length > 0 ? tokens : ['user'];
}

export function serializeRoles(roles: string[]): string {
  return JSON.stringify(roles.length > 0 ? roles : ['user']);
}

export function getMaxRoleWeight(role: unknown): number {
  const tokens = parseRoles(role);
  return Math.max(...tokens.map((r) => ROLE_WEIGHT[r] ?? 0));
}

export function getPrimaryRole(role: unknown): string {
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
