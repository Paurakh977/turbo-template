export type PasswordStrength = 'weak' | 'medium' | 'strong';

const MAX_EMAIL_LENGTH = 254;
const MAX_LOCAL_LENGTH = 64;
const MAX_DOMAIN_LENGTH = 253;
const QUOTED_LOCAL_PART =
  /^(?:"(?:[\x01-\x08\x0b\x0c\x0e-\x1f\x21\x23-\x5b\x5d-\x7f]|\\[\x00-\x7f])*")$/;
const UNQUOTED_LOCAL_PART =
  /^(?:[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*)$/;
const DOMAIN_NAME =
  /^(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/;
const DOMAIN_IPV4 =
  /^\[(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}\]$/;

function isValidLocalPart(local: string): boolean {
  if (!local || local.length > MAX_LOCAL_LENGTH) return false;
  return QUOTED_LOCAL_PART.test(local) || UNQUOTED_LOCAL_PART.test(local);
}

function isValidDomain(domain: string): boolean {
  if (!domain || domain.length > MAX_DOMAIN_LENGTH) return false;
  if (DOMAIN_IPV4.test(domain)) return true;
  return DOMAIN_NAME.test(domain);
}

export function isValidEmail(value: string): boolean {
  const email = value.trim();

  if (email.length < 3 || email.length > MAX_EMAIL_LENGTH) return false;
  const atIndex = email.indexOf('@');
  if (atIndex <= 0 || atIndex !== email.lastIndexOf('@')) return false;

  const local = email.slice(0, atIndex);
  const domain = email.slice(atIndex + 1);

  return isValidLocalPart(local) && isValidDomain(domain);
}

export function getPasswordStrength(value: string): PasswordStrength {
  let score = 0;

  if (value.length >= 8) score += 1;
  if (/[A-Z]/.test(value) && /[a-z]/.test(value)) score += 1;
  if (/\d/.test(value)) score += 1;
  if (/[^A-Za-z0-9]/.test(value)) score += 1;

  if (score <= 1) return 'weak';
  if (score <= 3) return 'medium';
  return 'strong';
}

export function validatePasswordPolicy(value: string): string | null {
  if (value.length < 8) {
    return 'Password must be at least 8 characters.';
  }

  if (!/[A-Z]/.test(value) || !/[a-z]/.test(value)) {
    return 'Password must include uppercase and lowercase letters.';
  }

  if (!/\d/.test(value)) {
    return 'Password must include at least one number.';
  }

  if (!/[^A-Za-z0-9]/.test(value)) {
    return 'Password must include at least one symbol.';
  }

  return null;
}
