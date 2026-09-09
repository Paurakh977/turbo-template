export const SENSITIVE_PATTERN =
  /password|passwd|secret|token|authorization|cookie|totp|otp|backup.?code|credit.?card|cvv|ssn|api.?key/i;

/**
 * Returns '[REDACTED]' if key matches sensitive pattern, else returns value
 */
export function redactValue(key: string, value: unknown): unknown {
  if (SENSITIVE_PATTERN.test(key)) {
    return '[REDACTED]';
  }
  return value;
}

/**
 * Returns a copy of headers with sensitive values redacted
 */
export function redactHeaders(
  headers: Record<string, string | string[] | undefined>,
): Record<string, string | string[] | undefined> {
  const result: Record<string, string | string[] | undefined> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (SENSITIVE_PATTERN.test(key)) {
      result[key] = '[REDACTED]';
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Returns a deep copy of the object with sensitive keys redacted
 */
export function redactObject(obj: unknown): unknown {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => redactObject(item));
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (SENSITIVE_PATTERN.test(key)) {
      result[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      result[key] = redactObject(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}
