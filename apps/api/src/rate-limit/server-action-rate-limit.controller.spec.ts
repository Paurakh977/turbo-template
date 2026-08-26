import { jest } from '@jest/globals';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { CheckRateLimitDto } from './server-action-rate-limit.controller';
import { SERVER_ACTION_SCOPES } from '@repo/roles';

/**
 * Pins the rate-limit DTO against EVERY scope string the web tier composes
 * (`<family>:<action>` wrappers in notes/settings/admin actions + the bare
 * dashboard one). If a call site starts sending a scope missing from
 * SERVER_ACTION_SCOPES, this list grows there first and this test fails here
 * — the drift surfaces in CI, not as "Too many requests" in prod.
 */
const WEB_TIER_SCOPES = [
  'notes:create-note',
  'notes:update-note',
  'notes:delete-note',
  'settings:update-display-name',
  'settings:toggle-theme-preference',
  'settings:run-labs-setting',
  'settings:delete-account',
  'admin:resend-verification',
  'dashboard:fresh-role',
] as const;

describe('CheckRateLimitDto scope allowlist', () => {
  it('accepts every scope the web tier actually sends', async () => {
    for (const scope of WEB_TIER_SCOPES) {
      const dto = plainToInstance(CheckRateLimitDto, {
        scope,
        windowMs: 60_000,
        max: 5,
      });
      const errors = await validate(dto);
      expect(errors).toEqual([]);
    }
  });

  it('rejects unknown scopes (Redis key-space protection)', async () => {
    const dto = plainToInstance(CheckRateLimitDto, {
      scope: 'notes:some-future-action',
      windowMs: 60_000,
      max: 5,
    });
    const errors = await validate(dto);
    expect(errors.map((e) => e.property)).toContain('scope');
  });

  it('keeps the web-tier inventory in sync with the shared allowlist', () => {
    for (const scope of WEB_TIER_SCOPES) {
      expect(SERVER_ACTION_SCOPES).toContain(scope);
    }
  });
});
