import { Body, Controller, Post } from '@nestjs/common';
import { Session } from '@thallesp/nestjs-better-auth';
// Main-entry import: the api tsconfig uses Node10 resolution where package
// subpath exports do not resolve. SERVER_ACTION_SCOPES is the shared
// single-source allowlist (packages/roles) — web composes these exact
// strings, so any drift breaks loudly here instead of silently in prod.
import { SERVER_ACTION_SCOPES } from '@repo/roles';
import { IsIn, IsInt, Max, Min } from 'class-validator';

import { ServerActionRateLimitService } from './server-action-rate-limit.service';
import type { ServerSession } from '../common/session.utils';

export class CheckRateLimitDto {
  // Rejected values can never mint Redis keys (the old regex-only check let a
  // client create `server-action:<anything>:<id>` with a 1h TTL per request).
  @IsIn(SERVER_ACTION_SCOPES as unknown as string[])
  scope!: string;

  @IsInt()
  @Min(1000)
  @Max(3_600_000)
  windowMs!: number;

  @IsInt()
  @Min(1)
  @Max(1000)
  max!: number;
}

/**
 * Session-scoped server-action rate limiting for the web tier.
 *
 * The identifier is ALWAYS derived from the authenticated session - a client
 * can never rate-limit (or burn budget for) someone else. Replaces web's
 * DB-backed limiter so `rateLimit` table writes stop flowing through the
 * internet-facing tier entirely.
 *
 * NOTE: no @UseGuards(AuthGuard) - the global APP_GUARD already resolves the
 * session for every non-public route (a per-controller guard here made
 * getSession run twice per request).
 */
@Controller('rate-limit')
export class ServerActionRateLimitController {
  constructor(private readonly limiter: ServerActionRateLimitService) {}

  @Post('check')
  check(
    @Session() session: ServerSession,
    @Body() dto: CheckRateLimitDto,
  ) {
    return this.limiter.check({
      scope: dto.scope,
      identifier: session.user.id,
      windowMs: dto.windowMs,
      max: dto.max,
    });
  }
}
