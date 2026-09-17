jest.mock(
  'better-auth/plugins/access',
  () => ({
    createAccessControl: (_stmt: Record<string, string[]>) => ({
      newRole: (perms: Record<string, string[]>) => ({
        authorize: (resourcePermissions: Record<string, string[]>) => {
          for (const [resource, actions] of Object.entries(resourcePermissions)) {
            const allowed = perms[resource] ?? [];
            for (const action of actions) {
              if (!allowed.includes(action)) {
                return { success: false };
              }
            }
          }
          return { success: true };
        },
      }),
    }),
  }),
  { virtual: true },
);

jest.mock(
  'better-auth/plugins/admin/access',
  () => ({
    defaultStatements: {
      user: ['create', 'read', 'update', 'delete', 'list'],
      session: ['list', 'revoke', 'delete'],
    },
    adminAc: {
      statements: {
        user: ['create', 'read', 'update', 'delete', 'list'],
        session: ['list', 'revoke', 'delete'],
      },
    },
  }),
  { virtual: true },
);

import {
  AUTH_BASE_PATH,
  statement,
  ac,
  ADMIN_PLUGIN_ROLES,
  THEME_GRANT_NAME,
  LABS_GRANT_NAME,
} from './permissions';

describe('AUTH_BASE_PATH', () => {
  it('is /api/auth', () => {
    expect(AUTH_BASE_PATH).toBe('/api/auth');
  });
});

describe('statement', () => {
  it('defines notes permissions', () => {
    expect(statement.notes).toEqual(['create', 'list', 'update', 'delete']);
  });

  it('defines settings permissions', () => {
    expect(statement.settings).toEqual([
      'read',
      'profile',
      'security',
      'theme',
      'labs',
    ]);
  });

  it('extends defaultStatements', () => {
    expect(statement).toHaveProperty('user');
    expect(statement).toHaveProperty('session');
  });
});

describe('ADMIN_PLUGIN_ROLES', () => {
  it('has all base roles', () => {
    expect(ADMIN_PLUGIN_ROLES).toHaveProperty('user');
    expect(ADMIN_PLUGIN_ROLES).toHaveProperty('operator');
    expect(ADMIN_PLUGIN_ROLES).toHaveProperty('admin');
    expect(ADMIN_PLUGIN_ROLES).toHaveProperty('superAdmin');
  });

  it('has grant roles', () => {
    expect(ADMIN_PLUGIN_ROLES).toHaveProperty('settingsThemeGrant');
    expect(ADMIN_PLUGIN_ROLES).toHaveProperty('settingsLabsGrant');
  });

  it('user role can read settings', () => {
    const result = ADMIN_PLUGIN_ROLES.user.authorize({
      settings: ['read'],
    });
    expect(result.success).toBe(true);
  });

  it('user role cannot create notes', () => {
    const result = ADMIN_PLUGIN_ROLES.user.authorize({
      notes: ['create'],
    });
    expect(result.success).toBe(false);
  });

  it('operator role can create notes', () => {
    const result = ADMIN_PLUGIN_ROLES.operator.authorize({
      notes: ['create'],
    });
    expect(result.success).toBe(true);
  });

  it('admin role has all admin access control statements', () => {
    const result = ADMIN_PLUGIN_ROLES.admin.authorize({
      settings: ['theme', 'labs'],
      notes: ['list', 'create', 'update'],
    });
    expect(result.success).toBe(true);
  });

  it('superAdmin role can delete notes', () => {
    const result = ADMIN_PLUGIN_ROLES.superAdmin.authorize({
      notes: ['delete'],
    });
    expect(result.success).toBe(true);
  });

  it('settingsThemeGrant can access theme', () => {
    const result = ADMIN_PLUGIN_ROLES.settingsThemeGrant.authorize({
      settings: ['theme'],
    });
    expect(result.success).toBe(true);
  });

  it('settingsLabsGrant can access labs', () => {
    const result = ADMIN_PLUGIN_ROLES.settingsLabsGrant.authorize({
      settings: ['labs'],
    });
    expect(result.success).toBe(true);
  });
});

describe('THEME_GRANT_NAME and LABS_GRANT_NAME', () => {
  it('THEME_GRANT_NAME is correct', () => {
    expect(THEME_GRANT_NAME).toBe('settingsThemeGrant');
  });

  it('LABS_GRANT_NAME is correct', () => {
    expect(LABS_GRANT_NAME).toBe('settingsLabsGrant');
  });
});
