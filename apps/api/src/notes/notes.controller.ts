import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { Session } from '@thallesp/nestjs-better-auth';

import { NotesService } from './notes.service';
import {
  CreateNoteDto,
  UpdateNoteDto,
  ListNotesQuery,
  DEFAULT_LIMIT,
} from './dto/note.dto';
import { extractClientMeta } from '../common/client-meta';
import type { ServerSession } from '../common/session.utils';

/**
 * Notes API - the single enforcement point for note RBAC (Architecture B).
 * The web tier consumes these endpoints via its auth-http gateway instead of
 * querying Postgres directly.
 *
 * NOTE: no @UseGuards(AuthGuard) here - the global APP_GUARD registered by
 * AuthModule.forRoot already resolves the session for every non-public route;
 * a controller-level duplicate would run getSession twice per request.
 */
@Controller('notes')
export class NotesController {
  constructor(private readonly notes: NotesService) {}

  @Get()
  list(@Session() session: ServerSession, @Query() query: ListNotesQuery) {
    return this.notes.listForSession(
      session,
      query.limit ?? DEFAULT_LIMIT,
      query.offset ?? 0,
    );
  }

  @Post()
  @HttpCode(201)
  create(
    @Session() session: ServerSession,
    @Body() dto: CreateNoteDto,
    @Req() req: Request,
  ) {
    return this.notes.create(session, dto, extractClientMeta(req));
  }

  @Patch(':id')
  update(
    @Session() session: ServerSession,
    @Param('id') id: string,
    @Body() dto: UpdateNoteDto,
    @Req() req: Request,
  ) {
    return this.notes.update(session, id, dto, extractClientMeta(req));
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(
    @Session() session: ServerSession,
    @Param('id') id: string,
    @Req() req: Request,
  ): Promise<void> {
    await this.notes.remove(session, id, extractClientMeta(req));
  }
}
