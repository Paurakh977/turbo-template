import 'server-only';

/**
 * Canonical request fingerprint for request-scoped cache() keys.
 *
 * React cache() memoizes by argument identity — passing the Headers object
 * directly defeats the cache because next/headers returns a NEW wrapper per
 * call. Both bootstrap.ts (dashboard identity) and require-admin.ts (admin
 * guard) must key on the SAME four primitive strings: exactly the
 * request-varying inputs buildForwardedHeaders propagates (cookie + IP/UA
 * chain; Origin comes from env, not the request).
 *
 * One canonical implementation: every request-scoped cache() in the web
 * tier derives its key from fingerprintFromHeaders(). Adding a new forwarded
 * header requires updating this tuple AND buildForwardedHeaders together.
 */

export type RequestFingerprint = {
  cookie: string;
  forwardedFor: string;
  realIp: string;
  userAgent: string;
};

export function fingerprintFromHeaders(requestHeaders: Headers): RequestFingerprint {
  return {
    cookie: requestHeaders.get('cookie') ?? '',
    forwardedFor: requestHeaders.get('x-forwarded-for') ?? '',
    realIp: requestHeaders.get('x-real-ip') ?? '',
    userAgent: requestHeaders.get('user-agent') ?? '',
  };
}

/** Ordered tuple for cache() primitive args: cookie, forwardedFor, realIp, userAgent. */
export function fingerprintArgs(fp: RequestFingerprint): [string, string, string, string] {
  return [fp.cookie, fp.forwardedFor, fp.realIp, fp.userAgent];
}

/** Convenience: headers -> cache args in one call. */
export function fingerprintCacheArgs(requestHeaders: Headers): [string, string, string, string] {
  return fingerprintArgs(fingerprintFromHeaders(requestHeaders));
}
