import { createAccessControl } from "better-auth/plugins/access";
import { defaultStatements, adminAc } from "better-auth/plugins/admin/access";

// Define your resources and every possible action on them.
// "as const" is REQUIRED for TypeScript inference.
export const statement = {
  ...defaultStatements,            // keeps built-in user + session permissions
  content: ["create", "read", "update", "delete", "publish"],
  analytics: ["read"],
  settings: ["read", "update"],
} as const;

export const ac = createAccessControl(statement);

// Regular user — can only manage their own content, nothing admin
export const userRole = ac.newRole({
  content: ["create", "read", "update"],
  analytics: [],
  settings: ["read"],
});

// Admin — full built-in admin permissions + everything on your resources
export const adminRole = ac.newRole({
  ...adminAc.statements,           // user: [create, list, set-role, ban, impersonate, delete, set-password], session: [list, revoke, delete]
  content: ["create", "read", "update", "delete", "publish"],
  analytics: ["read"],
  settings: ["read", "update"],
});

// Super-admin — can also impersonate other admins
export const superAdminRole = ac.newRole({
  ...adminAc.statements,
  user: ["impersonate-admins", ...adminAc.statements.user],
  content: ["create", "read", "update", "delete", "publish"],
  analytics: ["read"],
  settings: ["read", "update"],
});