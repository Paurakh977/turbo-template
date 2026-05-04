import { createAccessControl } from 'better-auth/plugins/access';
import { defaultStatements, adminAc } from 'better-auth/plugins/admin/access';

export const statement = {
  ...defaultStatements,
  content: ['create', 'read', 'update', 'delete', 'publish'],
  analytics: ['read'],
  settings: ['read', 'update'],
} as const;

export const ac = createAccessControl(statement);

export const userRole = ac.newRole({
  content: ['create', 'read', 'update'],
  analytics: [],
  settings: ['read'],
});

export const adminRole = ac.newRole({
  ...adminAc.statements,
  content: ['create', 'read', 'update', 'delete', 'publish'],
  analytics: ['read'],
  settings: ['read', 'update'],
});

export const superAdminRole = ac.newRole({
  ...adminAc.statements,
  user: ['impersonate-admins', ...adminAc.statements.user],
  content: ['create', 'read', 'update', 'delete', 'publish'],
  analytics: ['read'],
  settings: ['read', 'update'],
});
