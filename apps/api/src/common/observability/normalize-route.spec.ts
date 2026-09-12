import { normalizeRouteForMetrics } from './metrics.service';

describe('normalizeRouteForMetrics', () => {
  it.each([
    // ID families collapse to :id
    ['/api/notes/550e8400-e29b-41d4-a716-446655440000', '/api/notes/:id'], // uuid
    ['/api/notes/64f1a2b3c4d5e6f7890abcdef', '/api/notes/:id'], // objectid
    ['/api/notes/cm1x8k2ab0000qz9y7w6e5r4t', '/api/notes/:id'], // cuid (25)
    ['/api/notes/cm4a1b5ef3333td2c0a9h8i7j9x', '/api/notes/:id'], // cuid-ish (26)
    ['/api/notes/yNrH12RQ2yad7brhQbydPHQMj', '/api/notes/:id'], // nanoid (27)
    ['/api/notes/yNrH12RQ2yad7brhQbydPHQMjbVDqEqX', '/api/notes/:id'], // long token
    ['/api/notes/123', '/api/notes/:id'], // numeric
    ['/api/notes/123?foo=bar', '/api/notes/:id'], // query stripped
    ['/api/notes/abc123XYZ45678901234?x=1&y=2', '/api/notes/:id'],
    ['/api/notes/abc123XYZ', '/api/notes/abc123XYZ'], // short token: untouched
    // nested ID segments
    ['/api/users/123/notes/cm1x8k2ab0000qz9y7w6e5r4t', '/api/users/:id/notes/:id'],
  ])('normalizes %s -> %s', (input, expected) => {
    expect(normalizeRouteForMetrics(input)).toBe(expected);
  });

  it.each([
    // every static route in the API today — must NEVER collapse (invariant:
    // static segments stay < 20 chars; see helper docblock)
    '/api/health/live',
    '/api/health/ready',
    '/api/notes',
    '/api/links',
    '/api/users/me/role',
    '/api/users/me/permissions',
    '/api/rate-limit/check',
    '/api/audit-logs',
    '/api/admin/audit-logs',
    '/api/auth/sign-in/email',
    '/api/auth/sign-up/email',
    '/api/auth/two-factor/verify-totp',
    '/api/auth/reset-password/reset',
    '/api/auth/organization/create',
    '/api/v1/notes',
  ])('leaves static route %s untouched', (input) => {
    expect(normalizeRouteForMetrics(input)).toBe(input);
  });
});
