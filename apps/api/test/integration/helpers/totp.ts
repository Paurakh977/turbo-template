import { authenticator } from 'otplib';

/**
 * Better Auth returns a TOTP URI (otpauth://totp/...) after enabling 2FA.
 * We extract the raw secret and generate time-based codes so integration
 * tests can complete the verify step without a real authenticator app.
 */
export function extractTotpSecret(totpUri: string): string {
  const match = totpUri.match(/[?&]secret=([^&]+)/);
  if (!match) {
    // Already a raw base32 secret (not a full otpauth URI).
    return totpUri;
  }
  return decodeURIComponent(match[1]);
}

export function generateTotpCode(totpUri: string): string {
  return authenticator.generate(extractTotpSecret(totpUri));
}
