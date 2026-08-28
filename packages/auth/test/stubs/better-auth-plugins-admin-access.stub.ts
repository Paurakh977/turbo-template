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
