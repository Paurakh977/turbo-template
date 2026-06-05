/**
 * Server-side password complexity policy.
 *
 * Matches the client-side validation in apps/web/src/lib/validation.ts
 * to ensure consistent enforcement regardless of how the request arrives
 * (UI, API call, curl, etc.).
 */

export interface PasswordPolicyResult {
  valid: boolean;
  message?: string;
}

export function validatePasswordPolicy(
  password: string,
  options?: { minLength?: number; maxLength?: number },
): PasswordPolicyResult {
  const minLength = options?.minLength ?? 8;
  const maxLength = options?.maxLength ?? 128;

  if (password.length < minLength) {
    return {
      valid: false,
      message: `Password must be at least ${minLength} characters.`,
    };
  }

  if (password.length > maxLength) {
    return {
      valid: false,
      message: `Password must be at most ${maxLength} characters.`,
    };
  }

  if (!/[A-Z]/.test(password) || !/[a-z]/.test(password)) {
    return {
      valid: false,
      message: 'Password must include uppercase and lowercase letters.',
    };
  }

  if (!/\d/.test(password)) {
    return {
      valid: false,
      message: 'Password must include at least one number.',
    };
  }

  if (!/[^A-Za-z0-9]/.test(password)) {
    return {
      valid: false,
      message: 'Password must include at least one symbol.',
    };
  }

  return { valid: true };
}
