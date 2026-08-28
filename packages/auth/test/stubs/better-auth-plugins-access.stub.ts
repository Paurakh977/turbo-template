export const createAccessControl = (statement: any) => {
  const roles: Record<string, any> = {};
  return {
    newRole: (permissions: any) => {
      const role = {
        authorize: (resourcePermissions: Record<string, string[]>) => {
          for (const [resource, actions] of Object.entries(resourcePermissions)) {
            const allowed = statement[resource] ?? [];
            for (const action of actions) {
              if (!allowed.includes(action)) {
                return { success: false };
              }
            }
          }
          return { success: true };
        },
      };
      return role;
    },
  };
};

export const defaultStatements = {
  user: ['create', 'read', 'update', 'delete', 'list'],
  session: ['list', 'revoke', 'delete'],
} as const;

export const adminAc = {
  statements: {
    user: ['create', 'read', 'update', 'delete', 'list'],
    session: ['list', 'revoke', 'delete'],
  },
};
