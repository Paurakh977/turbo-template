import { Controller, Get } from '@nestjs/common';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';
import { RateLimitService } from './ratelimit.service';

@Controller('ratelimit')
export class RatelimitController {
  constructor(private readonly ratelimitService: RateLimitService) {}

  @Get('health')
  @AllowAnonymous()
  health() {
    return { status: 'ok' };
  }
}
