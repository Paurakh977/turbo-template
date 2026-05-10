import { createAccessControl } from 'better-auth/plugins/access';
import { defaultStatements, adminAc } from 'better-auth/plugins/admin/access';

export const statement = {
  ...defaultStatements,
  notes: ['create', 'list', 'update', 'delete'] as const,
  settings: ['read', 'profile', 'security', 'theme', 'labs', 'danger'] as const,
} as const;

export const ac = createAccessControl(statement);

export const userRole = ac.newRole({
  settings: ['read', 'profile', 'security'],
  notes: [],
});

export const operatorRole = ac.newRole({
  settings: ['read', 'profile', 'security', 'theme'],
  notes: ['list', 'create', 'update'],
});

export const adminRole = ac.newRole({
  ...adminAc.statements,
  settings: ['read', 'profile', 'security', 'theme', 'labs', 'danger'],
  notes: ['list', 'create', 'update'],
});

export const superAdminRole = ac.newRole({
  ...adminAc.statements,
  user: ['impersonate-admins', ...adminAc.statements.user],
  settings: ['read', 'profile', 'security', 'theme', 'labs', 'danger'],
  notes: ['list', 'create', 'update', 'delete'],
});

// Grant-only roles to support per-user overrides without changing base role.
export const settingsThemeGrantRole = ac.newRole({
  settings: ['theme'],
});

export const settingsLabsGrantRole = ac.newRole({
  settings: ['labs'],
});

export const THEME_GRANT_NAME = 'settingsThemeGrant';
export const LABS_GRANT_NAME = 'settingsLabsGrant';
