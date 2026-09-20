import { Global, Module } from '@nestjs/common';

import { AuditQueueService } from './audit-queue.service';

/**
 * Global singleton scope is REQUIRED, not convenience: ordering guarantees
 * only hold if every producer (notes, audit, future domains) shares one
 * FIFO. Per-module providers would create one queue per module and silently
 * fork the ordering the queue exists to preserve.
 */
@Global()
@Module({
  providers: [AuditQueueService],
  exports: [AuditQueueService],
})
export class AuditQueueModule {}
