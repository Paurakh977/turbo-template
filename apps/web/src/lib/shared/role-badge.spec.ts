import { getRoleBadgeStyle, ROLE_BADGE_STYLE } from './role-badge';

describe('getRoleBadgeStyle', () => {
  it('returns primary style for superAdmin', () => {
    expect(getRoleBadgeStyle('superAdmin')).toBe(
      ROLE_BADGE_STYLE.superAdmin,
    );
  });

  it('returns primary style for admin', () => {
    expect(getRoleBadgeStyle('admin')).toBe(ROLE_BADGE_STYLE.admin);
  });

  it('returns indigo style for operator', () => {
    expect(getRoleBadgeStyle('operator')).toContain('indigo');
  });

  it('returns default style for user', () => {
    expect(getRoleBadgeStyle('user')).toBe(ROLE_BADGE_STYLE.user);
  });

  it('returns default style for unknown role', () => {
    expect(getRoleBadgeStyle('custom-role')).toContain('bg-muted');
  });

  it('returns default style for empty string', () => {
    expect(getRoleBadgeStyle('')).toContain('bg-muted');
  });
});

describe('ROLE_BADGE_STYLE', () => {
  it('has entries for all base roles', () => {
    expect(ROLE_BADGE_STYLE).toHaveProperty('superAdmin');
    expect(ROLE_BADGE_STYLE).toHaveProperty('admin');
    expect(ROLE_BADGE_STYLE).toHaveProperty('operator');
    expect(ROLE_BADGE_STYLE).toHaveProperty('user');
  });
});
