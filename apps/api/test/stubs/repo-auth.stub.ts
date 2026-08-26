/**
 * Hermetic test double for '@repo/auth' (e2e only).
 *
 * The real package constructs a full BetterAuth instance (pg pool, optional
 * Redis, Resend client) as an import side effect, and better-auth ships
 * ESM-only which jest's CJS runtime cannot parse. The e2e suite asserts HTTP
 * routing only - it never exercises auth internals - so AppModule gets this
 * inert stand-in instead.
 */
export const auth = {};

export const ADMIN_ROLES = ['admin', 'superAdmin'] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];
