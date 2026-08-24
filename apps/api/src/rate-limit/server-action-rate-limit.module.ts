import { Module } from '@nestjs/common';
import { ServerActionRateLimitController } from './server-action-rate-limit.controller';
import { ServerActionRateLimitService } from './server-action-rate-limit.service';

@Module({
  controllers: [ServerActionRateLimitController],
  providers: [ServerActionRateLimitService],
})
export class ServerActionRateLimitModule {}
