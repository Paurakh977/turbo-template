import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { AuthorizationService } from '../common/authorization.service';

@Module({
  controllers: [UsersController],
  providers: [AuthorizationService],
})
export class UsersModule {}
