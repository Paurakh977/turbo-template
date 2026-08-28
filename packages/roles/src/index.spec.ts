import {
  parseRoles,
  serializeRoles,
  getMaxRoleWeight,
  getPrimaryRole,
  hasRole,
  hasAdminRole,
  hasSuperAdminRole,
  hasOperatorRole,
  hasGrantRole,
  canActOn,
  ROLE_WEIGHT,
  SERVER_ACTION_SCOPES,
} from './index';

describe('parseRoles', () => {
  describe('falsy inputs default to user', () => {
    it('returns ["user"] for null', () => {
      expect(parseRoles(null)).toEqual(['user']);
    });

    it('returns ["user"] for undefined', () => {
      expect(parseRoles(undefined)).toEqual(['user']);
    });

    it('returns ["user"] for empty string', () => {
      expect(parseRoles('')).toEqual(['user']);
    });

    it('returns ["user"] for 0', () => {
      expect(parseRoles(0)).toEqual(['user']);
    });

    it('returns ["user"] for false', () => {
      expect(parseRoles(false)).toEqual(['user']);
    });
  });

  describe('comma-separated string input', () => {
    it('parses a single base role', () => {
      expect(parseRoles('admin')).toEqual(['admin']);
    });

    it('parses multiple comma-separated roles', () => {
      expect(parseRoles('admin,editor')).toEqual(['admin', 'editor']);
    });

    it('trims whitespace around tokens', () => {
      expect(parseRoles('  admin ,  editor  ')).toEqual(['admin', 'editor']);
    });

    it('filters empty tokens from trailing commas', () => {
      expect(parseRoles('admin,,editor,')).toEqual(['admin', 'editor']);
    });

    it('deduplicates roles', () => {
      expect(parseRoles('admin,admin,user')).toEqual(['admin']);
    });

    it('resolves highest base role when multiple base roles present', () => {
      expect(parseRoles('user,admin,operator')).toEqual(['admin']);
    });

    it('resolves superAdmin as highest', () => {
      expect(parseRoles('user,admin,superAdmin,operator')).toEqual([
        'superAdmin',
      ]);
    });
  });

  describe('JSON array string input', () => {
    it('parses a JSON array of role strings', () => {
      expect(parseRoles('["admin","editor"]')).toEqual(['admin', 'editor']);
    });

    it('parses a JSON array with a single role', () => {
      expect(parseRoles('["superAdmin"]')).toEqual(['superAdmin']);
    });

    it('deduplicates within JSON array', () => {
      expect(parseRoles('["admin","admin","user"]')).toEqual([
        'admin',
      ]);
    });
  });

  describe('Supabase $value wrapper', () => {
    it('unwraps $value from a JSON string', () => {
      expect(parseRoles('{"$value":["admin","editor"]}')).toEqual([
        'admin',
        'editor',
      ]);
    });

    it('unwraps $value from an object', () => {
      expect(
        parseRoles({ $value: ['admin', 'editor'] } as unknown as string),
      ).toEqual(['admin', 'editor']);
    });
  });

  describe('native array input', () => {
    it('accepts a string array directly', () => {
      expect(parseRoles(['admin', 'editor'] as unknown as string)).toEqual([
        'admin',
        'editor',
      ]);
    });

    it('deduplicates native array input', () => {
      expect(
        parseRoles(['admin', 'admin', 'user'] as unknown as string),
      ).toEqual(['admin']);
    });
  });

  describe('custom/grant roles', () => {
    it('preserves non-base grant roles', () => {
      expect(parseRoles('admin,settings:theme')).toEqual([
        'admin',
        'settings:theme',
      ]);
    });

    it('returns only grants when no base role present', () => {
      expect(parseRoles('settings:theme,notes:create')).toEqual([
        'user',
        'settings:theme',
        'notes:create',
      ]);
    });
  });

  describe('edge cases', () => {
    it('handles whitespace-only string', () => {
      expect(parseRoles('   ')).toEqual(['user']);
    });

    it('handles malformed JSON gracefully as comma-separated', () => {
      expect(parseRoles('[invalid json')).toEqual(['user', '[invalid json']);
    });

    it('handles numeric input as string', () => {
      expect(parseRoles(123 as unknown as string)).toEqual(['user', '123']);
    });

    it('handles object without $value', () => {
      expect(parseRoles({ foo: 'bar' } as unknown as string)).toEqual([
        'user',
        '[object Object]',
      ]);
    });
  });
});

describe('serializeRoles', () => {
  it('roundtrips a single role', () => {
    expect(serializeRoles(['admin'])).toBe('admin');
  });

  it('roundtrips multiple roles through parseRoles normalization', () => {
    const result = serializeRoles(['admin', 'editor']);
    expect(result).toBe('admin,editor');
  });

  it('deduplicates during roundtrip', () => {
    expect(serializeRoles(['admin', 'admin', 'user'])).toBe('admin');
  });

  it('resolves highest base role in roundtrip', () => {
    expect(serializeRoles(['user', 'superAdmin', 'operator'])).toBe(
      'superAdmin',
    );
  });
});

describe('getMaxRoleWeight', () => {
  it('returns 0 for user', () => {
    expect(getMaxRoleWeight('user')).toBe(0);
  });

  it('returns 1 for operator', () => {
    expect(getMaxRoleWeight('operator')).toBe(1);
  });

  it('returns 2 for admin', () => {
    expect(getMaxRoleWeight('admin')).toBe(2);
  });

  it('returns 3 for superAdmin', () => {
    expect(getMaxRoleWeight('superAdmin')).toBe(3);
  });

  it('returns highest weight from multiple roles', () => {
    expect(getMaxRoleWeight('user,admin')).toBe(2);
  });

  it('returns 0 for unknown/grant roles', () => {
    expect(getMaxRoleWeight('settings:theme')).toBe(0);
  });

  it('returns 0 for falsy input', () => {
    expect(getMaxRoleWeight(null)).toBe(0);
    expect(getMaxRoleWeight(undefined)).toBe(0);
    expect(getMaxRoleWeight('')).toBe(0);
  });

  it('returns max weight when mixed base and grant roles', () => {
    expect(getMaxRoleWeight('superAdmin,settings:theme')).toBe(3);
  });
});

describe('getPrimaryRole', () => {
  it('returns superAdmin when present', () => {
    expect(getPrimaryRole('superAdmin')).toBe('superAdmin');
  });

  it('returns superAdmin even with lower roles', () => {
    expect(getPrimaryRole('user,admin,superAdmin')).toBe('superAdmin');
  });

  it('returns admin when present (no superAdmin)', () => {
    expect(getPrimaryRole('admin')).toBe('admin');
  });

  it('returns admin with user', () => {
    expect(getPrimaryRole('user,admin')).toBe('admin');
  });

  it('returns operator when present (no admin/superAdmin)', () => {
    expect(getPrimaryRole('operator')).toBe('operator');
  });

  it('returns operator with user', () => {
    expect(getPrimaryRole('user,operator')).toBe('operator');
  });

  it('returns user as default', () => {
    expect(getPrimaryRole('user')).toBe('user');
  });

  it('returns user for falsy input', () => {
    expect(getPrimaryRole(null)).toBe('user');
    expect(getPrimaryRole(undefined)).toBe('user');
    expect(getPrimaryRole('')).toBe('user');
  });

  it('returns user when only grant roles present', () => {
    expect(getPrimaryRole('settings:theme')).toBe('user');
  });
});

describe('hasRole', () => {
  it('returns true when role is present', () => {
    expect(hasRole('admin', 'admin')).toBe(true);
  });

  it('returns false when role is absent', () => {
    expect(hasRole('user', 'admin')).toBe(false);
  });

  it('works with comma-separated roles', () => {
    expect(hasRole('admin,editor', 'editor')).toBe(true);
  });

  it('works with grant roles', () => {
    expect(hasRole('admin,settings:theme', 'settings:theme')).toBe(true);
  });

  it('returns false for falsy input', () => {
    expect(hasRole(null, 'admin')).toBe(false);
    expect(hasRole('', 'admin')).toBe(false);
  });

  it('is case-sensitive', () => {
    expect(hasRole('Admin', 'admin')).toBe(false);
  });
});

describe('hasAdminRole', () => {
  it('returns true for admin', () => {
    expect(hasAdminRole('admin')).toBe(true);
  });

  it('returns true for superAdmin', () => {
    expect(hasAdminRole('superAdmin')).toBe(true);
  });

  it('returns true for admin in comma-separated list', () => {
    expect(hasAdminRole('user,admin')).toBe(true);
  });

  it('returns false for operator', () => {
    expect(hasAdminRole('operator')).toBe(false);
  });

  it('returns false for user', () => {
    expect(hasAdminRole('user')).toBe(false);
  });

  it('returns false for falsy input', () => {
    expect(hasAdminRole(null)).toBe(false);
    expect(hasAdminRole('')).toBe(false);
    expect(hasAdminRole(undefined)).toBe(false);
  });

  it('returns false for grant-only roles', () => {
    expect(hasAdminRole('settings:theme')).toBe(false);
  });
});

describe('hasSuperAdminRole', () => {
  it('returns true for superAdmin', () => {
    expect(hasSuperAdminRole('superAdmin')).toBe(true);
  });

  it('returns false for admin', () => {
    expect(hasSuperAdminRole('admin')).toBe(false);
  });

  it('returns false for operator', () => {
    expect(hasSuperAdminRole('operator')).toBe(false);
  });

  it('returns false for user', () => {
    expect(hasSuperAdminRole('user')).toBe(false);
  });

  it('returns true when superAdmin is in comma-separated list', () => {
    expect(hasSuperAdminRole('user,superAdmin')).toBe(true);
  });

  it('returns false for falsy input', () => {
    expect(hasSuperAdminRole(null)).toBe(false);
    expect(hasSuperAdminRole(undefined)).toBe(false);
  });
});

describe('hasOperatorRole', () => {
  it('returns true for operator', () => {
    expect(hasOperatorRole('operator')).toBe(true);
  });

  it('returns true for admin (hierarchical)', () => {
    expect(hasOperatorRole('admin')).toBe(true);
  });

  it('returns true for superAdmin (hierarchical)', () => {
    expect(hasOperatorRole('superAdmin')).toBe(true);
  });

  it('returns false for user', () => {
    expect(hasOperatorRole('user')).toBe(false);
  });

  it('returns false for falsy input', () => {
    expect(hasOperatorRole(null)).toBe(false);
    expect(hasOperatorRole('')).toBe(false);
  });

  it('returns false for grant-only roles', () => {
    expect(hasOperatorRole('settings:theme')).toBe(false);
  });

  it('returns true for operator in comma-separated list', () => {
    expect(hasOperatorRole('user,operator')).toBe(true);
  });
});

describe('hasGrantRole', () => {
  it('returns true when grant role is present', () => {
    expect(hasGrantRole('settings:theme', 'settings:theme')).toBe(true);
  });

  it('returns false when grant role is absent', () => {
    expect(hasGrantRole('admin', 'settings:theme')).toBe(false);
  });

  it('works with comma-separated roles', () => {
    expect(hasGrantRole('admin,notes:create', 'notes:create')).toBe(true);
  });

  it('returns false for base role passed as grant', () => {
    expect(hasGrantRole('admin', 'admin')).toBe(true);
    expect(hasGrantRole('admin', 'superAdmin')).toBe(false);
  });

  it('returns false for falsy input', () => {
    expect(hasGrantRole(null, 'settings:theme')).toBe(false);
  });
});

describe('canActOn', () => {
  it('returns true when actor has strictly higher weight', () => {
    expect(canActOn('admin', 'user')).toBe(true);
    expect(canActOn('superAdmin', 'admin')).toBe(true);
    expect(canActOn('admin', 'operator')).toBe(true);
    expect(canActOn('operator', 'user')).toBe(true);
    expect(canActOn('superAdmin', 'user')).toBe(true);
  });

  it('returns false for same weight (cannot act on equal)', () => {
    expect(canActOn('admin', 'admin')).toBe(false);
    expect(canActOn('user', 'user')).toBe(false);
    expect(canActOn('superAdmin', 'superAdmin')).toBe(false);
  });

  it('returns false when actor has lower weight', () => {
    expect(canActOn('user', 'admin')).toBe(false);
    expect(canActOn('operator', 'admin')).toBe(false);
    expect(canActOn('user', 'superAdmin')).toBe(false);
  });

  it('returns false for falsy inputs', () => {
    expect(canActOn(null, 'user')).toBe(false);
    // null target resolves to 'user' (weight 0), admin (weight 2) > 0
    expect(canActOn('admin', null)).toBe(true);
  });

  it('returns false when both are unknown/grant roles (weight 0)', () => {
    expect(canActOn('settings:theme', 'notes:create')).toBe(false);
  });
});

describe('ROLE_WEIGHT', () => {
  it('defines correct weights', () => {
    expect(ROLE_WEIGHT.user).toBe(0);
    expect(ROLE_WEIGHT.operator).toBe(1);
    expect(ROLE_WEIGHT.admin).toBe(2);
    expect(ROLE_WEIGHT.superAdmin).toBe(3);
  });

  it('returns 0 for unknown roles', () => {
    expect(ROLE_WEIGHT['unknown']).toBeUndefined();
  });
});

describe('SERVER_ACTION_SCOPES', () => {
  it('contains exactly 9 scopes', () => {
    expect(SERVER_ACTION_SCOPES).toHaveLength(9);
  });

  it('contains expected note scopes', () => {
    expect(SERVER_ACTION_SCOPES).toContain('notes:create-note');
    expect(SERVER_ACTION_SCOPES).toContain('notes:update-note');
    expect(SERVER_ACTION_SCOPES).toContain('notes:delete-note');
  });

  it('contains expected settings scopes', () => {
    expect(SERVER_ACTION_SCOPES).toContain('settings:update-display-name');
    expect(SERVER_ACTION_SCOPES).toContain('settings:toggle-theme-preference');
    expect(SERVER_ACTION_SCOPES).toContain('settings:run-labs-setting');
    expect(SERVER_ACTION_SCOPES).toContain('settings:delete-account');
  });

  it('contains expected admin scope', () => {
    expect(SERVER_ACTION_SCOPES).toContain('admin:resend-verification');
  });

  it('contains expected dashboard scope', () => {
    expect(SERVER_ACTION_SCOPES).toContain('dashboard:fresh-role');
  });

  it('is a tuple type at compile time (runtime is a plain array)', () => {
    // as const only affects TypeScript types, not runtime Object.freeze
    expect(Array.isArray(SERVER_ACTION_SCOPES)).toBe(true);
  });
});
