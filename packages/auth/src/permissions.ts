import { createAccessControl } from 'better-auth/plugins/access';
import { defaultStatements, adminAc } from 'better-auth/plugins/admin/access';

export const statement = {
  ...defaultStatements,
  notes: ['create', 'read', 'update', 'delete'] as const,
  settings: ['read', 'profile', 'security', 'theme', 'labs', 'danger'] as const,
} as const;

export const ac = createAccessControl(statement);

export const userRole = ac.newRole({
  settings: ['read', 'profile', 'security'],
  notes: ['read'],
});

export const operatorRole = ac.newRole({
  settings: ['read', 'profile', 'security', 'theme'],
  notes: ['read', 'create', 'update'],
});

export const adminRole = ac.newRole({
  ...adminAc.statements,
  settings: ['read', 'profile', 'security', 'theme', 'labs', 'danger'],
  notes: ['read', 'create', 'update', 'delete'],
});

export const superAdminRole = ac.newRole({
  ...adminAc.statements,
  user: ['impersonate-admins', ...adminAc.statements.user],
  settings: ['read', 'profile', 'security', 'theme', 'labs', 'danger'],
  notes: ['read', 'create', 'update', 'delete'],
});

// Grant-only roles to support per-user overrides without changing base role.
export const settingsThemeGrantRole = ac.newRole({
  settings: ['theme'],
});

export const settingsLabsGrantRole = ac.newRole({
  settings: ['labs'],
});
