import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { AuthGuard, Session } from '@thallesp/nestjs-better-auth';
import {
  IsInt,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { ServerActionRateLimitService } from './server-action-rate-limit.service';
import type { ServerSession } from '../common/session.utils';

export class CheckRateLimitDto {
  @IsString()
  @Matches(/^[a-z0-9:_-]{1,64}$/i)
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
 */
@Controller('rate-limit')
@UseGuards(AuthGuard)
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
