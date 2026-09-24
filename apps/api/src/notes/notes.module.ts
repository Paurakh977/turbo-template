import { Module } from '@nestjs/common';
import { NotesController } from './notes.controller';
import { NotesService } from './notes.service';
import { AuthorizationService } from '../common/authorization.service';

@Module({
  controllers: [NotesController],
  providers: [NotesService, AuthorizationService],
})
export class NotesModule {}
