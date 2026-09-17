import { isValidEmail, getPasswordStrength, validatePasswordPolicy } from './validation';

describe('isValidEmail', () => {
  describe('valid emails', () => {
    it('accepts simple email', () => {
      expect(isValidEmail('user@example.com')).toBe(true);
    });

    it('accepts email with subdomain', () => {
      expect(isValidEmail('user@mail.example.com')).toBe(true);
    });

    it('accepts email with plus addressing', () => {
      expect(isValidEmail('user+tag@example.com')).toBe(true);
    });

    it('accepts email with dots in local', () => {
      expect(isValidEmail('first.last@example.com')).toBe(true);
    });

    it('accepts email with hyphens in domain', () => {
      expect(isValidEmail('user@my-domain.com')).toBe(true);
    });

    it('accepts email with numbers', () => {
      expect(isValidEmail('user123@example123.com')).toBe(true);
    });

    it('rejects email with IPv4 domain format', () => {
      expect(isValidEmail('user@[192.168.1.1]')).toBe(false);
    });

    it('trims whitespace', () => {
      expect(isValidEmail('  user@example.com  ')).toBe(true);
    });
  });

  describe('invalid emails', () => {
    it('rejects empty string', () => {
      expect(isValidEmail('')).toBe(false);
    });

    it('rejects string without @', () => {
      expect(isValidEmail('userexample.com')).toBe(false);
    });

    it('rejects string starting with @', () => {
      expect(isValidEmail('@example.com')).toBe(false);
    });

    it('rejects multiple @ signs', () => {
      expect(isValidEmail('user@@example.com')).toBe(false);
    });

    it('rejects email with no local part', () => {
      expect(isValidEmail('@example.com')).toBe(false);
    });

    it('rejects email with no domain', () => {
      expect(isValidEmail('user@')).toBe(false);
    });

    it('rejects email with space in local', () => {
      expect(isValidEmail('user name@example.com')).toBe(false);
    });

    it('rejects email exceeding max length (254)', () => {
      const local = 'a'.repeat(64);
      const domain = 'b'.repeat(186) + '.com';
      expect(isValidEmail(`${local}@${domain}`)).toBe(false);
    });

    it('rejects domain without TLD', () => {
      expect(isValidEmail('user@localhost')).toBe(false);
    });

    it('rejects domain starting with hyphen', () => {
      expect(isValidEmail('user@-example.com')).toBe(false);
    });

    it('rejects domain ending with hyphen', () => {
      expect(isValidEmail('user@example-.com')).toBe(false);
    });
  });
});

describe('getPasswordStrength', () => {
  it('returns weak for very short password', () => {
    expect(getPasswordStrength('ab')).toBe('weak');
  });

  it('returns weak for lowercase only (score 1)', () => {
    expect(getPasswordStrength('abcdefgh')).toBe('weak');
  });

  it('returns medium for mixed case (score 2)', () => {
    expect(getPasswordStrength('Abcdefgh')).toBe('medium');
  });

  it('returns medium for mixed case + digit (score 3)', () => {
    expect(getPasswordStrength('Abcdefg1')).toBe('medium');
  });

  it('returns strong for all four criteria (score 4)', () => {
    expect(getPasswordStrength('Abcdefg1!')).toBe('strong');
  });

  it('returns weak for single character', () => {
    expect(getPasswordStrength('a')).toBe('weak');
  });

  it('returns medium for digits + special chars (no mixed case)', () => {
    expect(getPasswordStrength('12345678!')).toBe('medium');
  });

  it('returns strong for complex password', () => {
    expect(getPasswordStrength('Th1s!s@Str0ng')).toBe('strong');
  });
});

describe('validatePasswordPolicy', () => {
  it('returns null for valid password', () => {
    expect(validatePasswordPolicy('MyP@ssw0rd')).toBeNull();
  });

  it('returns error message for short password', () => {
    const result = validatePasswordPolicy('Ab1@xyz');
    expect(result).toContain('at least 8 characters');
  });

  it('returns error message for password without uppercase+lowercase', () => {
    const result = validatePasswordPolicy('myp@ssw0rd');
    expect(result).toContain('uppercase and lowercase');
  });

  it('returns error message for password without digit', () => {
    const result = validatePasswordPolicy('MyP@ssword');
    expect(result).toContain('at least one number');
  });

  it('returns error message for password without symbol', () => {
    const result = validatePasswordPolicy('MyP4ssword');
    expect(result).toContain('at least one symbol');
  });
});
