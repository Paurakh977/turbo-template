import type { Request } from 'express';

/**
 * Client attribution shared by every endpoint that writes audit rows.
 *
 * Resolution order (H3 fix — never read leftmost X-Forwarded-For):
 *   1. req.ip — main.ts sets `trust proxy = 1`, so Express trusts exactly one
 *      hop (nginx directly, or the web tier relaying) and returns the
 *      rightmost-untrusted entry of XFF. nginx already appended the true
 *      client at the edge ($proxy_add_x_forwarded_for), so this is the real
 *      visitor in every current topology. A client-supplied leftmost entry is
 *      therefore never trusted (previously: forgeable audit IPs).
 *   2. x-real-ip — nginx overwrites it with $remote_addr; safe fallback for
 *      paths where trust proxy resolution has no chain to strip.
 *   3. null — unknown rather than spoofable.
 */
export function extractClientMeta(req: Request): {
  ip: string | null;
  userAgent: string | null;
} {
  const ip =
    req.ip ||
    (typeof req.headers['x-real-ip'] === 'string'
      ? (req.headers['x-real-ip'] as string)
      : null);
  return { ip: ip ?? null, userAgent: req.headers['user-agent'] ?? null };
}
