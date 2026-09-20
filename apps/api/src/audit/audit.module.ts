import { Module } from '@nestjs/common';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';
import { AuthorizationService } from '../common/authorization.service';

@Module({
  controllers: [AuditController],
  providers: [AuditService, AuthorizationService],
})
export class AuditModule {}
