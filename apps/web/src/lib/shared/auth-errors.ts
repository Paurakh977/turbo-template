export type AuthClientErrorLike = {
  status?: number;
  code?: string;
  message?: string;
};

/**
 * URLSearchParams.get() already percent-decodes and leaves malformed
 * sequences literal - calling decodeURIComponent() again on attacker-controlled
 * query values (e.g. ?error_description=100%) throws URIError and crashes the
 * page. Decode defensively or fall back to the raw value.
 */
export function safeDecodeParam(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizeCode(error: AuthClientErrorLike | null | undefined): string {
  return (error?.code ?? '').toUpperCase();
}

export function isRateLimitedAuthError(
  error: AuthClientErrorLike | null | undefined,
): boolean {
  return error?.status === 429;
}

export function getResendVerificationPublicMessage(
  error: AuthClientErrorLike | null | undefined,
): string {
  if (isRateLimitedAuthError(error)) {
    return 'Too many requests. Please wait a moment and try again.';
  }
  return 'If your account exists and is not verified, we sent a verification link.';
}

export function getForgotPasswordPublicMessage(
  error: AuthClientErrorLike | null | undefined,
): string {
  if (isRateLimitedAuthError(error)) {
    return 'Too many requests. Please wait a moment and try again.';
  }
  return 'If an account exists for this email, you will receive a reset link shortly.';
}

export function getResetPasswordPublicError(
  error: AuthClientErrorLike | null | undefined,
): string {
  if (isRateLimitedAuthError(error)) {
    return 'Too many attempts. Please wait and try again.';
  }

  const code = normalizeCode(error);
  if (
    error?.status === 400 ||
    code.includes('TOKEN') ||
    code === 'INVALID_TOKEN'
  ) {
    return 'This reset link is invalid or expired. Please request a new one.';
  }

  return 'Could not reset password right now. Please try again.';
}

export function getVerifyEmailPublicError(
  error: AuthClientErrorLike | null | undefined,
): string {
  if (isRateLimitedAuthError(error)) {
    return 'Too many attempts. Please wait and try again.';
  }

  const code = normalizeCode(error);
  if (
    error?.status === 400 ||
    code.includes('TOKEN') ||
    code === 'INVALID_TOKEN'
  ) {
    return 'This verification link is invalid or expired. Request a new email and try again.';
  }

  return 'Unable to verify email right now. Please try again.';
}

export function getVerifyEmailCallbackError(errorParam: string | null): string {
  if (!errorParam) return '';

  const normalized = errorParam.toUpperCase();
  if (normalized.includes('INVALID_TOKEN') || normalized.includes('TOKEN')) {
    return 'This verification link is invalid or expired. Request a new email and try again.';
  }

  return 'Unable to verify email with this link. Request a new verification email.';
}
