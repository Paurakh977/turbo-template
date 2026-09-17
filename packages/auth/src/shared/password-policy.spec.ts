import { validatePasswordPolicy } from './password-policy';

describe('validatePasswordPolicy', () => {
  describe('valid passwords', () => {
    it('accepts a valid password with all requirements', () => {
      expect(validatePasswordPolicy('MyP@ssw0rd')).toEqual({ valid: true });
    });

    it('accepts a password with exactly min length', () => {
      expect(validatePasswordPolicy('Ab1@defg')).toEqual({ valid: true });
    });

    it('accepts a password with exactly max length (128)', () => {
      const pwd = 'Ab1@' + 'x'.repeat(124);
      expect(validatePasswordPolicy(pwd)).toEqual({ valid: true });
    });

    it('accepts a long complex password', () => {
      expect(validatePasswordPolicy('Th1s!sAV3ryL0ngP@ssw0rd!')).toEqual({
        valid: true,
      });
    });
  });

  describe('too short', () => {
    it('rejects password shorter than min length', () => {
      const result = validatePasswordPolicy('Ab1@xyz');
      expect(result).toEqual({
        valid: false,
        message: 'Password must be at least 8 characters.',
      });
    });

    it('rejects empty string', () => {
      expect(validatePasswordPolicy('')).toEqual({
        valid: false,
        message: 'Password must be at least 8 characters.',
      });
    });

    it('rejects single character', () => {
      expect(validatePasswordPolicy('A')).toEqual({
        valid: false,
        message: 'Password must be at least 8 characters.',
      });
    });
  });

  describe('too long', () => {
    it('rejects password longer than max length', () => {
      const pwd = 'Ab1@' + 'x'.repeat(125);
      const result = validatePasswordPolicy(pwd);
      expect(result).toEqual({
        valid: false,
        message: 'Password must be at most 128 characters.',
      });
    });
  });

  describe('missing uppercase', () => {
    it('rejects password without uppercase letters', () => {
      expect(validatePasswordPolicy('myp@ssw0rd')).toEqual({
        valid: false,
        message: 'Password must include uppercase and lowercase letters.',
      });
    });
  });

  describe('missing lowercase', () => {
    it('rejects password without lowercase letters', () => {
      expect(validatePasswordPolicy('MYP@SSW0RD')).toEqual({
        valid: false,
        message: 'Password must include uppercase and lowercase letters.',
      });
    });
  });

  describe('missing digit', () => {
    it('rejects password without digits', () => {
      expect(validatePasswordPolicy('MyP@ssword')).toEqual({
        valid: false,
        message: 'Password must include at least one number.',
      });
    });
  });

  describe('missing symbol', () => {
    it('rejects password without special characters', () => {
      expect(validatePasswordPolicy('MyP4ssword')).toEqual({
        valid: false,
        message: 'Password must include at least one symbol.',
      });
    });
  });

  describe('custom options', () => {
    it('respects custom minLength', () => {
      const result = validatePasswordPolicy('Ab1@xyz', { minLength: 6 });
      expect(result).toEqual({ valid: true });
    });

    it('rejects below custom minLength', () => {
      const result = validatePasswordPolicy('Ab1@xy', { minLength: 7 });
      expect(result).toEqual({
        valid: false,
        message: 'Password must be at least 7 characters.',
      });
    });

    it('respects custom maxLength', () => {
      const pwd = 'Ab1@' + 'x'.repeat(46);
      const result = validatePasswordPolicy(pwd, { maxLength: 50 });
      expect(result).toEqual({ valid: true });
    });

    it('rejects above custom maxLength', () => {
      const pwd = 'Ab1@' + 'x'.repeat(47);
      const result = validatePasswordPolicy(pwd, { maxLength: 50 });
      expect(result).toEqual({
        valid: false,
        message: 'Password must be at most 50 characters.',
      });
    });
  });

  describe('unicode and special characters', () => {
    it('accepts unicode symbols as valid symbols', () => {
      expect(validatePasswordPolicy('Mypassw0rd✓')).toEqual({ valid: true });
    });

    it('accepts emoji as symbol', () => {
      expect(validatePasswordPolicy('Mypassw0rd🔐')).toEqual({ valid: true });
    });
  });

  describe('validation order', () => {
    it('checks length before complexity', () => {
      const result = validatePasswordPolicy('short');
      expect(result.message).toContain('at least 8');
    });

    it('checks case before digits', () => {
      const result = validatePasswordPolicy('alllowercase');
      expect(result.message).toContain('uppercase and lowercase');
    });

    it('checks digits before symbols', () => {
      const result = validatePasswordPolicy('AllLowercase');
      expect(result.message).toContain('at least one number');
    });
  });
});
