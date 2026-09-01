export const ROUTES = {
  home: '/',
  base: '',
  auth: '/auth',
  forgotPassword: '/auth/forgot-password',
  resetPassword: '/auth/reset-password',
  verifyEmail: '/auth/verify-email',
  twoFactor: '/auth/two-factor',
  dashboard: '/dashboard',
  notes: '/dashboard/notes',
  settings: '/dashboard/settings',
  admin: '/admin',
  adminAudit: '/admin/audit',
  audit: '/admin/audit',
  notFound: '/this-route-does-not-exist-404',
} as const;

export type RouteKey = keyof typeof ROUTES;
