import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

function hasAuthCookie(request: NextRequest) {
  return request.cookies
    .getAll()
    .some((cookie) => cookie.name.startsWith('better-auth'));
}

export function proxy(request: NextRequest) {
  const sessionCookieExists = hasAuthCookie(request);
  const { pathname } = request.nextUrl;

  if (pathname.startsWith('/dashboard') && !sessionCookieExists) {
    return NextResponse.redirect(new URL('/auth/sign-in', request.url));
  }

  if (pathname.startsWith('/auth/') && sessionCookieExists) {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard/:path*', '/auth/:path*'],
};
