// ---------------------------------------------------------------------------
// Client-IP resolution shared by every audit writer in this package
// (auditLogPlugin hooks, databaseHooks).
//
// NEVER read leftmost X-Forwarded-For directly: nginx APPENDS the real peer
// ($proxy_add_x_forwarded_for), so the leftmost entry is fully
// attacker-controlled (the forgeable-audit-IP defect class fixed for the
// Express layer in apps/api/src/common/client-meta.ts).
//
// Resolution (mirrors Better Auth's own advanced.ipAddress.trustedProxies
// walk, which this config feeds via TRUSTED_PROXY_CIDRS):
//   1. Walk XFF right-to-left. Hops matching TRUSTED_PROXY_CIDRS are the
//      infrastructure we control (docker networks / loopback) and are
//      skipped; the first untrusted hop is the client.
//   2. ANY structurally invalid hop (garbage, hostname, `ip:port`,
//      non-canonical octets like `010.0.0.1`) aborts the whole chain and
//      yields undefined — same fail-closed stance as Better Auth's
//      getIPFromHeader. Without this, a crafted trailing entry could trick
//      the walker into surfacing an earlier attacker-chosen hop.
//   3. Fall back to x-real-ip (validated with the same parser; nginx sets it
//      to the connection peer when its realip module is active).
//   4. undefined — unknown rather than spoofable.
//
// NOTE: unlike Express `trust proxy = 1` (a fixed hop COUNT), this trusts
// unlimited CIDR-matching hops — Better Auth semantics. The two agree in
// every topology currently deployed here (single nginx or nginx->web->api,
// where only the edge appends); revisit if a second appending proxy that is
// NOT RFC1918/loopback is ever introduced.
// ---------------------------------------------------------------------------

/** Keep in sync with the `trustedProxies` consumed by the betterAuth config. */
export const TRUSTED_PROXY_CIDRS = [
  '10.0.0.0/8',
  '172.16.0.0/12',
  '192.168.0.0/16',
  // Exact-match entries below bypass the IPv4 CIDR math, so loopback over
  // both stacks is covered.
  '127.0.0.1',
  '::1',
] as const;

type HeaderLike = { get(name: string): string | null | undefined };

/**
 * Canonical dotted-quad only: every octet 0-255 with NO leading zeros.
 * `010.0.0.1` must not classify as 10.0.0.1 — lenient decimal parsing would
 * let a crafted entry masquerade as a trusted private hop.
 */
const IPV4_PATTERN =
  /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

function isCanonicalIpv4(candidate: string): boolean {
  return IPV4_PATTERN.test(candidate);
}

/**
 * Structural IPv6 check (groups of 1-4 hex digits, at most one `::`).
 * Deliberately conservative: hostnames (`evil.example.com`), `ip:port`
 * suffixes (`1.2.3.4:1337`), and embedded-IPv4 forms all fail and are treated
 * as invalid input rather than guessed at.
 */
function isPlausibleIpv6(candidate: string): boolean {
  if (!candidate.includes(':')) return false;
  const halves = candidate.split('::');
  if (halves.length > 2) return false;
  const [head = '', tail] = halves;
  const groups = [...head.split(':'), ...(tail === undefined ? [] : tail.split(':'))]
    .filter((g) => g.length > 0);
  const minGroups = tail !== undefined ? 1 : 8;
  if (groups.length < minGroups || groups.length > 8) return false;
  return groups.every((g) => /^[0-9a-fA-F]{1,4}$/.test(g));
}

function isValidIp(candidate: string): boolean {
  return isCanonicalIpv4(candidate) || isPlausibleIpv6(candidate);
}

function isTrustedProxy(candidate: string): boolean {
  if ((TRUSTED_PROXY_CIDRS as readonly string[]).includes(candidate)) {
    return true;
  }
  if (!isCanonicalIpv4(candidate)) return false;
  let ip = 0;
  for (const part of candidate.split('.')) {
    ip = ip * 256 + Number(part);
  }
  ip = ip >>> 0;
  for (const cidr of TRUSTED_PROXY_CIDRS) {
    const [base, prefixRaw] = cidr.split('/');
    const prefix = Number(prefixRaw);
    if (!base || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
      continue;
    }
    if (!isCanonicalIpv4(base)) continue;
    let baseLong = 0;
    for (const part of base.split('.')) {
      baseLong = baseLong * 256 + Number(part);
    }
    baseLong = baseLong >>> 0;
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    if ((ip & mask) === (baseLong & mask)) return true;
  }
  return false;
}

/**
 * Resolve the real client IP from fetch-style request headers.
 * Returns undefined whenever no trustworthy value exists — callers persist
 * null/omit rather than recording a spoofable or malformed string.
 */
export function resolveClientIp(
  headers: HeaderLike | null | undefined,
): string | undefined {
  const forwarded = headers?.get('x-forwarded-for');
  if (forwarded !== undefined && forwarded !== null && forwarded.trim() !== '') {
    const hops = forwarded.split(',').map((hop) => hop.trim());
    // Right-to-left: skip infrastructure we control; surface the first
    // untrusted hop; abort entirely on malformed entries so a crafted tail
    // can never launder an attacker-chosen value through the walk.
    for (let i = hops.length - 1; i >= 0; i--) {
      const hop = hops[i];
      if (!hop || !isValidIp(hop)) return undefined;
      if (!isTrustedProxy(hop)) return hop;
    }
  }

  const realIp = headers?.get('x-real-ip')?.trim();
  if (realIp && isValidIp(realIp)) return realIp;

  return undefined;
}
