import { NextRequest, NextResponse } from 'next/server';

const isDev = process.env.NODE_ENV === 'development';

/**
 * Build the Content-Security-Policy header.
 *
 * Uses the nonce-based CSP pattern from the Next.js docs:
 * https://nextjs.org/docs/app/guides/content-security-policy
 *
 * `'strict-dynamic'` lets the one nonce'd bootstrap script load all other
 * framework scripts (`/_next/static/...`, RSC flight data). Host allowlists
 * like `'self'` are ignored by CSP3 browsers when strict-dynamic is present;
 * they only exist as a fallback for legacy browsers.
 */
const buildCSP = (nonce: string) => {
  const scriptSrc = `'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`;

  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    'upgrade-insecure-requests',
  ].join('; ');
};

export function proxy(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const csp = buildCSP(nonce);

  const requestHeaders = new Headers(request.headers);
  // Read by layout.tsx to manually nonce inline scripts (theme init).
  requestHeaders.set('x-nonce', nonce);
  // REQUIRED: Next.js extracts the nonce from this header during rendering
  // and automatically attaches it to its own framework scripts, page JS
  // bundles, and inline flight-data scripts. Without it those scripts are
  // blocked by the CSP above.
  requestHeaders.set('Content-Security-Policy', csp);

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });

  // Enforced by the browser on the actual response.
  response.headers.set('Content-Security-Policy', csp);

  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
