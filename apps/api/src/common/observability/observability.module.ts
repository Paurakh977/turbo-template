import { Module, Global } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { MetricsService } from './metrics.service';
import { ObservabilityInterceptor } from './observability.interceptor';

@Global()
@Module({
  providers: [
    MetricsService,
    {
      provide: APP_INTERCEPTOR,
      useClass: ObservabilityInterceptor,
    },
  ],
  exports: [MetricsService],
})
export class ObservabilityModule {}
